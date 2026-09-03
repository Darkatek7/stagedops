import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileDiff,
  Laptop,
  ShieldAlert,
} from 'lucide-react'
import { Cell, Line, LineChart, Pie, PieChart, Tooltip, XAxis, YAxis } from 'recharts'
import type { Device, FleetEvaluation, FleetSummary, Simulation, StagedChange } from '../../domain/stagedOps'
import { statusForDevice, statusLabel } from '../model'

interface OverviewViewProps {
  readonly summary: FleetSummary
  readonly evaluation: FleetEvaluation
  readonly devices: readonly Device[]
  readonly simulation: Simulation | null
  readonly stagedChange: StagedChange | null
  readonly hasRollback: boolean
  readonly agentHighlighted: boolean
  readonly onReviewConflict: () => void
  readonly onSimulate: () => void
  readonly onStage: (trigger?: HTMLElement) => void
  readonly onReviewStage: (trigger?: HTMLElement) => void
  readonly onInspectDevice: (deviceId: string) => void
}

const history = [
  { day: 'Mon', value: 76 },
  { day: 'Tue', value: 78 },
  { day: 'Wed', value: 74 },
  { day: 'Thu', value: 79 },
  { day: 'Fri', value: 82 },
  { day: 'Sat', value: 84 },
]

function KpiStrip({ summary, openChanges, blockers, highlighted }: { summary: FleetSummary; openChanges: number; blockers: number; highlighted: boolean }) {
  const items = [
    { label: 'Compliance', value: `${summary.compliancePercent.toFixed(1)}%`, icon: CheckCircle2, tone: 'teal', aria: 'Compliance value' },
    { label: 'Policy conflicts', value: String(summary.conflictCount), icon: ShieldAlert, tone: summary.conflictCount ? 'warning' : 'success', aria: 'Policy conflicts value' },
    { label: 'Managed devices', value: String(summary.totalDevices), icon: Laptop, tone: 'primary', aria: 'Managed devices value' },
    { label: 'Open changes', value: String(openChanges), icon: FileDiff, tone: openChanges ? 'primary' : 'quiet', aria: 'Open changes value' },
  ]
  return (
    <section className={`kpi-strip ${highlighted ? 'is-highlighted' : ''}`} aria-label="Fleet key performance indicators">
      {items.map(({ label, value, icon: Icon, tone, aria }) => (
        <article className={`kpi-item tone-${tone}`} key={label}>
          <Icon aria-hidden="true" />
          <div><span>{label}</span><strong aria-label={aria}>{value}</strong></div>
        </article>
      ))}
      {blockers > 0 && summary.conflictCount === 0 ? <p className="kpi-note"><AlertTriangle aria-hidden="true" /> {blockers} OS prerequisite blockers</p> : null}
    </section>
  )
}

function FleetHealth({ summary, evaluation }: { summary: FleetSummary; evaluation: FleetEvaluation }) {
  const blockedCount = evaluation.osBlockers.length
  const compliant = summary.compliantDevices
  const attention = summary.totalDevices - compliant - blockedCount
  const pieData = [
    { name: 'Compliant', value: compliant, color: '#117A4B' },
    { name: 'Policy conflicts', value: Math.max(0, attention), color: '#D98400' },
    { name: 'OS blocked', value: blockedCount, color: '#A9B3C1' },
  ].filter((item) => item.value > 0)
  const trend = [...history, { day: 'Today', value: summary.compliancePercent }]

  return (
    <section className="surface fleet-health" aria-labelledby="fleet-health-title">
      <div className="section-heading">
        <div><span className="eyebrow">Current evaluation</span><h2 id="fleet-health-title">Fleet health</h2></div>
        <span className="data-freshness">Live local model</span>
      </div>
      <div className="fleet-visuals">
        <div className="donut-wrap" aria-label={`${compliant} of ${summary.totalDevices} devices compliant`}>
          <PieChart width={184} height={164} role="img" aria-label="Fleet compliance chart">
            <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={68} strokeWidth={2}>
              {pieData.map((item) => <Cell key={item.name} fill={item.color} />)}
            </Pie>
            <Tooltip />
          </PieChart>
          <span className="donut-label"><strong>{summary.totalDevices}</strong><small>Devices</small></span>
        </div>
        <ul className="health-legend" aria-label="Fleet status legend">
          {pieData.map((item) => <li key={item.name}><span style={{ backgroundColor: item.color }} aria-hidden="true" /><span>{item.name}</span><strong>{item.value}</strong></li>)}
        </ul>
        <div className="trend-chart">
          <h3>Compliance over time</h3>
          <LineChart width={390} height={148} data={trend} margin={{ top: 12, right: 16, bottom: 0, left: -18 }} role="img" aria-label="Seven day compliance trend">
            <XAxis dataKey="day" axisLine={false} tickLine={false} fontSize={11} />
            <YAxis domain={[60, 100]} axisLine={false} tickLine={false} fontSize={11} />
            <Tooltip />
            <Line dataKey="value" type="monotone" stroke="#0891A6" strokeWidth={3} dot={{ r: 3, fill: '#0891A6' }} isAnimationActive={false} />
          </LineChart>
        </div>
      </div>
    </section>
  )
}

function SimulationPanel({ simulation, onStage }: { simulation: Simulation; onStage: (trigger?: HTMLElement) => void }) {
  const metrics = [
    ['Compliance', `${simulation.before.compliancePercent.toFixed(1)}% → ${simulation.after.compliancePercent.toFixed(1)}%`],
    ['Policy conflicts', `${simulation.before.conflictCount} → ${simulation.after.conflictCount}`],
    ['Resolved', String(simulation.resolvedDeviceIds.length)],
    ['Remaining blockers', String(simulation.osBlockers.length)],
    ['New conflicts', '0'],
  ]
  return (
    <section className="simulation-panel" role="region" aria-label="Simulation result" aria-live="polite">
      <div className="simulation-title"><CheckCircle2 aria-hidden="true" /><strong>Simulation only — no endpoint settings changed</strong></div>
      <dl>{metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <button className="button button-primary" type="button" data-plan-trigger="true" onClick={(event) => onStage(event.currentTarget)}><FileDiff aria-hidden="true" /> Stage change plan</button>
    </section>
  )
}

function ConflictWorkbench({ summary, simulation, stagedChange, hasRollback, onReviewConflict, onSimulate, onStage, onReviewStage }: Omit<OverviewViewProps, 'evaluation' | 'devices' | 'agentHighlighted' | 'onInspectDevice'>) {
  const resolved = summary.conflictCount === 0
  return (
    <section className="surface conflict-workbench" aria-labelledby="conflict-title">
      <div className="section-heading">
        <div><span className="eyebrow">Current conflict</span><h2 id="conflict-title">Restart deadline policy collision</h2></div>
        <span className={`status-chip ${resolved ? 'status-success' : 'status-warning'}`}><span aria-hidden="true">{resolved ? '✓' : '!'}</span>{resolved ? 'Resolved' : '12 affected devices'}</span>
      </div>
      <p className="workbench-summary">Two policies target the same Production scope with different values for <code>updates.restartDeadlineDays</code>.</p>
      <div className="policy-evidence">
        <div><span>Standard Update Window</span><strong>7 days</strong></div>
        <ArrowRight aria-hidden="true" />
        <div><span>Rapid Update Enforcement</span><strong>{resolved ? '7 days' : '2 days'}</strong></div>
      </div>
      <dl className="scope-facts">
        <div><dt>Scope</dt><dd>Finance, Operations, and Sales · Production ring</dd></div>
        <div><dt>Field</dt><dd><code>updates.restartDeadlineDays</code></dd></div>
      </dl>
      <div className="workbench-actions">
        <button className="button button-secondary" type="button" onClick={onReviewConflict}>Review conflict</button>
        {!resolved && !simulation ? <button className="button button-primary" type="button" onClick={onSimulate}>Simulate safe change</button> : null}
        {stagedChange ? <button className="button button-primary" type="button" data-plan-trigger="true" onClick={(event) => onReviewStage(event.currentTarget)}>Review staged change</button> : null}
        {hasRollback && !stagedChange ? <button className="button button-primary" type="button" data-plan-trigger="true" onClick={(event) => onReviewStage(event.currentTarget)}>Review applied change</button> : null}
      </div>
      {simulation && !stagedChange && !hasRollback ? <SimulationPanel simulation={simulation} onStage={onStage} /> : null}
    </section>
  )
}

export function OverviewView(props: OverviewViewProps) {
  const blockerIds = new Set(props.evaluation.osBlockers.map((device) => device.id))
  const attentionIds = new Set([...blockerIds, ...props.evaluation.conflictDeviceIds])
  const attentionDevices = props.devices
    .filter((device) => attentionIds.has(device.id))
    .sort((left, right) => Number(blockerIds.has(right.id)) - Number(blockerIds.has(left.id)) || left.name.localeCompare(right.name))
    .slice(0, 5)

  return (
    <div className="view-stack overview-view">
      <KpiStrip
        summary={props.summary}
        openChanges={props.stagedChange ? 1 : 0}
        blockers={props.evaluation.osBlockers.length}
        highlighted={props.agentHighlighted}
      />
      <div className="overview-grid">
        <FleetHealth summary={props.summary} evaluation={props.evaluation} />
        <ConflictWorkbench {...props} />
      </div>
      <section className="surface overview-attention" aria-labelledby="overview-attention-title">
        <div className="section-heading table-heading">
          <div><span className="eyebrow">Prioritized review</span><h2 id="overview-attention-title">Devices needing attention</h2></div>
          <span className="scope-label">Blockers first · then device name</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th scope="col">Device</th><th scope="col">Department</th><th scope="col">Ring</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead>
            <tbody>{attentionDevices.map((device) => {
              const status = statusForDevice(device, props.evaluation)
              return <tr key={device.id}>
                <td><span className="device-cell"><Laptop aria-hidden="true" /><span><strong>{device.name}</strong><small>{device.id}</small></span></span></td>
                <td>{device.department}</td>
                <td>{device.ring}</td>
                <td><span className={`device-status status-${status.toLowerCase()}`}><span aria-hidden="true" />{statusLabel(status)}</span></td>
                <td><button className="table-action" type="button" aria-label={`Inspect ${device.id}`} onClick={() => props.onInspectDevice(device.id)}>Inspect</button></td>
              </tr>
            })}</tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
