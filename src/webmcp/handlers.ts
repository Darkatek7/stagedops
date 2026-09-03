import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020'
import {
  applyStagedChange,
  getAuditLog,
  getDevices,
  getFleetEvaluation,
  getFleetSummary,
  getPolicies,
  getRollbackChangeId,
  rollbackLastChange,
  simulatePolicyChange,
  stagePolicyChange,
  type Department,
  type Device,
  type Ring,
  type StagedOpsStore,
} from '../domain/stagedOps'
import { agentContextStore as defaultAgentContextStore, type AgentContextStore } from '../state/agentContextStore'
import { toolNames, toolSchemas, type ToolName } from './schemas'

export type ErrorCode =
  | 'INVALID_INPUT' | 'NOT_FOUND' | 'STALE_STATE' | 'STALE_SIMULATION' | 'NO_EFFECT'
  | 'NO_STAGED_CHANGE' | 'STAGE_MISMATCH' | 'AUTHORIZATION_REQUIRED' | 'AUTHORIZATION_EXPIRED'
  | 'NO_ROLLBACK_AVAILABLE' | 'ROLLBACK_TARGET_MISMATCH' | 'ALREADY_ROLLED_BACK'
  | 'PERSISTENCE_FAILED' | 'ABORTED' | 'INTERNAL_ERROR'

interface ResultMeta {
  readonly requestId: string
  readonly datasetVersion: 'stagedops-demo-2026.09.03'
  readonly stateRevision: number
  readonly configRevision: number
  readonly timestamp: string
}

interface RecommendedNextStep {
  readonly kind: 'call_tool' | 'human_action' | 'complete'
  readonly tool: ToolName | null
  readonly message: string
}

export type ToolResult<T> =
  | { readonly ok: true; readonly tool: ToolName; readonly summary: string; readonly data: T; readonly recommendedNextStep: RecommendedNextStep; readonly meta: ResultMeta }
  | { readonly ok: false; readonly tool: ToolName; readonly summary: string; readonly error: { readonly code: ErrorCode; readonly message: string; readonly retryable: boolean; readonly issues: readonly { field: string; message: string }[] }; readonly recommendedNextStep: RecommendedNextStep; readonly meta: ResultMeta }

export interface InvocationOptions { readonly signal?: AbortSignal }
// WebMCP handlers intentionally expose heterogeneous, tool-specific JSON payloads through one indexed registry.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolHandler = (input: unknown, options?: InvocationOptions) => Promise<ToolResult<any>>
export type ToolHandlers = Record<ToolName, ToolHandler>

interface HandlerOptions {
  readonly store: StagedOpsStore
  readonly agentContext?: AgentContextStore
  readonly now?: () => number
}

type DeviceStatus = 'COMPLIANT' | 'POLICY_CONFLICT' | 'OS_VERSION_BLOCKED'

const ajv = new Ajv2020({ allErrors: true, strict: true })
const validators = Object.fromEntries(toolNames.map((name) => [name, ajv.compile(toolSchemas[name])])) as Record<ToolName, ValidateFunction>
const callTool = (tool: ToolName, message: string): RecommendedNextStep => ({ kind: 'call_tool', tool, message })
const humanAction = (message: string): RecommendedNextStep => ({ kind: 'human_action', tool: null, message })
const complete = (message: string): RecommendedNextStep => ({ kind: 'complete', tool: null, message })

function issuePath(error: ErrorObject): string {
  if (error.keyword === 'required') return String((error.params as { missingProperty: string }).missingProperty)
  if (error.keyword === 'additionalProperties') return String((error.params as { additionalProperty: string }).additionalProperty)
  return error.instancePath.replace(/^\//, '').replaceAll('/', '.') || '$'
}

export function createToolHandlers(options: HandlerOptions): ToolHandlers {
  const { store } = options
  const context = options.agentContext ?? defaultAgentContextStore
  const now = options.now ?? Date.now
  let requestSequence = 0

  const meta = (): ResultMeta => {
    const snapshot = store.getSnapshot()
    requestSequence += 1
    return {
      requestId: `req-${String(requestSequence).padStart(6, '0')}`,
      datasetVersion: 'stagedops-demo-2026.09.03',
      stateRevision: snapshot.stateRevision,
      configRevision: snapshot.configRevision,
      timestamp: new Date(now()).toISOString(),
    }
  }
  const success = <T>(tool: ToolName, summary: string, data: T, recommendedNextStep: RecommendedNextStep): ToolResult<T> => ({ ok: true, tool, summary, data, recommendedNextStep, meta: meta() })
  const failure = (tool: ToolName, code: ErrorCode, message: string, recommendedNextStep: RecommendedNextStep, issues: readonly { field: string; message: string }[] = [], retryable = false): ToolResult<never> => ({
    ok: false, tool, summary: message, error: { code, message, retryable, issues }, recommendedNextStep, meta: meta(),
  })
  const aborted = (tool: ToolName) => failure(tool, 'ABORTED', 'The tool call was cancelled before it completed.', complete('Retry the call when you are ready.'))
  const stale = (tool: ToolName) => failure(tool, 'STALE_STATE', 'The configuration revision changed. Refresh state and retry with the current revision.', callTool('get_fleet_summary', 'Refresh the fleet and configuration revision.'))
  const publish = <T>(result: ToolResult<T>, signals?: Parameters<AgentContextStore['publishResult']>[1]) => {
    context.publishResult(result, signals)
    return result
  }
  const run = async <T>(tool: ToolName, input: unknown, invocation: InvocationOptions | undefined, execute: (value: T) => ToolResult<unknown>): Promise<ToolResult<unknown>> => {
    if (invocation?.signal?.aborted) return publish(aborted(tool))
    const validate = validators[tool]
    if (!validate(input)) {
      return publish(failure(tool, 'INVALID_INPUT', 'The tool input does not match the required schema.', complete('Correct the listed input fields and retry.'), (validate.errors ?? []).map((error) => ({ field: issuePath(error), message: error.message ?? 'is invalid' }))))
    }
    try { return execute(input as T) } catch {
      return publish(failure(tool, 'INTERNAL_ERROR', 'The tool could not complete because of an unexpected internal error.', complete('Use the manual dashboard or retry the call.'), [], true))
    }
  }

  const evaluation = () => getFleetEvaluation(store)
  const statusFor = (device: Device): DeviceStatus => {
    const current = evaluation()
    if (current.conflictDeviceIds.includes(device.id)) return 'POLICY_CONFLICT'
    if (current.osBlockers.some((item) => item.id === device.id)) return 'OS_VERSION_BLOCKED'
    return 'COMPLIANT'
  }
  const deviceSummary = (device: Device) => ({ ...device, status: statusFor(device) })
  const stageImpact = () => ({ affectedCount: 12, resolvedCount: 10, blockerCount: 2, affectedDeviceIds: [...getFleetEvaluation(store).conflictDeviceIds], blockerDeviceIds: ['dev-035', 'dev-036'] })
  const domainFailure = (tool: ToolName, result: { error: { code: string; message: string } }): ToolResult<never> => {
    if (result.error.code === 'PERSISTENCE_FAILED') return failure(tool, 'PERSISTENCE_FAILED', result.error.message, humanAction('Retry locally or reset the demo.'), [], true)
    return failure(tool, 'INTERNAL_ERROR', result.error.message, complete('Refresh the dashboard and retry.'))
  }

  const handlers = {} as ToolHandlers

  handlers.get_fleet_summary = (input, invocation) => run('get_fleet_summary', input, invocation, () => {
    const summary = getFleetSummary(store)
    const current = evaluation()
    const snapshot = store.getSnapshot()
    const data = {
      totalDevices: summary.totalDevices,
      compliantDevices: summary.compliantDevices,
      compliancePercent: summary.compliancePercent,
      policyConflicts: { count: summary.conflictCount, deviceIds: [...summary.conflictDeviceIds] },
      osVersionBlockers: { count: current.osBlockers.length, deviceIds: current.osBlockers.map((device) => device.id) },
      departmentCounts: summary.departments,
      ringCounts: (['Pilot', 'Staging', 'Production'] as const).map((name) => ({ name, total: getDevices().filter((device) => device.ring === name).length })),
      activeStage: snapshot.stagedChange,
      authorizationValid: snapshot.authorization?.valid ?? false,
      rollbackAvailable: getRollbackChangeId(store) !== null,
    }
    return publish(success('get_fleet_summary', `${summary.compliantDevices} of ${summary.totalDevices} devices are compliant.`, data, summary.conflictCount > 0 ? callTool('explain_policy_conflicts', 'Explain the active policy conflicts.') : complete('The fleet has no policy conflicts.')))
  })

  handlers.find_devices = (input, invocation) => run('find_devices', input, invocation, (value: { query?: string; departments?: Department[]; rings?: Ring[]; statuses?: DeviceStatus[]; limit?: number; offset?: number }) => {
    const filters = {
      query: value.query?.trim().toLocaleLowerCase() ?? '',
      departments: value.departments ?? [], rings: value.rings ?? [], statuses: value.statuses ?? [],
    }
    const limit = value.limit ?? 20
    const offset = value.offset ?? 0
    const rank: Record<DeviceStatus, number> = { OS_VERSION_BLOCKED: 0, POLICY_CONFLICT: 0, COMPLIANT: 1 }
    const matches = getDevices().map(deviceSummary).filter((device) => {
      const haystack = `${device.id} ${device.name} ${device.department} ${device.ring} ${device.status}`.toLocaleLowerCase()
      return (!filters.query || haystack.includes(filters.query))
        && (!filters.departments.length || filters.departments.includes(device.department))
        && (!filters.rings.length || filters.rings.includes(device.ring))
        && (!filters.statuses.length || filters.statuses.includes(device.status))
    }).sort((left, right) => rank[left.status] - rank[right.status] || left.name.localeCompare(right.name))
    const data = { filters, totalMatches: matches.length, limit, offset, devices: matches.slice(offset, offset + limit) }
    return publish(success('find_devices', `Found ${matches.length} matching devices.`, data, matches.length ? callTool('inspect_device', 'Inspect a returned device for policy evidence.') : complete('Broaden the filters to find devices.')), { fleetFilters: { ...filters, limit, offset } })
  })

  handlers.inspect_device = (input, invocation) => run('inspect_device', input, invocation, (value: { deviceId: string }) => {
    const device = getDevices().find((item) => item.id === value.deviceId)
    if (!device) return publish(failure('inspect_device', 'NOT_FOUND', `Device ${value.deviceId} was not found.`, callTool('find_devices', 'Find an available device ID.')))
    const matchingPolicies = getPolicies(store).filter((policy) => policy.targetDeviceIds.includes(device.id))
    const settingEvidence = matchingPolicies.map((policy) => ({ policyId: policy.id, field: 'updates.restartDeadlineDays', value: policy.updates.restartDeadlineDays }))
    const uniqueValues = [...new Set(settingEvidence.map((evidence) => evidence.value))]
    const status = statusFor(device)
    const activeIssue = status === 'COMPLIANT' ? null : status === 'OS_VERSION_BLOCKED'
      ? { code: status, message: `OS ${device.osVersion} blocks the target policy behavior.` }
      : { code: status, message: 'Two matching policies set different restart deadlines.' }
    const data = { device, matchingPolicies, settingEvidence, status, activeIssue, effectiveValue: uniqueValues.length === 1 ? uniqueValues[0] : null }
    return publish(success('inspect_device', `${device.name} is ${status.toLocaleLowerCase().replaceAll('_', ' ')}.`, data, status === 'POLICY_CONFLICT' ? callTool('explain_policy_conflicts', 'Explain this device conflict.') : complete('Device inspection is complete.')), { selectedDeviceId: device.id, drawerOpen: true })
  })

  handlers.explain_policy_conflicts = (input, invocation) => run('explain_policy_conflicts', input, invocation, (value: { deviceIds?: string[] }) => {
    const conflicts = [...evaluation().conflictDeviceIds]
    const requested = value.deviceIds ?? conflicts
    const selected = requested.filter((id) => conflicts.includes(id))
    if (!selected.length) return publish(failure('explain_policy_conflicts', 'NO_EFFECT', 'None of the requested devices has an active policy conflict.', callTool('find_devices', 'Find devices with POLICY_CONFLICT status.')))
    const data = {
      rootCause: { field: 'updates.restartDeadlineDays', standardPolicyId: 'pol-standard-update-window', standardValue: 7, rapidPolicyId: 'pol-rapid-update-enforcement', rapidValue: 2 },
      deviceIds: selected,
      latentOsRisks: evaluation().osBlockers.filter((device) => selected.includes(device.id)),
      recommendedSimulationInput: { policyId: 'pol-rapid-update-enforcement', field: 'updates.restartDeadlineDays', proposedValue: 7, expectedConfigRevision: store.getSnapshot().configRevision },
    }
    return publish(success('explain_policy_conflicts', `${selected.length} devices share one restart-deadline conflict.`, data, callTool('simulate_policy_change', 'Simulate the exact recommended policy change.')), { selectedConflictDeviceIds: selected, drawerOpen: true })
  })

  handlers.simulate_policy_change = (input, invocation) => run('simulate_policy_change', input, invocation, (value: { expectedConfigRevision: number }) => {
    if (value.expectedConfigRevision !== store.getSnapshot().configRevision) return publish(stale('simulate_policy_change'))
    if (getPolicies(store).find((policy) => policy.id === 'pol-rapid-update-enforcement')?.updates.restartDeadlineDays === 7) {
      return publish(failure('simulate_policy_change', 'NO_EFFECT', 'The rapid-update restart deadline is already 7 days.', complete('No policy change is needed.')))
    }
    const simulation = simulatePolicyChange(store, { policyId: 'pol-rapid-update-enforcement', restartDeadlineDays: 7 })
    const affectedDeviceIds = [...getFleetEvaluation(store).conflictDeviceIds]
    const data = {
      simulationId: `sim-cfg${value.expectedConfigRevision}-production-restart-7d`, baseConfigRevision: value.expectedConfigRevision,
      policyId: 'pol-rapid-update-enforcement', field: 'updates.restartDeadlineDays', diff: { before: 2, after: 7 },
      before: simulation.before, after: simulation.after, affectedDeviceIds, resolvedDeviceIds: simulation.resolvedDeviceIds,
      blockers: simulation.osBlockers, risks: ['Two devices remain blocked by OS version 11.2.', 'Applying changes persistent policy state.'],
      rollbackStatement: 'The applied change can be restored exactly with rollback_last_change.',
    }
    return publish(success('simulate_policy_change', 'Simulation raises compliance from 48/60 to 58/60 without changing state.', data, callTool('stage_policy_change', 'Stage this simulation for visible human review.')), { simulation: data, drawerOpen: true })
  })

  handlers.stage_policy_change = (input, invocation) => run('stage_policy_change', input, invocation, (value: { simulationId: string; expectedConfigRevision: number }) => {
    const currentRevision = store.getSnapshot().configRevision
    if (value.expectedConfigRevision !== currentRevision) return publish(stale('stage_policy_change'))
    if (getPolicies(store).find((policy) => policy.id === 'pol-rapid-update-enforcement')?.updates.restartDeadlineDays === 7) {
      return publish(failure('stage_policy_change', 'NO_EFFECT', 'The rapid-update restart deadline is already 7 days.', complete('No policy change is available to stage.')))
    }
    if (value.simulationId !== `sim-cfg${currentRevision}-production-restart-7d`) return publish(failure('stage_policy_change', 'STALE_SIMULATION', 'The simulation does not match the current configuration revision.', callTool('simulate_policy_change', 'Run a fresh simulation for the current revision.')))
    if (invocation?.signal?.aborted) return publish(aborted('stage_policy_change'))
    const result = stagePolicyChange(store, { policyId: 'pol-rapid-update-enforcement', restartDeadlineDays: 7, actor: 'Agent' })
    if (!result.ok) return publish(domainFailure('stage_policy_change', result))
    const data = { stage: result.data, plan: { field: 'updates.restartDeadlineDays', before: 2, after: 7 }, impact: stageImpact(), authorizationValid: false, applyRegistered: false }
    return publish(success('stage_policy_change', `Staged ${result.data.id} for human review; no policy was applied.`, data, humanAction('Review the staged plan and explicitly authorize Apply in the dashboard.')), { drawerOpen: true })
  })

  handlers.get_staged_change = (input, invocation) => run('get_staged_change', input, invocation, () => {
    const snapshot = store.getSnapshot()
    const authorizationValid = snapshot.authorization?.valid ?? false
    const data = { activeStage: snapshot.stagedChange, authorization: snapshot.authorization, authorizationValid, applyRegistered: context.getSnapshot().applyRegistered }
    return publish(success('get_staged_change', snapshot.stagedChange ? `Stage ${snapshot.stagedChange.id} is awaiting completion.` : 'There is no active staged change.', data, snapshot.stagedChange ? (authorizationValid ? callTool('apply_staged_change', 'Apply the authorized staged change.') : humanAction('Review and authorize the staged plan in the dashboard.')) : callTool('simulate_policy_change', 'Simulate a policy change before staging.')))
  })

  handlers.apply_staged_change = (input, invocation) => run('apply_staged_change', input, invocation, (value: { stageId: string; expectedConfigRevision: number }) => {
    const snapshot = store.getSnapshot()
    const stage = snapshot.stagedChange
    if (!stage) return publish(failure('apply_staged_change', 'NO_STAGED_CHANGE', 'There is no staged change to apply.', callTool('get_staged_change', 'Refresh the active stage.')))
    if (!snapshot.authorization) return publish(failure('apply_staged_change', 'AUTHORIZATION_REQUIRED', 'Visible human authorization is required before applying.', humanAction('Authorize the active stage in the dashboard.')))
    if (!snapshot.authorization.valid || now() >= snapshot.authorization.expiresAt) return publish(failure('apply_staged_change', 'AUTHORIZATION_EXPIRED', 'The human authorization expired.', humanAction('Review and authorize the active stage again.')))
    if (value.stageId !== stage.id) return publish(failure('apply_staged_change', 'STAGE_MISMATCH', `The authorized active stage is ${stage.id}, not ${value.stageId}.`, callTool('get_staged_change', 'Refresh the active stage ID.')))
    if (value.expectedConfigRevision !== snapshot.configRevision || stage.baseConfigRevision !== snapshot.configRevision) return publish(stale('apply_staged_change'))
    if (invocation?.signal?.aborted) return publish(aborted('apply_staged_change'))
    const result = applyStagedChange(store, { actor: 'Agent', authorizationId: snapshot.authorization.id })
    if (!result.ok) {
      const mapped = result.error.code === 'AUTHORIZATION_REQUIRED' ? 'AUTHORIZATION_REQUIRED' : result.error.code === 'AUTHORIZATION_EXPIRED' ? 'AUTHORIZATION_EXPIRED' : result.error.code === 'PERSISTENCE_FAILED' ? 'PERSISTENCE_FAILED' : 'INTERNAL_ERROR'
      return publish(failure('apply_staged_change', mapped, result.error.message, humanAction('Refresh the stage and authorize again.'), [], mapped === 'PERSISTENCE_FAILED'))
    }
    const summary = getFleetSummary(store)
    const data = { changeId: stage.id, outcome: { compliantDevices: summary.compliantDevices, totalDevices: summary.totalDevices, compliancePercent: summary.compliancePercent, resolvedCount: 10, blockerCount: 2, blockerDeviceIds: ['dev-035', 'dev-036'] }, rollbackAvailable: true }
    return publish(success('apply_staged_change', 'Applied the authorized change atomically; 58 of 60 devices are compliant.', data, callTool('rollback_last_change', 'Rollback remains available if the outcome is not acceptable.')), { drawerOpen: true })
  })

  handlers.rollback_last_change = (input, invocation) => run('rollback_last_change', input, invocation, (value: { changeId: string; expectedConfigRevision: number }) => {
    const snapshot = store.getSnapshot()
    const rollbackId = getRollbackChangeId(store)
    if (!rollbackId) {
      const alreadyRolledBack = getAuditLog(store).at(-1)?.action === 'rollback'
      return publish(failure('rollback_last_change', alreadyRolledBack ? 'ALREADY_ROLLED_BACK' : 'NO_ROLLBACK_AVAILABLE', alreadyRolledBack ? 'The last applied change has already been rolled back.' : 'There is no applied change available to roll back.', complete('No rollback action is available.')))
    }
    if (value.changeId !== rollbackId) return publish(failure('rollback_last_change', 'ROLLBACK_TARGET_MISMATCH', `The rollback target is ${rollbackId}, not ${value.changeId}.`, callTool('get_fleet_summary', 'Refresh the current rollback target.')))
    if (value.expectedConfigRevision !== snapshot.configRevision) return publish(stale('rollback_last_change'))
    if (invocation?.signal?.aborted) return publish(aborted('rollback_last_change'))
    const result = rollbackLastChange(store, { actor: 'Agent' })
    if (!result.ok) return publish(domainFailure('rollback_last_change', result))
    const summary = getFleetSummary(store)
    const data = { rolledBackChangeId: rollbackId, outcome: { compliantDevices: summary.compliantDevices, totalDevices: summary.totalDevices, compliancePercent: summary.compliancePercent, policyConflictCount: summary.conflictCount }, auditRetained: true }
    return publish(success('rollback_last_change', 'Rolled back the last change; the prior 48/60 operational state is restored.', data, complete('Rollback completed and the audit trail was retained.')), { drawerOpen: true })
  })

  handlers.get_audit_log = (input, invocation) => run('get_audit_log', input, invocation, (value: { actors?: ('Human' | 'Agent')[]; actions?: string[]; beforeSequence?: number; limit?: number }) => {
    const limit = value.limit ?? 20
    const events = [...getAuditLog(store)].reverse().filter((event) => {
      const sequence = Number(event.id.slice('audit-'.length))
      return (!value.actors?.length || value.actors.includes(event.actor))
        && (!value.actions?.length || value.actions.includes(event.action))
        && (value.beforeSequence === undefined || sequence < value.beforeSequence)
    })
    const page = events.slice(0, limit).map((event) => ({ ...event, timestamp: new Date(event.at).toISOString(), sequence: Number(event.id.slice('audit-'.length)) }))
    const data = { events: page, limit, hasMore: events.length > page.length, nextBeforeSequence: events.length > page.length ? page.at(-1)?.sequence ?? null : null }
    return publish(success('get_audit_log', `Returned ${page.length} audit events newest first.`, data, complete('Audit review is complete.')))
  })

  return handlers
}
