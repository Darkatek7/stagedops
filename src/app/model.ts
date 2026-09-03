import type { Department, Device, FleetEvaluation, Ring } from '../domain/stagedOps'

export type ViewName = 'overview' | 'devices' | 'policies' | 'audit'
export type DeviceStatus = 'ALL' | 'POLICY_CONFLICT' | 'OS_VERSION_BLOCKED' | 'COMPLIANT'

export interface DeviceFilters {
  readonly query: string
  readonly departments: readonly Department[]
  readonly rings: readonly Ring[]
  readonly statuses: readonly Exclude<DeviceStatus, 'ALL'>[]
}

export const emptyDeviceFilters: DeviceFilters = {
  query: '',
  departments: [],
  rings: [],
  statuses: [],
}

export function statusForDevice(device: Device, evaluation: FleetEvaluation): Exclude<DeviceStatus, 'ALL'> {
  if (evaluation.conflictDeviceIds.includes(device.id)) return 'POLICY_CONFLICT'
  if (evaluation.osBlockers.some((blocker) => blocker.id === device.id)) return 'OS_VERSION_BLOCKED'
  return 'COMPLIANT'
}

export function effectiveDeadlineForDevice(device: Device, evaluation: FleetEvaluation, rapidDeadlineDays: number) {
  return evaluation.conflictDeviceIds.includes(device.id) ? 'Conflict' : `${rapidDeadlineDays} days`
}

export function statusLabel(status: Exclude<DeviceStatus, 'ALL'>) {
  if (status === 'OS_VERSION_BLOCKED') return 'OS prerequisite blocked'
  if (status === 'POLICY_CONFLICT') return 'Policy conflict'
  return 'Compliant'
}

export function agentToolName(result: unknown): string | null {
  if (typeof result !== 'object' || result === null || !('tool' in result) || typeof result.tool !== 'string') return null
  return result.tool
}

export function agentSummary(result: unknown): string | null {
  if (typeof result !== 'object' || result === null || !('summary' in result) || typeof result.summary !== 'string') return null
  return result.summary
}

export function filtersFromAgent(value: unknown): Partial<DeviceFilters> | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const departments = Array.isArray(record.departments) ? record.departments : []
  const rings = Array.isArray(record.rings) ? record.rings : []
  const statuses = Array.isArray(record.statuses) ? record.statuses : []
  return {
    query: typeof record.query === 'string' ? record.query : '',
    departments: departments.filter((item): item is Department => item === 'Engineering' || item === 'Finance' || item === 'Operations' || item === 'Sales' || item === 'Support'),
    rings: rings.filter((item): item is Ring => item === 'Pilot' || item === 'Staging' || item === 'Production'),
    statuses: statuses.filter((item): item is Exclude<DeviceStatus, 'ALL'> => item === 'POLICY_CONFLICT' || item === 'OS_VERSION_BLOCKED' || item === 'COMPLIANT'),
  }
}
