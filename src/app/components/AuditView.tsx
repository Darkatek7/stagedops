import { Bot, CheckCircle2, FileClock, RotateCcw, ShieldCheck, UserRound } from 'lucide-react'
import type { AuditEvent } from '../../domain/stagedOps'

interface AuditViewProps { readonly audit: readonly AuditEvent[] }

function ActionIcon({ action }: { action: AuditEvent['action'] }) {
  if (action === 'rollback' || action === 'reset') return <RotateCcw aria-hidden="true" />
  if (action === 'authorize') return <ShieldCheck aria-hidden="true" />
  if (action === 'apply') return <CheckCircle2 aria-hidden="true" />
  return <FileClock aria-hidden="true" />
}

export function AuditView({ audit }: AuditViewProps) {
  const events = [...audit].reverse()
  return (
    <section className="surface audit-view" aria-labelledby="audit-events-title">
      <div className="section-heading"><div><span className="eyebrow">Persistent domain evidence</span><h2 id="audit-events-title">Recorded activity</h2></div><strong>{events.length} events</strong></div>
      {events.length ? <div className="audit-table-wrap"><table><thead><tr><th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Target / detail</th><th scope="col">Outcome</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td><time dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></td><td><span className={`actor actor-${event.actor.toLowerCase()}`}>{event.actor === 'Agent' ? <Bot aria-hidden="true" /> : <UserRound aria-hidden="true" />}{event.actor}</span></td><td><span className="audit-action"><ActionIcon action={event.action} />{event.action}</span></td><td>{event.detail}</td><td><span className="status-chip status-success"><span aria-hidden="true">✓</span>Recorded</span></td></tr>)}</tbody></table></div> : <div className="empty-state"><FileClock aria-hidden="true" /><h3>No persistent audit events yet</h3><p>Stage a change from the interface or through WebMCP to begin the immutable audit trail.</p></div>}
    </section>
  )
}
