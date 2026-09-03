import { AlertTriangle, ArrowRight, CheckCircle2, Layers3, ShieldCheck } from 'lucide-react'
import type { Policy, Simulation } from '../../domain/stagedOps'

interface PoliciesViewProps {
  readonly policies: readonly Policy[]
  readonly selectedConflictDeviceIds: readonly string[]
  readonly simulation: Simulation | null
  readonly onSimulate: () => void
  readonly onStage: (trigger?: HTMLElement) => void
}

export function PoliciesView({ policies, selectedConflictDeviceIds, simulation, onSimulate, onStage }: PoliciesViewProps) {
  const standard = policies.find((policy) => policy.id === 'pol-standard-update-window')
  const rapid = policies.find((policy) => policy.id === 'pol-rapid-update-enforcement')
  const resolved = standard?.updates.restartDeadlineDays === rapid?.updates.restartDeadlineDays
  const selection = selectedConflictDeviceIds.length ? selectedConflictDeviceIds : rapid?.targetDeviceIds ?? []
  return (
    <div className="view-stack policies-view">
      <section className="surface policy-comparison" aria-labelledby="policy-comparison-title">
        <div className="section-heading">
          <div><span className="eyebrow">Active assignment evidence</span><h2 id="policy-comparison-title">Restart deadline policies</h2></div>
          <span className={`status-chip ${resolved ? 'status-success' : 'status-warning'}`}><span aria-hidden="true">{resolved ? '✓' : '!'}</span>{resolved ? 'Aligned' : 'Collision detected'}</span>
        </div>
        <div className="comparison-grid">
          <article><ShieldCheck aria-hidden="true" /><span>Standard baseline</span><h3>Standard Update Window</h3><dl><div><dt>Field</dt><dd><code>updates.restartDeadlineDays</code></dd></div><div><dt>Value</dt><dd>{standard?.updates.restartDeadlineDays} days</dd></div><div><dt>Assigned</dt><dd>12 Production devices</dd></div></dl></article>
          <ArrowRight className="comparison-arrow" aria-hidden="true" />
          <article><Layers3 aria-hidden="true" /><span>Higher-precedence assignment</span><h3>Rapid Update Enforcement</h3><dl><div><dt>Field</dt><dd><code>updates.restartDeadlineDays</code></dd></div><div><dt>Value</dt><dd>{rapid?.updates.restartDeadlineDays} days</dd></div><div><dt>Assigned</dt><dd>12 Production devices</dd></div></dl></article>
        </div>
        <div className="root-cause">
          <AlertTriangle aria-hidden="true" />
          <div><h3>Root cause</h3><p>Both policies target Finance, Operations, and Sales in the Production ring. The shared restart-deadline field differs, so the devices cannot resolve one effective value.</p></div>
        </div>
      </section>

      <section className="surface selected-scope" aria-labelledby="selected-scope-title">
        <div className="section-heading"><div><span className="eyebrow">Overlapping scope</span><h2 id="selected-scope-title">Selected devices</h2></div><strong>{selection.length} devices</strong></div>
        <div className="device-id-list">{selection.map((id) => <span key={id}>{id}</span>)}</div>
      </section>

      <section className="surface policy-simulation" aria-labelledby="policy-simulation-title">
        <div className="section-heading"><div><span className="eyebrow">Safe preview</span><h2 id="policy-simulation-title">Simulation preview</h2></div></div>
        {simulation ? <div className="policy-simulation-result" role="region" aria-label="Simulation result" aria-live="polite">
          <CheckCircle2 aria-hidden="true" />
          <div><strong>10 conflicts resolved · 0 new conflicts</strong><p>Simulation only — no endpoint settings changed. dev-035 and dev-036 remain blocked by OS 11.2.</p></div>
          <dl className="policy-simulation-metrics">
            <div><dt>Compliance</dt><dd>{simulation.before.compliancePercent.toFixed(1)}% → {simulation.after.compliancePercent.toFixed(1)}%</dd></div>
            <div><dt>Policy conflicts</dt><dd>{simulation.before.conflictCount} → {simulation.after.conflictCount}</dd></div>
            <div><dt>Remaining blockers</dt><dd>{simulation.osBlockers.length}</dd></div>
          </dl>
          <button className="button button-primary" type="button" data-plan-trigger="true" onClick={(event) => onStage(event.currentTarget)}>Stage change plan</button>
        </div> : <div className="empty-action"><p>Compare the proposed 2-day to 7-day change without modifying endpoint settings.</p><button className="button button-primary" type="button" onClick={onSimulate}>Simulate safe change</button></div>}
      </section>
    </div>
  )
}
