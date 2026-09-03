export type ToolRegistrationStatus = 'unsupported' | 'registering' | 'available' | 'unavailable' | 'error'

export interface AgentContextSnapshot {
  readonly toolStatus: ToolRegistrationStatus
  readonly registeredCount: number
  readonly applyRegistered: boolean
  readonly latestResult: unknown
  readonly fleetFilters: unknown
  readonly selectedDeviceId: string | null
  readonly selectedConflictDeviceIds: readonly string[]
  readonly simulation: unknown
  readonly drawerOpen: boolean
}

type ResultSignals = Partial<Pick<AgentContextSnapshot, 'fleetFilters' | 'selectedDeviceId' | 'selectedConflictDeviceIds' | 'simulation' | 'drawerOpen'>>

export interface AgentContextStore {
  getSnapshot(): AgentContextSnapshot
  subscribe(listener: () => void): () => void
  setRegistration(status: ToolRegistrationStatus, registeredCount: number): void
  setApplyRegistered(registered: boolean): void
  publishResult(result: unknown, signals?: ResultSignals): void
}

const initialSnapshot: AgentContextSnapshot = Object.freeze({
  toolStatus: 'unsupported',
  registeredCount: 0,
  applyRegistered: false,
  latestResult: null,
  fleetFilters: null,
  selectedDeviceId: null,
  selectedConflictDeviceIds: Object.freeze([]),
  simulation: null,
  drawerOpen: false,
})

export function createAgentContextStore(): AgentContextStore {
  let snapshot = initialSnapshot
  const listeners = new Set<() => void>()
  const publish = (next: AgentContextSnapshot) => {
    snapshot = Object.freeze(next)
    listeners.forEach((listener) => listener())
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    setRegistration(toolStatus, registeredCount) { publish({ ...snapshot, toolStatus, registeredCount }) },
    setApplyRegistered(applyRegistered) { publish({ ...snapshot, applyRegistered }) },
    publishResult(latestResult, signals = {}) { publish({ ...snapshot, ...signals, latestResult }) },
  }
}

/** Transient agent-to-UI context; it is deliberately separate from persistent domain state. */
export const agentContextStore = createAgentContextStore()
