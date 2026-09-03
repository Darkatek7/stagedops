import { ChevronLeft, ChevronRight, Laptop, Search, SlidersHorizontal, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Device, FleetEvaluation, Policy } from '../../domain/stagedOps'
import { emptyDeviceFilters, statusForDevice, statusLabel, type DeviceFilters, type DeviceStatus } from '../model'

interface DevicesViewProps {
  readonly devices: readonly Device[]
  readonly policies: readonly Policy[]
  readonly evaluation: FleetEvaluation
  readonly selectedDeviceId: string | null
  readonly externalFilters: Partial<DeviceFilters> | null
  readonly onInspect: (deviceId: string) => void
}

const statusRank: Record<Exclude<DeviceStatus, 'ALL'>, number> = {
  OS_VERSION_BLOCKED: 0,
  POLICY_CONFLICT: 1,
  COMPLIANT: 2,
}

function Status({ value }: { value: Exclude<DeviceStatus, 'ALL'> }) {
  return <span className={`device-status status-${value.toLowerCase()}`}><span aria-hidden="true" />{statusLabel(value)}</span>
}

function DeviceInspector({ device, policies, evaluation }: { device: Device; policies: readonly Policy[]; evaluation: FleetEvaluation }) {
  const matchingPolicies = policies.filter((policy) => policy.targetDeviceIds.includes(device.id))
  const status = statusForDevice(device, evaluation)
  return (
    <section className="surface device-inspector" role="region" aria-label="Device inspector">
      <div className="section-heading"><div><span className="eyebrow">Selected device</span><h2>{device.name}</h2></div><Status value={status} /></div>
      <dl className="inspector-grid">
        <div><dt>Device ID</dt><dd>{device.id}</dd></div>
        <div><dt>Department</dt><dd>{device.department}</dd></div>
        <div><dt>Deployment ring</dt><dd>{device.ring}</dd></div>
        <div><dt>Operating system</dt><dd>OS {device.osVersion}</dd></div>
      </dl>
      <div className="inspector-evidence">
        <h3>Policy evidence</h3>
        {matchingPolicies.length ? matchingPolicies.map((policy) => (
          <p key={policy.id}><span>{policy.name}</span><strong>{policy.updates.restartDeadlineDays} days</strong></p>
        )) : <p>No deadline policy is assigned to this device.</p>}
      </div>
    </section>
  )
}

export function DevicesView({ devices, policies, evaluation, selectedDeviceId, externalFilters, onInspect }: DevicesViewProps) {
  const [filters, setFilters] = useState<DeviceFilters>(emptyDeviceFilters)
  const [pageSize, setPageSize] = useState(15)
  const [page, setPage] = useState(0)
  const [sortDirection, setSortDirection] = useState<'ascending' | 'descending'>('ascending')
  const [appliedExternalFilters, setAppliedExternalFilters] = useState<Partial<DeviceFilters> | null>(externalFilters)

  if (externalFilters !== appliedExternalFilters) {
    setAppliedExternalFilters(externalFilters)
    if (externalFilters) setFilters((current) => ({ ...current, ...externalFilters }))
    setPage(0)
  }

  const filtered = useMemo(() => {
    const query = filters.query.trim().toLocaleLowerCase()
    return devices.filter((device) => {
      const status = statusForDevice(device, evaluation)
      return (!query || device.id.toLocaleLowerCase().includes(query) || device.name.toLocaleLowerCase().includes(query))
        && (!filters.department || device.department === filters.department)
        && (!filters.ring || device.ring === filters.ring)
        && (filters.status === 'ALL' || status === filters.status)
    }).sort((left, right) => {
      const rank = statusRank[statusForDevice(left, evaluation)] - statusRank[statusForDevice(right, evaluation)]
      if (rank !== 0) return rank
      const byName = left.name.localeCompare(right.name)
      return sortDirection === 'ascending' ? byName : -byName
    })
  }, [devices, evaluation, filters, sortDirection])

  const finalPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1)
  const currentPage = Math.min(page, finalPage)
  const pageDevices = filtered.slice(currentPage * pageSize, currentPage * pageSize + pageSize)
  const start = filtered.length ? currentPage * pageSize + 1 : 0
  const end = Math.min((currentPage + 1) * pageSize, filtered.length)
  const rapidDeadline = policies.find((policy) => policy.id === 'pol-rapid-update-enforcement')?.updates.restartDeadlineDays ?? 2
  const selected = devices.find((device) => device.id === selectedDeviceId) ?? null

  const updateFilter = <K extends keyof DeviceFilters>(key: K, value: DeviceFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }))
    setPage(0)
  }

  return (
    <div className="view-stack devices-view">
      <section className="surface filters-panel" aria-labelledby="device-filters-title">
        <div className="filters-title"><SlidersHorizontal aria-hidden="true" /><h2 id="device-filters-title">Fleet filters</h2></div>
        <div className="filter-grid">
          <label className="search-field"><span>Search devices</span><div><Search aria-hidden="true" /><input type="search" value={filters.query} onChange={(event) => updateFilter('query', event.target.value)} /></div></label>
          <label><span>Department</span><select value={filters.department} onChange={(event) => updateFilter('department', event.target.value)}><option value="">All departments</option><option>Engineering</option><option>Finance</option><option>Operations</option><option>Sales</option><option>Support</option></select></label>
          <label><span>Deployment ring</span><select value={filters.ring} onChange={(event) => updateFilter('ring', event.target.value as DeviceFilters['ring'])}><option value="">All rings</option><option>Pilot</option><option>Staging</option><option>Production</option></select></label>
          <label><span>Status</span><select value={filters.status} onChange={(event) => updateFilter('status', event.target.value as DeviceStatus)}><option value="ALL">All statuses</option><option value="POLICY_CONFLICT">Policy conflict</option><option value="OS_VERSION_BLOCKED">OS prerequisite blocked</option><option value="COMPLIANT">Compliant</option></select></label>
          <button className="button button-secondary clear-filters" type="button" onClick={() => { setFilters(emptyDeviceFilters); setPage(0) }}><X aria-hidden="true" />Clear filters</button>
        </div>
      </section>

      <section className="surface device-list" aria-labelledby="device-list-title" aria-busy="false">
        <div className="section-heading table-heading">
          <div><span className="eyebrow">Current inventory</span><h2 id="device-list-title">Managed devices</h2></div>
          <strong className="result-count">{filtered.length} devices</strong>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr>
              <th scope="col" aria-sort={sortDirection}><button type="button" onClick={() => setSortDirection((value) => value === 'ascending' ? 'descending' : 'ascending')}>Device <span aria-hidden="true">{sortDirection === 'ascending' ? '↑' : '↓'}</span></button></th>
              <th scope="col">Department</th><th scope="col">OS</th><th scope="col">Ring</th><th scope="col">Effective deadline</th><th scope="col">Status</th><th scope="col">Last check-in</th><th scope="col"><span className="visually-hidden">Inspect</span></th>
            </tr></thead>
            <tbody>{pageDevices.map((device) => {
              const status = statusForDevice(device, evaluation)
              const isConflict = status === 'POLICY_CONFLICT'
              return <tr key={device.id} className={selectedDeviceId === device.id ? 'is-selected' : ''}>
                <td><span className="device-cell"><Laptop aria-hidden="true" /><span><strong>{device.name}</strong><small>{device.id}</small></span></span></td>
                <td>{device.department}</td><td>{device.osVersion}</td><td>{device.ring}</td><td>{isConflict ? 'Conflict' : `${rapidDeadline} days`}</td><td><Status value={status} /></td><td>{(Number(device.id.slice(-3)) % 12) + 1}m ago</td>
                <td><button className="table-action" type="button" aria-label={`Inspect ${device.id}`} onClick={() => onInspect(device.id)}>Inspect</button></td>
              </tr>
            })}</tbody>
          </table>
        </div>

        <div className="device-cards" aria-label="Device records">
          {pageDevices.map((device) => {
            const status = statusForDevice(device, evaluation)
            return <article key={device.id} className={selectedDeviceId === device.id ? 'is-selected' : ''}>
              <div className="device-card-title"><span><Laptop aria-hidden="true" /><strong>{device.name}</strong></span><Status value={status} /></div>
              <dl><div><dt>Device ID</dt><dd>{device.id}</dd></div><div><dt>Department</dt><dd>{device.department}</dd></div><div><dt>OS</dt><dd>{device.osVersion}</dd></div><div><dt>Ring</dt><dd>{device.ring}</dd></div></dl>
              <button className="button button-secondary" type="button" onClick={() => onInspect(device.id)}>Inspect {device.id}</button>
            </article>
          })}
        </div>

        <div className="pagination">
          <label><span>Rows per page</span><select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0) }}><option value="15">15</option><option value="30">30</option><option value="60">60</option></select></label>
          <span>{start}–{end} of {filtered.length}</span>
          <div><button className="icon-button" type="button" aria-label="Previous page" disabled={currentPage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}><ChevronLeft aria-hidden="true" /></button><button className="icon-button" type="button" aria-label="Next page" disabled={end >= filtered.length} onClick={() => setPage((value) => value + 1)}><ChevronRight aria-hidden="true" /></button></div>
        </div>
      </section>
      {selected ? <DeviceInspector device={selected} policies={policies} evaluation={evaluation} /> : null}
    </div>
  )
}
