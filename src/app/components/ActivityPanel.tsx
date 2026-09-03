import { Bot, Radio, UserRound } from 'lucide-react'
import type { AuditEvent } from '../../domain/stagedOps'
import { agentSummary, agentToolName } from '../model'

interface ActivityPanelProps {
  readonly audit: readonly AuditEvent[]
  readonly latestAgentResult: unknown
}

export function ActivityPanel({ audit, latestAgentResult }: ActivityPanelProps) {
  const recent = [...audit].reverse().slice(0, 7)
  const tool = agentToolName(latestAgentResult)
  const summary = agentSummary(latestAgentResult)
  return (
    <aside className="activity-panel surface" aria-label="Live activity">
      <div className="section-heading"><div><span className="eyebrow">Current session</span><h2>Live activity</h2></div><Radio aria-hidden="true" /></div>
      <div className="activity-log" role="log" aria-label="Activity log" aria-live="polite">
        {tool ? <article className="activity-row agent-activity is-new"><span className="activity-icon"><Bot aria-hidden="true" /></span><div><span>Agent · now</span><strong>{tool}</strong><p>{summary ?? 'Updated visible application context.'}</p></div></article> : null}
        {recent.map((event) => <article className="activity-row" key={event.id}><span className={`activity-icon actor-${event.actor.toLowerCase()}`}>{event.actor === 'Agent' ? <Bot aria-hidden="true" /> : <UserRound aria-hidden="true" />}</span><div><span>{event.actor} · {new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><strong>{event.action}</strong><p>{event.detail}</p></div></article>)}
        {!tool && recent.length === 0 ? <p className="activity-empty">No activity yet. Review the conflict to begin.</p> : null}
      </div>
      {tool ? <section className="agent-result" role="region" aria-label="Latest agent result"><span>Latest agent result</span><strong>{tool}</strong><p>{summary ?? 'Visible context updated from the agent tool result.'}</p></section> : null}
    </aside>
  )
}
