import * as Dialog from '@radix-ui/react-dialog'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileDiff,
  Laptop,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useRef, useState } from 'react'
import type { AuthorizationStatus, Device, FleetSummary, StagedChange } from '../../domain/stagedOps'
import { ConfirmDialog } from './ConfirmDialog'

export type PlanOutcome = 'staged' | 'applied' | 'rolledback'

interface ChangePlanDrawerProps {
  readonly open: boolean
  readonly stagedChange: StagedChange | null
  readonly authorization: AuthorizationStatus | null
  readonly rollbackChangeId: string | null
  readonly summary: FleetSummary
  readonly affectedDevices: readonly Device[]
  readonly blockerDevices: readonly Device[]
  readonly outcome: PlanOutcome
  readonly error: string | null
  readonly returnFocus: HTMLElement | null
  readonly onOpenChange: (open: boolean) => void
  readonly onAuthorize: () => void
  readonly onRevoke: () => void
  readonly onApply: () => void
  readonly onRollback: () => void
}

export function ChangePlanDrawer(props: ChangePlanDrawerProps) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [rollbackConfirmationOpen, setRollbackConfirmationOpen] = useState(false)
  const resolvedDevices = props.affectedDevices.filter((device) => !props.blockerDevices.some((blocker) => blocker.id === device.id))
  const authorized = props.authorization?.valid ?? false
  const applied = Boolean(props.rollbackChangeId) || props.outcome === 'applied'
  const rolledBack = props.outcome === 'rolledback' && !props.rollbackChangeId
  const status = rolledBack ? 'Rolled back successfully' : applied ? 'Applied successfully' : authorized ? 'Authorized for one agent apply' : 'Awaiting human authorization'

  return (
    <>
      <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="change-drawer"
            aria-describedby="change-plan-summary"
            onOpenAutoFocus={(event) => { event.preventDefault(); titleRef.current?.focus() }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              const target = props.returnFocus?.isConnected ? props.returnFocus : document.querySelector<HTMLElement>('[data-plan-trigger="true"]')
              target?.focus()
            }}
          >
            <header className="drawer-header">
              <div><span className="eyebrow">Human authorization checkpoint</span><Dialog.Title ref={titleRef} tabIndex={-1}>Change plan</Dialog.Title></div>
              <Dialog.Close className="dialog-close icon-button" aria-label="Close change plan"><X aria-hidden="true" /></Dialog.Close>
            </header>
            <div className="drawer-scroll">
              <section className="plan-intro">
                <span className={`status-chip ${applied || rolledBack ? 'status-success' : authorized ? 'status-primary' : 'status-warning'}`}><span aria-hidden="true">{applied || rolledBack ? '✓' : authorized ? '●' : '!'}</span>{status}</span>
                <h2>Resolve restart-deadline policy conflict</h2>
                <p id="change-plan-summary">Resolve 10 of 12 affected devices without expanding assignment scope.</p>
              </section>

              <section className="plan-section" aria-labelledby="plan-diff-title">
                <h3 id="plan-diff-title"><FileDiff aria-hidden="true" />Policy diff</h3>
                <div className="diff-grid"><div><span>Before</span><small>Rapid Update Enforcement</small><strong>2 days</strong></div><ArrowRight aria-hidden="true" /><div><span>After</span><small>Rapid Update Enforcement</small><strong>7 days</strong></div></div>
                <p className="field-path"><span>Field</span><code>updates.restartDeadlineDays</code></p>
              </section>

              <section className="plan-section" aria-labelledby="impact-title">
                <h3 id="impact-title"><CheckCircle2 aria-hidden="true" />Expected outcome</h3>
                <div className="before-after"><div><span>Compliance</span><strong>80.0% <ArrowRight aria-hidden="true" /> 96.7%</strong></div><div><span>Policy conflicts</span><strong>12 <ArrowRight aria-hidden="true" /> 0</strong></div></div>
                <dl className="impact-grid"><div><dt>Evaluated</dt><dd>12</dd></div><div><dt>Projected compliant</dt><dd>10</dd></div><div><dt>Prerequisite blocked</dt><dd>2</dd></div><div><dt>New conflicts</dt><dd>0</dd></div></dl>
              </section>

              <section className="plan-section" aria-labelledby="blast-radius-title">
                <h3 id="blast-radius-title"><Laptop aria-hidden="true" />Blast radius</h3>
                <p>12 devices across Finance, Operations, and Sales · Production ring.</p>
                <details><summary>10 resolved devices</summary><div className="device-id-list compact">{resolvedDevices.map((device) => <span key={device.id}>{device.id}</span>)}</div></details>
              </section>

              <section className="plan-section blocker-section" aria-labelledby="blocker-title">
                <h3 id="blocker-title"><AlertTriangle aria-hidden="true" />Remaining blockers</h3>
                <ul>{props.blockerDevices.map((device) => <li key={device.id}><strong>{device.id}</strong> · OS {device.osVersion} below required OS 12</li>)}</ul>
              </section>

              <section className="plan-section risks" aria-labelledby="risks-title">
                <h3 id="risks-title"><AlertTriangle aria-hidden="true" />Risks</h3>
                <ul><li>Longer update grace period for the Production ring.</li><li>Two devices remain noncompliant until their OS prerequisite is resolved.</li></ul>
              </section>

              <section className="plan-section authorization" aria-labelledby="authorization-title">
                <h3 id="authorization-title"><LockKeyhole aria-hidden="true" />Authorization</h3>
                {!applied && !rolledBack ? authorized ? <div className="authorization-copy success-copy"><ShieldCheck aria-hidden="true" /><p><strong>Authorized for one agent apply</strong><span>The apply tool is now available once.</span></p></div> : <div className="authorization-copy locked-copy"><LockKeyhole aria-hidden="true" /><p><strong>Agent apply locked — human authorization required</strong><span>Manual apply uses the same authorization gate.</span></p></div> : null}
                {applied ? <div className="authorization-copy success-copy" role="status" aria-live="polite"><CheckCircle2 aria-hidden="true" /><p><strong>Applied successfully</strong><span>{props.summary.compliantDevices} of {props.summary.totalDevices} devices compliant; two OS blockers remain.</span></p></div> : null}
                {rolledBack ? <div className="authorization-copy success-copy" role="status" aria-live="polite"><RotateCcw aria-hidden="true" /><p><strong>Rolled back successfully</strong><span>The 48 of 60 baseline is restored and audit evidence is retained.</span></p></div> : null}
                {props.error ? <p className="inline-error" role="alert">{props.error}</p> : null}
              </section>
            </div>
            <footer className="drawer-actions">
              {props.stagedChange && !authorized ? <button className="button button-primary" type="button" onClick={props.onAuthorize}><ShieldCheck aria-hidden="true" />Authorize agent</button> : null}
              {props.stagedChange && authorized ? <button className="button button-secondary" type="button" onClick={props.onRevoke}>Revoke authorization</button> : null}
              {props.stagedChange ? <button className="button button-primary" type="button" onClick={props.onApply}>Apply manually</button> : null}
              {props.rollbackChangeId ? <button className="button button-danger" type="button" onClick={() => setRollbackConfirmationOpen(true)}><RotateCcw aria-hidden="true" />Rollback last change</button> : null}
              {!props.stagedChange && !props.rollbackChangeId ? <Dialog.Close asChild><button className="button button-secondary" type="button">Close</button></Dialog.Close> : null}
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <ConfirmDialog
        open={rollbackConfirmationOpen}
        title="Rollback last change"
        description="Restore the exact policy snapshot from before this apply? The audit trail will be retained."
        confirmLabel="Confirm rollback"
        danger
        onOpenChange={setRollbackConfirmationOpen}
        onConfirm={() => { props.onRollback(); setRollbackConfirmationOpen(false) }}
      />
    </>
  )
}
