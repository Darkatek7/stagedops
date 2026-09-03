import { describe, expect, it, vi } from 'vitest'
import {
  STORAGE_KEY,
  applyStagedChange,
  authorizeStagedChange,
  createStagedOpsStore,
  getAuditLog,
  getFleetSummary,
  getPolicies,
  getStagedChange,
  resetDemo,
  rollbackLastChange,
  simulatePolicyChange,
  stagePolicyChange,
  type StorageAdapter,
} from './stagedOps'

class MemoryStorage implements StorageAdapter {
  readonly entries = new Map<string, string>()
  getItem(key: string) { return this.entries.get(key) ?? null }
  setItem(key: string, value: string) { this.entries.set(key, value) }
}

const rapidUpdate = { policyId: 'pol-rapid-update-enforcement', restartDeadlineDays: 7 }

function persistedStage() {
  const storage = new MemoryStorage()
  const store = createStagedOpsStore({ storage })
  const staged = stagePolicyChange(store, rapidUpdate)
  if (!staged.ok) throw new Error('stage should succeed')
  return JSON.parse(storage.getItem(STORAGE_KEY)!) as { version: number; state: Record<string, unknown> }
}

describe('StagedOps deterministic domain engine', () => {
  it('seeds exactly 60 devices with 48 compliant and 12 conflicting', () => {
    const store = createStagedOpsStore({ storage: new MemoryStorage() })

    const summary = getFleetSummary(store)

    expect(summary).toMatchObject({ totalDevices: 60, compliantDevices: 48, compliancePercent: 80, conflictCount: 12 })
    expect(summary.departments).toHaveLength(5)
    expect(summary.departments.every((department) => department.total === 12)).toBe(true)
  })

  it('exposes the current policies through a domain selector', () => {
    const store = createStagedOpsStore({ storage: new MemoryStorage() })

    expect(getPolicies(store).map((policy) => policy.id)).toEqual(['pol-standard-update-window', 'pol-rapid-update-enforcement'])
  })

  it('simulates the rapid update change with ten resolutions and two OS blockers', () => {
    const store = createStagedOpsStore({ storage: new MemoryStorage() })

    const simulation = simulatePolicyChange(store, rapidUpdate)

    expect(simulation).toMatchObject({ before: { compliantDevices: 48, conflictCount: 12 }, after: { compliantDevices: 58, conflictCount: 0 } })
    expect(simulation.resolvedDeviceIds).toHaveLength(10)
    expect(simulation.osBlockers.map((device) => device.id)).toEqual(['dev-035', 'dev-036'])
  })

  it('stages a change without mutating the applied policy', () => {
    const store = createStagedOpsStore({ storage: new MemoryStorage() })
    const before = getFleetSummary(store)

    const staged = stagePolicyChange(store, rapidUpdate)

    expect(staged.ok).toBe(true)
    expect(getStagedChange(store)).toMatchObject({ policyId: rapidUpdate.policyId, restartDeadlineDays: 7 })
    expect(getFleetSummary(store)).toEqual(before)
  })

  it('denies application when there is no authorization', () => {
    const store = createStagedOpsStore({ storage: new MemoryStorage() })
    stagePolicyChange(store, rapidUpdate)

    const result = applyStagedChange(store, { actor: 'Human' })

    expect(result).toMatchObject({ ok: false, error: { code: 'AUTHORIZATION_REQUIRED' } })
    expect(getFleetSummary(store).compliantDevices).toBe(48)
  })

  it('makes authorization expire, bind to the current stage, and allow only one use', () => {
    let now = 1_000
    const store = createStagedOpsStore({ storage: new MemoryStorage(), now: () => now })
    const staged = stagePolicyChange(store, rapidUpdate)
    if (!staged.ok) throw new Error('stage should succeed')

    const authorization = authorizeStagedChange(store, { stagedChangeId: staged.data.id })
    expect(authorization.ok).toBe(true)
    if (!authorization.ok) throw new Error('authorization should succeed')
    now += 300_001
    expect(applyStagedChange(store, { actor: 'Human', authorizationId: authorization.data.id })).toMatchObject({ ok: false, error: { code: 'AUTHORIZATION_EXPIRED' } })

    const renewed = authorizeStagedChange(store, { stagedChangeId: staged.data.id })
    if (!renewed.ok) throw new Error('authorization should succeed')
    stagePolicyChange(store, rapidUpdate)
    expect(applyStagedChange(store, { actor: 'Human', authorizationId: renewed.data.id })).toMatchObject({ ok: false, error: { code: 'AUTHORIZATION_MISMATCH' } })

    const freshStage = getStagedChange(store)
    if (!freshStage) throw new Error('stage should exist')
    const freshAuthorization = authorizeStagedChange(store, { stagedChangeId: freshStage.id })
    if (!freshAuthorization.ok) throw new Error('authorization should succeed')
    expect(applyStagedChange(store, { actor: 'Human', authorizationId: freshAuthorization.data.id })).toMatchObject({ ok: true })
    expect(applyStagedChange(store, { actor: 'Human', authorizationId: freshAuthorization.data.id })).toMatchObject({ ok: false, error: { code: 'NO_STAGED_CHANGE' } })
  })

  it('applies atomically and rollbacks to the exact prior operational snapshot', () => {
    const store = createStagedOpsStore({ storage: new MemoryStorage() })
    const initial = getFleetSummary(store)
    const staged = stagePolicyChange(store, rapidUpdate)
    if (!staged.ok) throw new Error('stage should succeed')
    const authorization = authorizeStagedChange(store, { stagedChangeId: staged.data.id })
    if (!authorization.ok) throw new Error('authorization should succeed')

    const applied = applyStagedChange(store, { actor: 'Human', authorizationId: authorization.data.id })

    expect(applied).toMatchObject({ ok: true, data: { compliancePercent: 96.7 } })
    expect(getFleetSummary(store)).toMatchObject({ compliantDevices: 58, conflictCount: 0 })
    expect(rollbackLastChange(store, { actor: 'Human' })).toMatchObject({ ok: true })
    expect(getFleetSummary(store)).toEqual(initial)
    expect(getAuditLog(store).map((event) => event.action)).toEqual(['stage', 'authorize', 'apply', 'rollback'])
  })

  it('resets the demo while preserving monotonically increasing revisions', () => {
    const store = createStagedOpsStore({ storage: new MemoryStorage() })
    const initial = store.getSnapshot()
    stagePolicyChange(store, rapidUpdate)

    const result = resetDemo(store)

    expect(result).toMatchObject({ ok: true })
    expect(getFleetSummary(store)).toMatchObject({ compliantDevices: 48, conflictCount: 12 })
    expect(store.getSnapshot().stateRevision).toBeGreaterThan(initial.stateRevision)
    expect(store.getSnapshot().configRevision).toBeGreaterThan(initial.configRevision)
  })

  it('recovers from corrupt persisted state and replaces it with a valid envelope', () => {
    const storage = new MemoryStorage()
    storage.setItem(STORAGE_KEY, '{not json')

    const store = createStagedOpsStore({ storage })

    expect(getFleetSummary(store).totalDevices).toBe(60)
    expect(() => JSON.parse(storage.getItem(STORAGE_KEY)!)).not.toThrow()
  })

  it.each([
    ['required policy identity and targets', (envelope: { state: Record<string, unknown> }) => {
      const policies = envelope.state.policies as Record<string, unknown>[]
      policies[0] = { ...policies[0], id: 'pol-unrecognized', targetDeviceIds: ['dev-999'] }
    }],
    ['non-negative, consistent revisions and sequence', (envelope: { state: Record<string, unknown> }) => {
      envelope.state.stateRevision = -1
      envelope.state.sequence = 99
    }],
    ['well-formed, ordered audit events', (envelope: { state: Record<string, unknown> }) => {
      const audit = envelope.state.audit as Record<string, unknown>[]
      audit[0] = { ...audit[0], id: 'not-an-audit-id', stateRevision: 999, at: -1 }
    }],
    ['a stage bound to the current configuration revision', (envelope: { state: Record<string, unknown> }) => {
      const stagedChange = envelope.state.stagedChange as Record<string, unknown>
      stagedChange.baseConfigRevision = 0
    }],
    ['rollback data that corresponds to an applied change', (envelope: { state: Record<string, unknown> }) => {
      envelope.state.rollbackPoint = { appliedChangeId: 'change-999999', policies: envelope.state.policies }
    }],
  ])('resets a semantically corrupt envelope: %s', (_label, corrupt) => {
    const storage = new MemoryStorage()
    const envelope = persistedStage()
    corrupt(envelope)
    storage.setItem(STORAGE_KEY, JSON.stringify(envelope))

    const store = createStagedOpsStore({ storage })

    expect(store.getSnapshot()).toMatchObject({ stateRevision: 1, configRevision: 1, sequence: 0, stagedChange: null, rollbackPoint: null, audit: [] })
  })

  it('publishes a new invalid authorization snapshot exactly when authorization expires', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    try {
      const store = createStagedOpsStore({ storage: new MemoryStorage() })
      const staged = stagePolicyChange(store, rapidUpdate)
      if (!staged.ok) throw new Error('stage should succeed')
      const authorized = authorizeStagedChange(store, { stagedChangeId: staged.data.id })
      if (!authorized.ok) throw new Error('authorization should succeed')
      const snapshots: boolean[] = []
      const unsubscribe = store.subscribe(() => snapshots.push(store.getSnapshot().authorization?.valid ?? false))

      vi.advanceTimersByTime(300_000)

      expect(store.getSnapshot().authorization).toMatchObject({ id: authorized.data.id, valid: false })
      expect(snapshots).toEqual([false])
      unsubscribe()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not publish a partial state when persistence fails', () => {
    class FailingStorage extends MemoryStorage {
      override setItem(): never { throw new Error('quota exceeded') }
    }
    const store = createStagedOpsStore({ storage: new FailingStorage() })
    const before = store.getSnapshot()

    const result = stagePolicyChange(store, rapidUpdate)

    expect(result).toMatchObject({ ok: false, error: { code: 'PERSISTENCE_FAILED' } })
    expect(store.getSnapshot()).toEqual(before)
  })
})
