import { describe, expect, it } from 'vitest'
import {
  authorizeStagedChange,
  createStagedOpsStore,
  getFleetSummary,
  type StorageAdapter,
} from '../domain/stagedOps'
import { createAgentContextStore } from '../state/agentContextStore'
import { createToolHandlers, type ToolResult } from './handlers'
import { toolNames } from './schemas'

class MemoryStorage implements StorageAdapter {
  readonly entries = new Map<string, string>()
  getItem(key: string) { return this.entries.get(key) ?? null }
  setItem(key: string, value: string) { this.entries.set(key, value) }
}

function fixture(now = 1_800_000_000_000) {
  const store = createStagedOpsStore({ storage: new MemoryStorage(), now: () => now })
  const agentContext = createAgentContextStore()
  return { store, agentContext, handlers: createToolHandlers({ store, agentContext, now: () => now }) }
}

async function stage(f = fixture()) {
  const simulated = await f.handlers.simulate_policy_change({
    policyId: 'pol-rapid-update-enforcement', field: 'updates.restartDeadlineDays', proposedValue: 7, expectedConfigRevision: 1,
  })
  if (!simulated.ok) throw new Error('simulation should succeed')
  const staged = await f.handlers.stage_policy_change({ simulationId: simulated.data.simulationId, expectedConfigRevision: 1 })
  if (!staged.ok) throw new Error('stage should succeed')
  return { ...f, staged }
}

describe('WebMCP tool handlers', () => {
  it('returns a runtime INVALID_INPUT envelope for every schema, including extra properties', async () => {
    const { handlers } = fixture()
    for (const name of toolNames) {
      const result = await handlers[name]({ unexpected: true })
      expect(result, name).toMatchObject({ ok: false, tool: name, error: { code: 'INVALID_INPUT', retryable: false } })
      expect(result.meta).toMatchObject({ datasetVersion: 'stagedops-demo-2026.09.03', stateRevision: 1, configRevision: 1 })
      expect(result.meta.requestId).toMatch(/^req-[0-9]{6}$/)
      expect(result.recommendedNextStep.message.length).toBeGreaterThan(0)
    }
  })

  it('returns ABORTED before validating malformed input when cancellation already happened', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await fixture().handlers.inspect_device(null, { signal: controller.signal })

    expect(result).toMatchObject({ ok: false, tool: 'inspect_device', error: { code: 'ABORTED', issues: [] } })
  })

  it('summarizes the fleet with separate conflict/blocker, scope, stage, auth, and rollback data', async () => {
    const result = await fixture().handlers.get_fleet_summary({})
    expect(result).toMatchObject({ ok: true, tool: 'get_fleet_summary', data: {
      totalDevices: 60, compliantDevices: 48, compliancePercent: 80,
      policyConflicts: { count: 12 }, osVersionBlockers: { count: 2, deviceIds: ['dev-035', 'dev-036'] },
      activeStage: null, authorizationValid: false, rollbackAvailable: false,
    } })
    if (result.ok) {
      expect(result.data.departmentCounts).toHaveLength(5)
      expect(result.data.ringCounts).toEqual([
        { name: 'Pilot', total: 10 }, { name: 'Staging', total: 30 }, { name: 'Production', total: 20 },
      ])
    }
  })

  it('finds normalized, paginated devices sorted attention-first then name', async () => {
    const result = await fixture().handlers.find_devices({ query: ' opE ', statuses: ['POLICY_CONFLICT'], limit: 3 })
    expect(result).toMatchObject({ ok: true, data: {
      filters: { query: 'ope', departments: [], rings: [], statuses: ['POLICY_CONFLICT'] }, totalMatches: 4, limit: 3, offset: 0,
    } })
    if (result.ok) {
      expect(result.data.devices.map((device: { id: string }) => device.id)).toEqual(['dev-033', 'dev-034', 'dev-035'])
      expect(result.data.devices[2]).toMatchObject({ status: 'POLICY_CONFLICT' })
    }
  })

  it('gives policy conflicts precedence over overlapping OS blockers at baseline', async () => {
    const { handlers } = fixture()

    expect(await handlers.inspect_device({ deviceId: 'dev-035' })).toMatchObject({ ok: true, data: {
      status: 'POLICY_CONFLICT', effectiveValue: null, activeIssue: { code: 'POLICY_CONFLICT' },
    } })
    expect(await handlers.find_devices({ statuses: ['OS_VERSION_BLOCKED'], limit: 60 })).toMatchObject({ ok: true, data: {
      totalMatches: 0, devices: [],
    } })
  })

  it('reports the latent OS blocker after authorized apply resolves the policy conflict', async () => {
    const f = await stage()
    const authorization = authorizeStagedChange(f.store, { stagedChangeId: f.staged.data.stage.id })
    if (!authorization.ok) throw new Error('authorization should succeed')
    expect(await f.handlers.apply_staged_change({ stageId: f.staged.data.stage.id, expectedConfigRevision: 1 })).toMatchObject({ ok: true })

    expect(await f.handlers.inspect_device({ deviceId: 'dev-035' })).toMatchObject({ ok: true, data: {
      status: 'OS_VERSION_BLOCKED', effectiveValue: 7, activeIssue: { code: 'OS_VERSION_BLOCKED' },
    } })
    const result = await f.handlers.find_devices({ statuses: ['OS_VERSION_BLOCKED'], limit: 60 })
    expect(result).toMatchObject({ ok: true, data: { totalMatches: 2 } })
    if (result.ok) expect(result.data.devices.map((device: { id: string }) => device.id)).toEqual(['dev-035', 'dev-036'])
  })

  it('inspects a device with matching policies, evidence, active issue, and effective value', async () => {
    const result = await fixture().handlers.inspect_device({ deviceId: 'dev-021' })
    expect(result).toMatchObject({ ok: true, data: {
      device: { id: 'dev-021' }, status: 'POLICY_CONFLICT', effectiveValue: null,
      activeIssue: { code: 'POLICY_CONFLICT' },
      settingEvidence: [
        { policyId: 'pol-standard-update-window', field: 'updates.restartDeadlineDays', value: 7 },
        { policyId: 'pol-rapid-update-enforcement', field: 'updates.restartDeadlineDays', value: 2 },
      ],
    } })
    if (result.ok) expect(result.data.matchingPolicies).toHaveLength(2)
  })

  it('explains the root cause, all defaults, values, latent risks, and exact next simulation input', async () => {
    const result = await fixture().handlers.explain_policy_conflicts({})
    expect(result).toMatchObject({ ok: true, data: {
      rootCause: { field: 'updates.restartDeadlineDays', standardValue: 7, rapidValue: 2 },
      latentOsRisks: [{ id: 'dev-035' }, { id: 'dev-036' }],
      recommendedSimulationInput: { policyId: 'pol-rapid-update-enforcement', field: 'updates.restartDeadlineDays', proposedValue: 7, expectedConfigRevision: 1 },
    } })
    if (result.ok) expect(result.data.deviceIds).toHaveLength(12)
  })

  it('simulates without state mutation and rejects stale revisions', async () => {
    const f = fixture()
    const input = { policyId: 'pol-rapid-update-enforcement', field: 'updates.restartDeadlineDays', proposedValue: 7, expectedConfigRevision: 1 }
    const result = await f.handlers.simulate_policy_change(input)
    expect(result).toMatchObject({ ok: true, data: {
      simulationId: 'sim-cfg1-production-restart-7d', baseConfigRevision: 1,
      diff: { before: 2, after: 7 }, before: { compliantDevices: 48 }, after: { compliantDevices: 58 },
      blockers: [{ id: 'dev-035' }, { id: 'dev-036' }],
    } })
    if (result.ok) {
      expect(result.data.affectedDeviceIds).toHaveLength(12)
      expect(result.data.resolvedDeviceIds).toHaveLength(10)
      expect(result.data.rollbackStatement).toContain('rollback')
    }
    expect(f.store.getSnapshot()).toMatchObject({ stateRevision: 1, configRevision: 1 })
    expect(await f.handlers.simulate_policy_change({ ...input, expectedConfigRevision: 0 })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } })
  })

  it('stages only the matching fresh simulation and exposes the full active plan', async () => {
    const f = fixture()
    expect(await f.handlers.stage_policy_change({ simulationId: 'sim-cfg0-production-restart-7d', expectedConfigRevision: 1 })).toMatchObject({ ok: false, error: { code: 'STALE_SIMULATION' } })

    const stagedFixture = await stage(f)
    expect(stagedFixture.staged).toMatchObject({ ok: true, data: {
      stage: { id: 'change-000001', policyId: 'pol-rapid-update-enforcement', restartDeadlineDays: 7, baseConfigRevision: 1 },
      impact: { affectedCount: 12, resolvedCount: 10, blockerCount: 2 },
      authorizationValid: false, applyRegistered: false,
    } })
    expect(getFleetSummary(f.store).compliantDevices).toBe(48)
    expect(await f.handlers.get_staged_change({})).toMatchObject({ ok: true, data: { activeStage: { id: 'change-000001' }, authorizationValid: false, applyRegistered: false } })
  })

  it('checks cancellation immediately and again before a mutating command', async () => {
    const f = fixture()
    const aborted = new AbortController()
    aborted.abort()
    expect(await f.handlers.get_fleet_summary({}, { signal: aborted.signal })).toMatchObject({ ok: false, error: { code: 'ABORTED' } })

    let reads = 0
    const flipsBeforeMutation = { get aborted() { reads += 1; return reads > 1 } } as AbortSignal
    expect(await f.handlers.stage_policy_change({ simulationId: 'sim-cfg1-production-restart-7d', expectedConfigRevision: 1 }, { signal: flipsBeforeMutation })).toMatchObject({ ok: false, error: { code: 'ABORTED' } })
    expect(f.store.getSnapshot().stagedChange).toBeNull()
  })

  it('defends apply independently with authorization, stage ID, and revision checks', async () => {
    const f = await stage()
    expect(await f.handlers.apply_staged_change({ stageId: f.staged.data.stage.id, expectedConfigRevision: 1 })).toMatchObject({ ok: false, error: { code: 'AUTHORIZATION_REQUIRED' } })

    const authorization = authorizeStagedChange(f.store, { stagedChangeId: f.staged.data.stage.id })
    if (!authorization.ok) throw new Error('authorization should succeed')
    expect(await f.handlers.apply_staged_change({ stageId: 'change-999999', expectedConfigRevision: 1 })).toMatchObject({ ok: false, error: { code: 'STAGE_MISMATCH' } })
    expect(await f.handlers.apply_staged_change({ stageId: f.staged.data.stage.id, expectedConfigRevision: 0 })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } })

    const applied = await f.handlers.apply_staged_change({ stageId: f.staged.data.stage.id, expectedConfigRevision: 1 })
    expect(applied).toMatchObject({ ok: true, data: { outcome: { compliantDevices: 58, totalDevices: 60, resolvedCount: 10, blockerCount: 2 }, rollbackAvailable: true, changeId: f.staged.data.stage.id } })
    expect(await f.handlers.simulate_policy_change({
      policyId: 'pol-rapid-update-enforcement', field: 'updates.restartDeadlineDays', proposedValue: 7, expectedConfigRevision: 2,
    })).toMatchObject({ ok: false, error: { code: 'NO_EFFECT' } })
    expect(await f.handlers.stage_policy_change({ simulationId: 'sim-cfg2-production-restart-7d', expectedConfigRevision: 2 })).toMatchObject({ ok: false, error: { code: 'NO_EFFECT' } })
  })

  it('treats a replaced-stage captured authorization as revoked inside apply', async () => {
    const f = await stage()
    const authorization = authorizeStagedChange(f.store, { stagedChangeId: f.staged.data.stage.id })
    if (!authorization.ok) throw new Error('authorization should succeed')
    const replacement = await f.handlers.stage_policy_change({ simulationId: 'sim-cfg1-production-restart-7d', expectedConfigRevision: 1 })
    if (!replacement.ok) throw new Error('replacement should succeed')

    expect(await f.handlers.apply_staged_change({ stageId: replacement.data.stage.id, expectedConfigRevision: 1 })).toMatchObject({ ok: false, error: { code: 'AUTHORIZATION_REQUIRED' } })
  })

  it('validates and rolls back only the last applied change while retaining audit history', async () => {
    const f = await stage()
    const authorization = authorizeStagedChange(f.store, { stagedChangeId: f.staged.data.stage.id })
    if (!authorization.ok) throw new Error('authorization should succeed')
    await f.handlers.apply_staged_change({ stageId: f.staged.data.stage.id, expectedConfigRevision: 1 })

    expect(await f.handlers.rollback_last_change({ changeId: 'change-999999', expectedConfigRevision: 2 })).toMatchObject({ ok: false, error: { code: 'ROLLBACK_TARGET_MISMATCH' } })
    expect(await f.handlers.rollback_last_change({ changeId: f.staged.data.stage.id, expectedConfigRevision: 1 })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } })
    const rolledBack = await f.handlers.rollback_last_change({ changeId: f.staged.data.stage.id, expectedConfigRevision: 2 })
    expect(rolledBack).toMatchObject({ ok: true, data: { outcome: { compliantDevices: 48, totalDevices: 60, policyConflictCount: 12 }, rolledBackChangeId: f.staged.data.stage.id } })
    const audit = await f.handlers.get_audit_log({ actors: ['Agent'], limit: 2 })
    expect(audit).toMatchObject({ ok: true, data: { limit: 2, events: [{ action: 'rollback' }, { action: 'apply' }] } })
  })

  it('publishes visible transient UI signals for searches, selection, conflicts, simulation, and drawer intent', async () => {
    const f = fixture()
    await f.handlers.find_devices({ departments: ['Finance'] })
    expect(f.agentContext.getSnapshot().fleetFilters).toMatchObject({ departments: ['Finance'], limit: 20, offset: 0 })
    await f.handlers.inspect_device({ deviceId: 'dev-021' })
    expect(f.agentContext.getSnapshot()).toMatchObject({ selectedDeviceId: 'dev-021', drawerOpen: true })
    await f.handlers.explain_policy_conflicts({ deviceIds: ['dev-021'] })
    expect(f.agentContext.getSnapshot().selectedConflictDeviceIds).toEqual(['dev-021'])
    await f.handlers.simulate_policy_change({ policyId: 'pol-rapid-update-enforcement', field: 'updates.restartDeadlineDays', proposedValue: 7, expectedConfigRevision: 1 })
    expect(f.agentContext.getSnapshot().simulation).toMatchObject({ simulationId: 'sim-cfg1-production-restart-7d' })
    expect((f.agentContext.getSnapshot().latestResult as ToolResult<unknown>).tool).toBe('simulate_policy_change')
  })
})
