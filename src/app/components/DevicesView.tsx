import { ChevronLeft, ChevronRight, Laptop, Search, SlidersHorizontal, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Department, Device, FleetEvaluation, Policy, Ring } from '../../domain/stagedOps'
import { effectiveDeadlineForDevice, emptyDeviceFilters, statusForDevice, statusLabel, type DeviceFilters, type DeviceStatus } from '../model'

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
  POLICY_CONFLICT: 0,
  COMPLIANT: 2,
}

const departments: readonly Department[] = ['Engineering', 'Finance', 'Operations', 'Sales', 'Support']
const rings: readonly Ring[] = ['Pilot', 'Staging', 'Production']
const statuses: readonly Exclude<DeviceStatus, 'ALL'>[] = ['POLICY_CONFLICT', 'OS_VERSION_BLOCKED', 'COMPLIANT']

function lastCheckIn(device: Device) {
  return `${(Number(device.id.slice(-3)) % 12) + 1}m ago`
}

function Status({ value }: { value: Exclude<DeviceStatus, 'ALL'> }) {
  return <span className={`device-status status-${value.toLowerCase()}`}><span aria-hidden="true" />{statusLabel(value)}</span>
}

function DeviceInspector({ device, policies, evaluation, rapidDeadlineDays }: { device: Device; policies: readonly Policy[]; evaluation: FleetEvaluation; rapidDeadlineDays: number }) {
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
        <div><dt>Effective deadline</dt><dd>{effectiveDeadlineForDevice(device, evaluation, rapidDeadlineDays)}</dd></div>
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
  const [filters, setFilters] = useState<DeviceFilters>(() => externalFilters ? { ...emptyDeviceFilters, ...externalFilters } : emptyDeviceFilters)
  const [pageSize, setPageSize] = useState(15)
  const [page, setPage] = useState(0)
  const [sortDirection, setSortDirection] = useState<'ascending' | 'descending'>('ascending')
  const [appliedExternalFilters, setAppliedExternalFilters] = useState<Partial<DeviceFilters> | null>(externalFilters)

  const [agentAttributed, setAgentAttributed] = useState(Boolean(externalFilters))

  if (externalFilters !== appliedExternalFilters) {
    setAppliedExternalFilters(externalFilters)
    setFilters(externalFilters ? { ...emptyDeviceFilters, ...externalFilters } : emptyDeviceFilters)
    setPage(0)
    setAgentAttributed(Boolean(externalFilters))
  }

  const filtered = useMemo(() => {
    const query = filters.query.trim().toLocaleLowerCase()
    return devices.filter((device) => {
      const status = statusForDevice(device, evaluation)
      return (!query || device.id.toLocaleLowerCase().includes(query) || device.name.toLocaleLowerCase().includes(query))
        && (!filters.departments.length || filters.departments.includes(device.department))
        && (!filters.rings.length || filters.rings.includes(device.ring))
        && (!filters.statuses.length || filters.statuses.includes(status))
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
  const externalFilterVisible = agentAttributed && externalFilters !== null && (filters.query.length > 0 || filters.departments.length > 0 || filters.rings.length > 0 || filters.statuses.length > 0)

  const updateFilter = <K extends keyof DeviceFilters>(key: K, value: DeviceFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }))
    setPage(0)
    setAgentAttributed(false)
  }

  return (
    <div className="view-stack devices-view">
      <section className="surface filters-panel" aria-labelledby="device-filters-title">
        <div className="filters-title"><SlidersHorizontal aria-hidden="true" /><h2 id="device-filters-title">Fleet filters</h2></div>
        {externalFilterVisible ? <div className="active-agent-filters" role="status" aria-label="Active agent filter scope" aria-live="polite">
          <strong>Agent filters</strong>
          {filters.query ? <span>Search: {filters.query}</span> : null}
          {filters.departments.length ? <span>Departments: {filters.departments.join(' + ')}</span> : null}
          {filters.rings.length ? <span>Rings: {filters.rings.join(' + ')}</span> : null}
          {filters.statuses.length ? <span>Statuses: {filters.statuses.map(statusLabel).join(' + ')}</span> : null}
        </div> : null}
        <div className="filter-grid">
          <label className="search-field"><span>Search devices</span><div><Search aria-hidden="true" /><input type="search" value={filters.query} onChange={(event) => updateFilter('query', event.target.value)} /></div></label>
          <label><span>Department</span><select value={filters.departments.length === 1 ? filters.departments[0] : ''} onChange={(event) => updateFilter('departments', event.target.value ? [event.target.value as Department] : [])}><option value="">{filters.departments.length > 1 ? `${filters.departments.length} departments selected` : 'All departments'}</option>{departments.map((department) => <option key={department}>{department}</option>)}</select></label>
          <label><span>Deployment ring</span><select value={filters.rings.length === 1 ? filters.rings[0] : ''} onChange={(event) => updateFilter('rings', event.target.value ? [event.target.value as Ring] : [])}><option value="">{filters.rings.length > 1 ? `${filters.rings.length} rings selected` : 'All rings'}</option>{rings.map((ring) => <option key={ring}>{ring}</option>)}</select></label>
          <label><span>Status</span><select value={filters.statuses.length === 1 ? filters.statuses[0] : 'ALL'} onChange={(event) => updateFilter('statuses', event.target.value === 'ALL' ? [] : [event.target.value as Exclude<DeviceStatus, 'ALL'>])}><option value="ALL">{filters.statuses.length > 1 ? `${filters.statuses.length} statuses selected` : 'All statuses'}</option>{statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>
          <button className="button button-secondary clear-filters" type="button" onClick={() => { setFilters(emptyDeviceFilters); setPage(0); setAgentAttributed(false) }}><X aria-hidden="true" />Clear filters</button>
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
              return <tr key={device.id} className={selectedDeviceId === device.id ? 'is-selected' : ''}>
                <td><span className="device-cell"><Laptop aria-hidden="true" /><span><strong>{device.name}</strong><small>{device.id}</small></span></span></td>
                <td>{device.department}</td><td>{device.osVersion}</td><td>{device.ring}</td><td>{effectiveDeadlineForDevice(device, evaluation, rapidDeadline)}</td><td><Status value={status} /></td><td>{lastCheckIn(device)}</td>
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
              <dl><div><dt>Device ID</dt><dd>{device.id}</dd></div><div><dt>Department</dt><dd>{device.department}</dd></div><div><dt>OS</dt><dd>{device.osVersion}</dd></div><div><dt>Ring</dt><dd>{device.ring}</dd></div><div><dt>Effective deadline</dt><dd>{effectiveDeadlineForDevice(device, evaluation, rapidDeadline)}</dd></div><div><dt>Last check-in</dt><dd>{lastCheckIn(device)}</dd></div></dl>
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
      {selected ? <DeviceInspector device={selected} policies={policies} evaluation={evaluation} rapidDeadlineDays={rapidDeadline} /> : null}
    </div>
  )
}
