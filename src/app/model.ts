import type { Device, FleetEvaluation, Ring } from '../domain/stagedOps'

export type ViewName = 'overview' | 'devices' | 'policies' | 'audit'
export type DeviceStatus = 'ALL' | 'POLICY_CONFLICT' | 'OS_VERSION_BLOCKED' | 'COMPLIANT'

export interface DeviceFilters {
  readonly query: string
  readonly department: string
  readonly ring: Ring | ''
  readonly status: DeviceStatus
}

export const emptyDeviceFilters: DeviceFilters = {
  query: '',
  department: '',
  ring: '',
  status: 'ALL',
}

export function statusForDevice(device: Device, evaluation: FleetEvaluation): Exclude<DeviceStatus, 'ALL'> {
  if (evaluation.osBlockers.some((blocker) => blocker.id === device.id)) return 'OS_VERSION_BLOCKED'
  if (evaluation.conflictDeviceIds.includes(device.id)) return 'POLICY_CONFLICT'
  return 'COMPLIANT'
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
    department: typeof departments[0] === 'string' ? departments[0] : '',
    ring: rings[0] === 'Pilot' || rings[0] === 'Staging' || rings[0] === 'Production' ? rings[0] : '',
    status: statuses[0] === 'POLICY_CONFLICT' || statuses[0] === 'OS_VERSION_BLOCKED' || statuses[0] === 'COMPLIANT' ? statuses[0] : 'ALL',
  }
}
