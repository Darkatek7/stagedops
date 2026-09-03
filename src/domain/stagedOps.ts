export const STORAGE_KEY = 'stagedops.demo.v1'
const ENVELOPE_VERSION = 1
const AUTHORIZATION_TTL_MS = 5 * 60 * 1000

export type Department = 'Engineering' | 'Finance' | 'Operations' | 'Sales' | 'Support'
export type Ring = 'Pilot' | 'Staging' | 'Production'
export type Actor = 'Human' | 'Agent'

export interface Device {
  readonly id: string
  readonly name: string
  readonly department: Department
  readonly ring: Ring
  readonly osVersion: string
}

export interface Policy {
  readonly id: string
  readonly name: string
  readonly targetDeviceIds: readonly string[]
  readonly updates: { readonly restartDeadlineDays: number }
}

export interface StagedChange {
  readonly id: string
  readonly policyId: string
  readonly restartDeadlineDays: number
  readonly baseConfigRevision: number
  readonly createdAt: number
}

export interface AuditEvent {
  readonly id: string
  readonly action: 'stage' | 'authorize' | 'apply' | 'rollback' | 'reset'
  readonly actor: Actor
  readonly at: number
  readonly stateRevision: number
  readonly configRevision: number
  readonly detail: string
}

interface RollbackPoint {
  readonly policies: readonly Policy[]
  readonly appliedChangeId: string
}

interface PersistentState {
  readonly stateRevision: number
  readonly configRevision: number
  readonly devices: readonly Device[]
  readonly policies: readonly Policy[]
  readonly stagedChange: StagedChange | null
  readonly rollbackPoint: RollbackPoint | null
  readonly audit: readonly AuditEvent[]
  readonly sequence: number
}

interface PersistedEnvelope {
  readonly version: number
  readonly state: PersistentState
}

interface Authorization {
  readonly id: string
  readonly stagedChangeId: string
  readonly configRevision: number
  readonly expiresAt: number
  readonly used: boolean
}

export interface AuthorizationStatus {
  readonly id: string
  readonly stagedChangeId: string
  readonly expiresAt: number
  readonly valid: boolean
}

export interface StoreSnapshot extends PersistentState {
  readonly authorization: AuthorizationStatus | null
}

export interface StorageAdapter {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface StagedOpsStore {
  getSnapshot(): StoreSnapshot
  subscribe(listener: () => void): () => void
}

export interface StoreOptions {
  readonly storage?: StorageAdapter
  readonly now?: () => number
}

type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'PERSISTENCE_FAILED'
  | 'NO_STAGED_CHANGE'
  | 'AUTHORIZATION_REQUIRED'
  | 'AUTHORIZATION_EXPIRED'
  | 'AUTHORIZATION_MISMATCH'
  | 'NO_ROLLBACK_POINT'

export type CommandResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: { readonly code: ErrorCode; readonly message: string } }

export interface FleetSummary {
  readonly totalDevices: number
  readonly compliantDevices: number
  readonly compliancePercent: number
  readonly conflictCount: number
  readonly conflictDeviceIds: readonly string[]
  readonly departments: readonly { readonly name: Department; readonly total: number; readonly compliant: number }[]
}

export interface Simulation {
  readonly before: Pick<FleetSummary, 'compliantDevices' | 'conflictCount' | 'compliancePercent'>
  readonly after: Pick<FleetSummary, 'compliantDevices' | 'conflictCount' | 'compliancePercent'>
  readonly resolvedDeviceIds: readonly string[]
  readonly osBlockers: readonly Device[]
}

const departments: readonly Department[] = ['Engineering', 'Finance', 'Operations', 'Sales', 'Support']
const conflictDeviceIds = ['dev-021', 'dev-022', 'dev-023', 'dev-024', 'dev-033', 'dev-034', 'dev-035', 'dev-036', 'dev-045', 'dev-046', 'dev-047', 'dev-048']

function browserStorage(): StorageAdapter | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage
}

function deviceId(index: number) { return `dev-${String(index).padStart(3, '0')}` }

export function createSeedDevices(): readonly Device[] {
  return departments.flatMap((department, departmentIndex) => Array.from({ length: 12 }, (_, offset) => {
    const index = departmentIndex * 12 + offset + 1
    const ring: Ring = offset < 2 ? 'Pilot' : offset < 8 ? 'Staging' : 'Production'
    const id = deviceId(index)
    return freeze({ id, name: `${department.slice(0, 3).toUpperCase()}-${String(offset + 1).padStart(2, '0')}`, department, ring, osVersion: id === 'dev-035' || id === 'dev-036' ? '11.2' : '12.4' })
  }))
}

const seedDevices = createSeedDevices()

function initialPolicies(): readonly Policy[] {
  return freeze([
    freeze({ id: 'pol-standard-update-window', name: 'Standard update window', targetDeviceIds: freeze([...conflictDeviceIds]), updates: freeze({ restartDeadlineDays: 7 }) }),
    freeze({ id: 'pol-rapid-update-enforcement', name: 'Rapid update enforcement', targetDeviceIds: freeze([...conflictDeviceIds]), updates: freeze({ restartDeadlineDays: 2 }) }),
  ])
}

function initialState(): PersistentState {
  return freeze({ stateRevision: 1, configRevision: 1, devices: seedDevices, policies: initialPolicies(), stagedChange: null, rollbackPoint: null, audit: freeze([]), sequence: 0 })
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value as object).forEach(freeze)
    Object.freeze(value)
  }
  return value
}

function clone<T>(value: T): T { return structuredClone(value) }

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function isPositiveInteger(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 }
function isNonNegativeFiniteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 }
function hasExactValues(values: readonly string[], expected: readonly string[]): boolean { return values.length === expected.length && values.every((value, index) => value === expected[index]) }
function isDevice(value: unknown): value is Device {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' && departments.includes(value.department as Department)
    && (value.ring === 'Pilot' || value.ring === 'Staging' || value.ring === 'Production') && typeof value.osVersion === 'string'
}
function hasExactDevices(devices: readonly Device[], expected: readonly Device[]): boolean {
  return devices.length === expected.length && devices.every((device, index) => {
    const seed = expected[index]
    return device.id === seed.id && device.name === seed.name && device.department === seed.department && device.ring === seed.ring && device.osVersion === seed.osVersion
  })
}
function expectedPolicyName(id: string): string | undefined {
  if (id === 'pol-standard-update-window') return 'Standard update window'
  if (id === 'pol-rapid-update-enforcement') return 'Rapid update enforcement'
  return undefined
}
function isPolicy(value: unknown): value is Policy {
  if (!isRecord(value) || typeof value.id !== 'string' || value.name !== expectedPolicyName(value.id) || !Array.isArray(value.targetDeviceIds)
    || !value.targetDeviceIds.every((id) => typeof id === 'string') || !hasExactValues(value.targetDeviceIds, conflictDeviceIds) || !isRecord(value.updates)) return false
  return isPositiveInteger(value.updates.restartDeadlineDays) && value.updates.restartDeadlineDays <= 30
}
function isStagedChange(value: unknown): value is StagedChange {
  return isRecord(value) && typeof value.id === 'string' && /^change-\d{6}$/.test(value.id) && typeof value.policyId === 'string'
    && expectedPolicyName(value.policyId) !== undefined && isPositiveInteger(value.restartDeadlineDays) && value.restartDeadlineDays <= 30
    && isPositiveInteger(value.baseConfigRevision) && isNonNegativeFiniteNumber(value.createdAt)
}
function isAuditEvent(value: unknown): value is AuditEvent {
  return isRecord(value) && typeof value.id === 'string' && /^audit-\d{6}$/.test(value.id) && ['stage', 'authorize', 'apply', 'rollback', 'reset'].includes(String(value.action))
    && (value.actor === 'Human' || value.actor === 'Agent') && isNonNegativeFiniteNumber(value.at) && isPositiveInteger(value.stateRevision)
    && isPositiveInteger(value.configRevision) && typeof value.detail === 'string' && value.detail.length > 0
}
function isRollbackPoint(value: unknown): value is RollbackPoint {
  return isRecord(value) && Array.isArray(value.policies) && value.policies.length === 2 && value.policies.every(isPolicy) && typeof value.appliedChangeId === 'string' && /^change-\d{6}$/.test(value.appliedChangeId)
}
function hasExactPolicies(policies: readonly Policy[], expected: readonly Policy[]): boolean {
  return policies.length === expected.length && policies.every((policy, index) => {
    const expectedPolicy = expected[index]
    return policy.id === expectedPolicy.id && policy.name === expectedPolicy.name && hasExactValues(policy.targetDeviceIds, expectedPolicy.targetDeviceIds)
      && policy.updates.restartDeadlineDays === expectedPolicy.updates.restartDeadlineDays
  })
}
function sameStage(actual: StagedChange | null, expected: StagedChange | null): boolean {
  return actual === expected || (actual !== null && expected !== null && actual.id === expected.id && actual.policyId === expected.policyId
    && actual.restartDeadlineDays === expected.restartDeadlineDays && actual.baseConfigRevision === expected.baseConfigRevision)
}
function sameRollbackPoint(actual: RollbackPoint | null, expected: RollbackPoint | null): boolean {
  return actual === expected || (actual !== null && expected !== null && actual.appliedChangeId === expected.appliedChangeId && hasExactPolicies(actual.policies, expected.policies))
}

function validState(value: unknown): value is PersistentState {
  if (!isRecord(value)) return false
  const state = value as Record<string, unknown>
  const { stateRevision, configRevision: persistedConfigRevision, sequence, devices, policies, audit, stagedChange, rollbackPoint } = state
  if (!isPositiveInteger(stateRevision) || !isPositiveInteger(persistedConfigRevision) || typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0
    || stateRevision !== sequence + 1 || !Array.isArray(devices) || !devices.every(isDevice) || !hasExactDevices(devices, seedDevices)
    || !Array.isArray(policies) || policies.length !== 2 || !policies.every(isPolicy)
    || !hasExactValues(policies.map((policy) => policy.id), ['pol-standard-update-window', 'pol-rapid-update-enforcement'])
    || !Array.isArray(audit) || audit.length !== sequence || !audit.every(isAuditEvent)
    || (stagedChange !== null && !isStagedChange(stagedChange)) || (rollbackPoint !== null && !isRollbackPoint(rollbackPoint))) return false

  const baselinePolicies = initialPolicies()
  const appliedPolicies = changedPolicies({ policies: baselinePolicies }, 'pol-rapid-update-enforcement', 7)
  let expectedPolicies = baselinePolicies
  let expectedStage: StagedChange | null = null
  let expectedRollback: RollbackPoint | null = null
  let authorizedStageId: string | null = null
  let configRevision = 1
  let previousAt = 0
  for (const [index, event] of audit.entries()) {
    const sequence = index + 1
    if (event.id !== `audit-${String(sequence).padStart(6, '0')}` || event.stateRevision !== sequence + 1 || event.at < previousAt) return false
    const changesConfiguration = event.action === 'apply' || event.action === 'rollback' || event.action === 'reset'
    configRevision += changesConfiguration ? 1 : 0
    if (event.configRevision !== configRevision) return false
    previousAt = event.at

    if (event.action === 'stage') {
      if (event.actor !== 'Human' || event.detail !== 'Staged pol-rapid-update-enforcement' || !hasExactPolicies(expectedPolicies, baselinePolicies)) return false
      expectedStage = { id: `change-${String(sequence).padStart(6, '0')}`, policyId: 'pol-rapid-update-enforcement', restartDeadlineDays: 7, baseConfigRevision: configRevision, createdAt: event.at }
      authorizedStageId = null
    } else if (event.action === 'authorize') {
      if (event.actor !== 'Human' || !expectedStage || event.detail !== `Authorized ${expectedStage.id}`) return false
      authorizedStageId = expectedStage.id
    } else if (event.action === 'apply') {
      if (!expectedStage || authorizedStageId !== expectedStage.id || event.detail !== `Applied ${expectedStage.id}` || !hasExactPolicies(expectedPolicies, baselinePolicies)) return false
      expectedPolicies = appliedPolicies
      expectedRollback = { policies: baselinePolicies, appliedChangeId: expectedStage.id }
      expectedStage = null
      authorizedStageId = null
    } else if (event.action === 'rollback') {
      if (!expectedRollback || event.detail !== `Restored ${expectedRollback.appliedChangeId}` || !hasExactPolicies(expectedPolicies, appliedPolicies)) return false
      expectedPolicies = baselinePolicies
      expectedRollback = null
      expectedStage = null
      authorizedStageId = null
    } else if (event.action === 'reset') {
      if (event.actor !== 'Human' || event.detail !== 'Reset deterministic demo') return false
      expectedPolicies = baselinePolicies
      expectedStage = null
      expectedRollback = null
      authorizedStageId = null
    }
  }
  if (persistedConfigRevision !== configRevision) return false
  return hasExactPolicies(policies, expectedPolicies) && sameStage(stagedChange, expectedStage) && sameRollbackPoint(rollbackPoint, expectedRollback)
}

function hydrate(storage: StorageAdapter | undefined): PersistentState {
  if (!storage) return initialState()
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return initialState()
    const envelope: unknown = JSON.parse(raw)
    if (typeof envelope === 'object' && envelope !== null && (envelope as PersistedEnvelope).version === ENVELOPE_VERSION && validState((envelope as PersistedEnvelope).state)) return freeze(clone((envelope as PersistedEnvelope).state))
  } catch { /* invalid persisted data intentionally falls through to a seed */ }
  const seed = initialState()
  try { storage.setItem(STORAGE_KEY, JSON.stringify({ version: ENVELOPE_VERSION, state: seed })) } catch { /* usable in-memory recovery */ }
  return seed
}

function evaluate(policies: readonly Policy[]): { readonly conflicts: readonly string[]; readonly compliant: readonly string[]; readonly osBlockers: readonly Device[] } {
  const standard = policies.find((policy) => policy.id === 'pol-standard-update-window')
  const rapid = policies.find((policy) => policy.id === 'pol-rapid-update-enforcement')
  const conflicts = seedDevices.filter((device) => standard?.targetDeviceIds.includes(device.id) && rapid?.targetDeviceIds.includes(device.id) && standard.updates.restartDeadlineDays !== rapid.updates.restartDeadlineDays).map((device) => device.id)
  const osBlockers = seedDevices.filter((device) => Number(device.osVersion) < 12)
  const noncompliant = new Set([...conflicts, ...osBlockers.map((device) => device.id)])
  return freeze({ conflicts: freeze(conflicts), compliant: freeze(seedDevices.filter((device) => !noncompliant.has(device.id)).map((device) => device.id)), osBlockers: freeze(osBlockers) })
}

function summaryFor(policies: readonly Policy[]): FleetSummary {
  const evaluation = evaluate(policies)
  return freeze({
    totalDevices: seedDevices.length,
    compliantDevices: evaluation.compliant.length,
    compliancePercent: Number((evaluation.compliant.length / seedDevices.length * 100).toFixed(1)),
    conflictCount: evaluation.conflicts.length,
    conflictDeviceIds: evaluation.conflicts,
    departments: freeze(departments.map((name) => {
      const devices = seedDevices.filter((device) => device.department === name)
      return freeze({ name, total: devices.length, compliant: devices.filter((device) => evaluation.compliant.includes(device.id)).length })
    })),
  })
}

function error(code: ErrorCode, message: string): CommandResult<never> { return { ok: false, error: { code, message } } }

export function createStagedOpsStore(options: StoreOptions = {}): StagedOpsStore {
  const storage = options.storage ?? browserStorage()
  const now = options.now ?? Date.now
  let state = hydrate(storage)
  let authorization: Authorization | null = null
  let authorizationExpiryTimer: ReturnType<typeof setTimeout> | null = null
  let snapshot = makeSnapshot()
  const listeners = new Set<() => void>()
  const simulationCache = new Map<string, Simulation>()

  function authorizationStatus(): AuthorizationStatus | null {
    if (!authorization || authorization.used) return null
    return freeze({ id: authorization.id, stagedChangeId: authorization.stagedChangeId, expiresAt: authorization.expiresAt, valid: now() < authorization.expiresAt && state.stagedChange?.id === authorization.stagedChangeId && state.configRevision === authorization.configRevision })
  }
  function makeSnapshot(): StoreSnapshot { return freeze({ ...state, authorization: authorizationStatus() }) }
  function publish() { snapshot = makeSnapshot(); listeners.forEach((listener) => listener()) }
  function clearAuthorizationExpiry() {
    if (authorizationExpiryTimer !== null) clearTimeout(authorizationExpiryTimer)
    authorizationExpiryTimer = null
  }
  function setAuthorization(next: Authorization | null) {
    clearAuthorizationExpiry()
    authorization = next
    if (next && !next.used) {
      const authorizationId = next.id
      authorizationExpiryTimer = setTimeout(() => {
        authorizationExpiryTimer = null
        if (authorization?.id === authorizationId && !authorization.used && now() >= authorization.expiresAt) publish()
      }, Math.max(0, next.expiresAt - now()))
    }
    publish()
  }
  function invalidateAuthorization() {
    clearAuthorizationExpiry()
    publish()
  }
  function persist(next: PersistentState): CommandResult<null> {
    try { storage?.setItem(STORAGE_KEY, JSON.stringify({ version: ENVELOPE_VERSION, state: next })) } catch { return error('PERSISTENCE_FAILED', 'The change could not be saved locally.') }
    state = freeze(next)
    simulationCache.clear()
    publish()
    return { ok: true, data: null }
  }
  function transition(change: Omit<AuditEvent, 'id' | 'at' | 'stateRevision' | 'configRevision'>, mutate: (previous: PersistentState) => Omit<PersistentState, 'stateRevision' | 'audit' | 'sequence'>): CommandResult<PersistentState> {
    const partial = mutate(state)
    const sequence = state.sequence + 1
    const next = freeze({ ...partial, stateRevision: state.stateRevision + 1, sequence, audit: freeze([...state.audit, freeze({ ...change, id: `audit-${String(sequence).padStart(6, '0')}`, at: now(), stateRevision: state.stateRevision + 1, configRevision: partial.configRevision })] ) })
    const saved = persist(next)
    return saved.ok ? { ok: true, data: next } : saved
  }
  const store: StagedOpsStore = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
  }
  Object.assign(store, { __internal: { now, transition, getState: () => state, getAuthorization: () => authorization, setAuthorization, invalidateAuthorization, simulationCache } })
  return store
}

type InternalStore = StagedOpsStore & { __internal: { now: () => number; transition: (change: Omit<AuditEvent, 'id' | 'at' | 'stateRevision' | 'configRevision'>, mutate: (previous: PersistentState) => Omit<PersistentState, 'stateRevision' | 'audit' | 'sequence'>) => CommandResult<PersistentState>; getState: () => PersistentState; getAuthorization: () => Authorization | null; setAuthorization: (next: Authorization | null) => void; invalidateAuthorization: () => void; simulationCache: Map<string, Simulation> } }
function internal(store: StagedOpsStore): InternalStore { return store as InternalStore }

export function getFleetSummary(store: StagedOpsStore): FleetSummary { return summaryFor(internal(store).__internal.getState().policies) }
export function getDevices(): readonly Device[] { return seedDevices }
export function getPolicies(store: StagedOpsStore): readonly Policy[] { return internal(store).__internal.getState().policies }
export function getStagedChange(store: StagedOpsStore): StagedChange | null { return internal(store).__internal.getState().stagedChange }
export function getAuditLog(store: StagedOpsStore): readonly AuditEvent[] { return internal(store).__internal.getState().audit }

function changedPolicies(state: Pick<PersistentState, 'policies'>, policyId: string, restartDeadlineDays: number): readonly Policy[] {
  return freeze(state.policies.map((policy) => policy.id === policyId ? freeze({ ...policy, updates: freeze({ restartDeadlineDays }) }) : policy))
}

function validateChange(state: PersistentState, input: { policyId: string; restartDeadlineDays: number }): CommandResult<null> {
  if (input.policyId !== 'pol-rapid-update-enforcement' || input.restartDeadlineDays !== 7 || !hasExactPolicies(state.policies, initialPolicies())) return error('VALIDATION_ERROR', 'The requested policy change is not an approved deterministic simulation.')
  return { ok: true, data: null }
}

export function simulatePolicyChange(store: StagedOpsStore, input: { policyId: string; restartDeadlineDays: number }): Simulation {
  const engine = internal(store).__internal
  const key = `${engine.getState().configRevision}:${input.policyId}:${input.restartDeadlineDays}`
  const cached = engine.simulationCache.get(key)
  if (cached) return cached
  const state = engine.getState()
  const validation = validateChange(state, input)
  if (!validation.ok) throw new Error(validation.error.message)
  const before = summaryFor(state.policies)
  const afterPolicies = changedPolicies(state, input.policyId, input.restartDeadlineDays)
  const after = summaryFor(afterPolicies)
  const beforeConflicts = new Set(before.conflictDeviceIds)
  const result = freeze({
    before: freeze({ compliantDevices: before.compliantDevices, conflictCount: before.conflictCount, compliancePercent: before.compliancePercent }),
    after: freeze({ compliantDevices: after.compliantDevices, conflictCount: after.conflictCount, compliancePercent: after.compliancePercent }),
    resolvedDeviceIds: freeze(after.conflictDeviceIds.length === 0 ? [...beforeConflicts].filter((id) => !['dev-035', 'dev-036'].includes(id)) : []),
    osBlockers: evaluate(afterPolicies).osBlockers,
  })
  engine.simulationCache.set(key, result)
  return result
}

export function stagePolicyChange(store: StagedOpsStore, input: { policyId: string; restartDeadlineDays: number }): CommandResult<StagedChange> {
  const engine = internal(store).__internal
  const current = engine.getState()
  const validation = validateChange(current, input)
  if (!validation.ok) return validation
  const id = `change-${String(current.sequence + 1).padStart(6, '0')}`
  const staged = freeze({ id, ...input, baseConfigRevision: current.configRevision, createdAt: engine.now() })
  const result = engine.transition({ action: 'stage', actor: 'Human', detail: `Staged ${input.policyId}` }, (previous) => ({ ...previous, stagedChange: staged, rollbackPoint: previous.rollbackPoint }))
  if (!result.ok) return result
  engine.invalidateAuthorization()
  return { ok: true, data: staged }
}

export function authorizeStagedChange(store: StagedOpsStore, input: { stagedChangeId: string }): CommandResult<AuthorizationStatus> {
  const engine = internal(store).__internal
  const staged = engine.getState().stagedChange
  if (!staged) return error('NO_STAGED_CHANGE', 'There is no staged change to authorize.')
  if (staged.id !== input.stagedChangeId) return error('AUTHORIZATION_MISMATCH', 'Authorization must target the active staged change.')
  const authorization = freeze({ id: `auth-${String(engine.getState().sequence + 1).padStart(6, '0')}`, stagedChangeId: staged.id, configRevision: engine.getState().configRevision, expiresAt: engine.now() + AUTHORIZATION_TTL_MS, used: false })
  const result = engine.transition({ action: 'authorize', actor: 'Human', detail: `Authorized ${staged.id}` }, (previous) => ({ ...previous, rollbackPoint: previous.rollbackPoint }))
  if (!result.ok) return result
  engine.setAuthorization(authorization)
  return { ok: true, data: { id: authorization.id, stagedChangeId: authorization.stagedChangeId, expiresAt: authorization.expiresAt, valid: true } }
}

export function applyStagedChange(store: StagedOpsStore, input: { actor: Actor; authorizationId?: string }): CommandResult<{ readonly compliancePercent: number }> {
  const engine = internal(store).__internal
  const state = engine.getState()
  const staged = state.stagedChange
  if (!staged) return error('NO_STAGED_CHANGE', 'There is no staged change to apply.')
  const authorization = engine.getAuthorization()
  if (!authorization || !input.authorizationId) return error('AUTHORIZATION_REQUIRED', 'A visible human authorization is required before applying.')
  if (engine.now() >= authorization.expiresAt) return error('AUTHORIZATION_EXPIRED', 'The authorization has expired.')
  if (authorization.used || authorization.id !== input.authorizationId || authorization.stagedChangeId !== staged.id || authorization.configRevision !== state.configRevision) return error('AUTHORIZATION_MISMATCH', 'Authorization does not match the active change and revision.')
  const policies = changedPolicies(state, staged.policyId, staged.restartDeadlineDays)
  const result = engine.transition({ action: 'apply', actor: input.actor, detail: `Applied ${staged.id}` }, (previous) => ({ ...previous, policies, configRevision: previous.configRevision + 1, stagedChange: null, rollbackPoint: freeze({ policies: previous.policies, appliedChangeId: staged.id }) }))
  if (!result.ok) return result
  engine.setAuthorization(freeze({ ...authorization, used: true }))
  return { ok: true, data: { compliancePercent: summaryFor(policies).compliancePercent } }
}

export function rollbackLastChange(store: StagedOpsStore, input: { actor: Actor }): CommandResult<null> {
  const engine = internal(store).__internal
  const state = engine.getState()
  if (!state.rollbackPoint) return error('NO_ROLLBACK_POINT', 'There is no applied change to roll back.')
  const result = engine.transition({ action: 'rollback', actor: input.actor, detail: `Restored ${state.rollbackPoint.appliedChangeId}` }, (previous) => ({ ...previous, policies: previous.rollbackPoint!.policies, configRevision: previous.configRevision + 1, stagedChange: null, rollbackPoint: null }))
  if (!result.ok) return result
  engine.setAuthorization(null)
  return { ok: true, data: null }
}

export function resetDemo(store: StagedOpsStore): CommandResult<null> {
  const engine = internal(store).__internal
  const result = engine.transition({ action: 'reset', actor: 'Human', detail: 'Reset deterministic demo' }, (previous) => ({ ...previous, policies: initialPolicies(), configRevision: previous.configRevision + 1, stagedChange: null, rollbackPoint: null }))
  if (!result.ok) return result
  engine.setAuthorization(null)
  return { ok: true, data: null }
}
