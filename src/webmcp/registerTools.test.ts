import { afterEach, describe, expect, it, vi } from 'vitest'
import { authorizeStagedChange, createStagedOpsStore, resetDemo, revokeStagedAuthorization, stagePolicyChange, type StorageAdapter } from '../domain/stagedOps'
import { createAgentContextStore } from '../state/agentContextStore'
import { registerStagedOpsTools } from './registerTools'

class MemoryStorage implements StorageAdapter {
  readonly entries = new Map<string, string>()
  getItem(key: string) { return this.entries.get(key) ?? null }
  setItem(key: string, value: string) { this.entries.set(key, value) }
}

type Registered = { descriptor: WebMCP.ModelContextTool; signal?: AbortSignal }

function fakeModelContext(failName?: string) {
  const active = new Map<string, Registered>()
  const calls: string[] = []
  const registerTool = vi.fn(async (descriptor: WebMCP.ModelContextTool, options?: WebMCP.ModelContextRegisterToolOptions) => {
    calls.push(descriptor.name)
    if (descriptor.name === failName) throw new Error('registration failed')
    active.set(descriptor.name, { descriptor, signal: options?.signal })
    options?.signal?.addEventListener('abort', () => active.delete(descriptor.name), { once: true })
  })
  return { modelContext: { registerTool } as unknown as WebMCP.ModelContext, active, calls }
}

function installModelContext(modelContext?: WebMCP.ModelContext) {
  Object.defineProperty(document, 'modelContext', { configurable: true, value: modelContext })
}

async function flushRegistration() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => installModelContext(undefined))

describe('imperative WebMCP registration', () => {
  it('registers the nine base tools with awaited descriptors, schemas, and correct read-only annotations', async () => {
    const fake = fakeModelContext()
    installModelContext(fake.modelContext)
    const agentContext = createAgentContextStore()
    const store = createStagedOpsStore({ storage: new MemoryStorage() })

    const dispose = await registerStagedOpsTools({ store, agentContext })

    expect(fake.calls).toEqual([
      'get_fleet_summary', 'find_devices', 'inspect_device', 'explain_policy_conflicts', 'simulate_policy_change',
      'stage_policy_change', 'get_staged_change', 'rollback_last_change', 'get_audit_log',
    ])
    expect(fake.active.size).toBe(9)
    for (const { descriptor } of fake.active.values()) {
      expect(descriptor).toEqual(expect.objectContaining({ title: expect.any(String), description: expect.any(String), inputSchema: expect.any(Object), execute: expect.any(Function) }))
      expect(descriptor.annotations?.readOnlyHint).toBe(!['stage_policy_change', 'rollback_last_change'].includes(descriptor.name))
    }
    expect(agentContext.getSnapshot()).toMatchObject({ toolStatus: 'available', registeredCount: 9 })
    dispose()
    expect(fake.active.size).toBe(0)
  })

  it('follows the real nine/ten/nine lifecycle and delays post-apply removal until after the result resolves', async () => {
    const fake = fakeModelContext()
    installModelContext(fake.modelContext)
    const store = createStagedOpsStore({ storage: new MemoryStorage() })
    const agentContext = createAgentContextStore()
    const later: Array<() => void> = []
    const dispose = await registerStagedOpsTools({ store, agentContext, scheduleTask: (task) => later.push(task) })
    const staged = stagePolicyChange(store, { policyId: 'pol-rapid-update-enforcement', restartDeadlineDays: 7 })
    if (!staged.ok) throw new Error('stage should succeed')
    const auth = authorizeStagedChange(store, { stagedChangeId: staged.data.id })
    if (!auth.ok) throw new Error('authorization should succeed')
    await flushRegistration()

    expect(fake.active.size).toBe(10)
    expect(agentContext.getSnapshot().registeredCount).toBe(10)
    const apply = fake.active.get('apply_staged_change')!.descriptor
    expect(apply.annotations?.readOnlyHint).toBe(false)
    const result = await apply.execute({ stageId: staged.data.id, expectedConfigRevision: 1 }, { signal: new AbortController().signal }) as { ok: boolean }

    expect(result.ok).toBe(true)
    expect(fake.active.has('apply_staged_change')).toBe(true)
    expect(later).toHaveLength(1)
    later[0]()
    expect(fake.active.size).toBe(9)
    expect(agentContext.getSnapshot().registeredCount).toBe(9)
    dispose()
  })

  it('removes dynamic apply on replacement, revocation, reset, and authorization expiry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    try {
      const fake = fakeModelContext()
      installModelContext(fake.modelContext)
      const store = createStagedOpsStore({ storage: new MemoryStorage() })
      const agentContext = createAgentContextStore()
      const dispose = await registerStagedOpsTools({ store, agentContext })
      const first = stagePolicyChange(store, { policyId: 'pol-rapid-update-enforcement', restartDeadlineDays: 7 })
      if (!first.ok) throw new Error('stage should succeed')
      authorizeStagedChange(store, { stagedChangeId: first.data.id })
      await flushRegistration()
      expect(fake.active.size).toBe(10)

      stagePolicyChange(store, { policyId: 'pol-rapid-update-enforcement', restartDeadlineDays: 7 })
      await flushRegistration()
      expect(fake.active.size).toBe(9)
      const second = store.getSnapshot().stagedChange!
      authorizeStagedChange(store, { stagedChangeId: second.id })
      await flushRegistration()
      expect(fake.active.size).toBe(10)
      revokeStagedAuthorization(store)
      await flushRegistration()
      expect(fake.active.size).toBe(9)
      authorizeStagedChange(store, { stagedChangeId: second.id })
      await flushRegistration()
      expect(fake.active.size).toBe(10)
      resetDemo(store)
      await flushRegistration()
      expect(fake.active.size).toBe(9)

      const third = stagePolicyChange(store, { policyId: 'pol-rapid-update-enforcement', restartDeadlineDays: 7 })
      if (!third.ok) throw new Error('stage should succeed')
      authorizeStagedChange(store, { stagedChangeId: third.data.id })
      await flushRegistration()
      expect(fake.active.size).toBe(10)
      vi.advanceTimersByTime(300_000)
      await flushRegistration()
      expect(fake.active.size).toBe(9)
      dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts an existing registration session when tools refresh', async () => {
    const first = fakeModelContext()
    installModelContext(first.modelContext)
    const store = createStagedOpsStore({ storage: new MemoryStorage() })
    const firstDispose = await registerStagedOpsTools({ store, agentContext: createAgentContextStore() })
    expect(first.active.size).toBe(9)

    const second = fakeModelContext()
    installModelContext(second.modelContext)
    const secondDispose = await registerStagedOpsTools({ store, agentContext: createAgentContextStore() })
    expect(first.active.size).toBe(0)
    expect(second.active.size).toBe(9)
    firstDispose()
    secondDispose()
  })

  it('returns ABORTED from registered execute callbacks and keeps mutating state unchanged', async () => {
    const fake = fakeModelContext()
    installModelContext(fake.modelContext)
    const store = createStagedOpsStore({ storage: new MemoryStorage() })
    const dispose = await registerStagedOpsTools({ store, agentContext: createAgentContextStore() })
    const controller = new AbortController()
    controller.abort()

    const result = await fake.active.get('stage_policy_change')!.descriptor.execute(
      { simulationId: 'sim-cfg1-production-restart-7d', expectedConfigRevision: 1 }, { signal: controller.signal },
    ) as { error: { code: string } }

    expect(result.error.code).toBe('ABORTED')
    expect(store.getSnapshot().stagedChange).toBeNull()
    dispose()
  })

  it('degrades safely when unavailable or when a registration rejects', async () => {
    installModelContext(undefined)
    const unavailable = createAgentContextStore()
    const noOp = await registerStagedOpsTools({ store: createStagedOpsStore({ storage: new MemoryStorage() }), agentContext: unavailable })
    expect(unavailable.getSnapshot()).toMatchObject({ toolStatus: 'unavailable', registeredCount: 0 })
    expect(() => noOp()).not.toThrow()

    const fake = fakeModelContext('inspect_device')
    installModelContext(fake.modelContext)
    const errored = createAgentContextStore()
    const dispose = await registerStagedOpsTools({ store: createStagedOpsStore({ storage: new MemoryStorage() }), agentContext: errored })
    expect(fake.calls).toHaveLength(9)
    expect(errored.getSnapshot()).toMatchObject({ toolStatus: 'error', registeredCount: 8 })
    dispose()
  })
})
