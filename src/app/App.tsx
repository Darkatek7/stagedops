import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  applyStagedChange,
  authorizeStagedChange,
  getAuditLog,
  getDevices,
  getFleetEvaluation,
  getFleetSummary,
  getPolicies,
  getRollbackChangeId,
  resetDemo,
  revokeStagedAuthorization,
  rollbackLastChange,
  simulatePolicyChange,
  stagePolicyChange,
  type Simulation,
  type StagedOpsStore,
} from '../domain/stagedOps'
import type { AgentContextStore } from '../state/agentContextStore'
import { registerStagedOpsTools } from '../webmcp/registerTools'
import { ActivityPanel } from './components/ActivityPanel'
import { AppShell } from './components/AppShell'
import { AuditView } from './components/AuditView'
import { ChangePlanDrawer, type PlanOutcome } from './components/ChangePlanDrawer'
import { ConfirmDialog } from './components/ConfirmDialog'
import { DevicesView } from './components/DevicesView'
import { OverviewView } from './components/OverviewView'
import { PoliciesView } from './components/PoliciesView'
import { agentToolName, filtersFromAgent, type ViewName } from './model'
import './styles.css'

export interface AppProps {
  readonly store: StagedOpsStore
  readonly agentContext: AgentContextStore
}

function successfulAgentResult(result: unknown): boolean {
  return typeof result === 'object' && result !== null && 'ok' in result && result.ok === true
}

function approvedSimulation(store: StagedOpsStore): Simulation | null {
  try { return simulatePolicyChange(store, { policyId: 'pol-rapid-update-enforcement', restartDeadlineDays: 7 }) }
  catch { return null }
}

export function App({ store, agentContext }: AppProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const agent = useSyncExternalStore(agentContext.subscribe, agentContext.getSnapshot, agentContext.getSnapshot)
  const [view, setView] = useState<ViewName>('overview')
  const [simulation, setSimulation] = useState<Simulation | null>(() => snapshot.stagedChange ? approvedSimulation(store) : null)
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [selectedConflictDeviceIds, setSelectedConflictDeviceIds] = useState<readonly string[]>([])
  const [planOpen, setPlanOpen] = useState(false)
  const [planOutcome, setPlanOutcome] = useState<PlanOutcome>(() => getRollbackChangeId(store) ? 'applied' : 'staged')
  const [planError, setPlanError] = useState<string | null>(null)
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false)
  const [planReturnFocus, setPlanReturnFocus] = useState<HTMLElement | null>(null)
  const processedAgentResultRef = useRef<unknown>(null)

  const summary = getFleetSummary(store)
  const evaluation = getFleetEvaluation(store)
  const policies = getPolicies(store)
  const audit = getAuditLog(store)
  const rollbackChangeId = getRollbackChangeId(store)
  const devices = getDevices()
  const rapidPolicy = policies.find((policy) => policy.id === 'pol-rapid-update-enforcement')
  const affectedDevices = devices.filter((device) => rapidPolicy?.targetDeviceIds.includes(device.id))
  const latestAgentResult = agent.latestResult
  const externalFilters = useMemo(() => filtersFromAgent(agent.fleetFilters), [agent.fleetFilters])

  useEffect(() => {
    let mounted = true
    let dispose: (() => void) | undefined
    void registerStagedOpsTools({ store, agentContext }).then((registeredDispose) => {
      if (mounted) dispose = registeredDispose
      else registeredDispose()
    })
    return () => { mounted = false; dispose?.() }
  }, [agentContext, store])

  useEffect(() => {
    if (!agent.latestResult || agent.latestResult === processedAgentResultRef.current) return
    const result = agent.latestResult
    const timeout = window.setTimeout(() => {
      processedAgentResultRef.current = result
      const tool = agentToolName(result)
      if (!successfulAgentResult(result)) return
      if (tool === 'find_devices') setView('devices')
      if (tool === 'inspect_device') { setSelectedDeviceId(agent.selectedDeviceId); setView('devices') }
      if (tool === 'explain_policy_conflicts') { setSelectedConflictDeviceIds(agent.selectedConflictDeviceIds); setView('policies') }
      if (tool === 'simulate_policy_change') { setSimulation(approvedSimulation(store)); setView('policies') }
      if (tool === 'stage_policy_change') {
        setSimulation((current) => current ?? approvedSimulation(store))
        setPlanOutcome('staged')
        setPlanError(null)
        setPlanReturnFocus(null)
        setPlanOpen(true)
      }
      if (tool === 'get_staged_change' && snapshot.stagedChange && planOpen) setPlanOutcome('staged')
      if (tool === 'apply_staged_change') { setSimulation(null); setPlanOutcome('applied') }
      if (tool === 'rollback_last_change') { setSimulation(null); setPlanOutcome('rolledback') }
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [agent, planOpen, snapshot.stagedChange, store])

  const openPlan = (trigger?: HTMLElement) => {
    setPlanReturnFocus(trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null))
    setPlanError(null)
    setPlanOpen(true)
  }

  const handleSimulate = () => {
    const result = approvedSimulation(store)
    if (result) setSimulation(result)
  }

  const handleStage = (trigger?: HTMLElement) => {
    const result = stagePolicyChange(store, { policyId: 'pol-rapid-update-enforcement', restartDeadlineDays: 7, actor: 'Human' })
    if (!result.ok) return
    setPlanOutcome('staged')
    openPlan(trigger)
  }

  const handleAuthorize = () => {
    if (!snapshot.stagedChange) return
    const result = authorizeStagedChange(store, { stagedChangeId: snapshot.stagedChange.id })
    setPlanError(result.ok ? null : result.error.message)
  }

  const handleApply = () => {
    const result = applyStagedChange(store, { actor: 'Human', authorizationId: snapshot.authorization?.id })
    if (!result.ok) { setPlanError(result.error.message); return }
    setSimulation(null)
    setPlanError(null)
    setPlanOutcome('applied')
  }

  const handleRollback = () => {
    const result = rollbackLastChange(store, { actor: 'Human' })
    if (!result.ok) { setPlanError(result.error.message); return }
    setSimulation(null)
    setPlanError(null)
    setPlanOutcome('rolledback')
  }

  const handleReset = () => {
    const result = resetDemo(store)
    if (!result.ok) return
    agentContext.resetTransient()
    processedAgentResultRef.current = null
    setView('overview')
    setSimulation(null)
    setSelectedDeviceId(null)
    setSelectedConflictDeviceIds([])
    setPlanOpen(false)
    setPlanError(null)
    setPlanOutcome('staged')
    setResetConfirmationOpen(false)
  }

  let currentView
  if (view === 'devices') currentView = <DevicesView devices={devices} policies={policies} evaluation={evaluation} selectedDeviceId={selectedDeviceId ?? agent.selectedDeviceId} externalFilters={externalFilters} onInspect={setSelectedDeviceId} />
  else if (view === 'policies') currentView = <PoliciesView policies={policies} selectedConflictDeviceIds={selectedConflictDeviceIds.length ? selectedConflictDeviceIds : agent.selectedConflictDeviceIds} simulation={simulation} onSimulate={handleSimulate} onStage={handleStage} />
  else if (view === 'audit') currentView = <AuditView audit={audit} />
  else currentView = <OverviewView summary={summary} evaluation={evaluation} devices={devices} simulation={simulation} stagedChange={snapshot.stagedChange} hasRollback={Boolean(rollbackChangeId)} agentHighlighted={agentToolName(latestAgentResult) === 'get_fleet_summary'} onReviewConflict={() => { setSelectedConflictDeviceIds(evaluation.conflictDeviceIds); setView('policies') }} onSimulate={handleSimulate} onStage={handleStage} onReviewStage={openPlan} onInspectDevice={(deviceId) => { setSelectedDeviceId(deviceId); setView('devices') }} />

  return (
    <>
      <AppShell
        view={view}
        onViewChange={setView}
        onReset={() => setResetConfirmationOpen(true)}
        toolStatus={agent.toolStatus}
        authorizationValid={snapshot.authorization?.valid ?? false}
        activity={<ActivityPanel audit={audit} latestAgentResult={latestAgentResult} />}
      >
        {currentView}
      </AppShell>
      <ChangePlanDrawer
        open={planOpen}
        stagedChange={snapshot.stagedChange}
        authorization={snapshot.authorization}
        rollbackChangeId={rollbackChangeId}
        summary={summary}
        affectedDevices={affectedDevices}
        blockerDevices={evaluation.osBlockers}
        outcome={planOutcome}
        error={planError}
        returnFocus={planReturnFocus}
        onOpenChange={setPlanOpen}
        onAuthorize={handleAuthorize}
        onRevoke={() => { revokeStagedAuthorization(store); setPlanError(null) }}
        onApply={handleApply}
        onRollback={handleRollback}
      />
      <ConfirmDialog
        open={resetConfirmationOpen}
        title="Reset demo"
        description="Restore the deterministic baseline, revoke authorization, and close transient panels? Persistent audit evidence will record the reset."
        confirmLabel="Confirm reset"
        danger
        onOpenChange={setResetConfirmationOpen}
        onConfirm={handleReset}
      />
    </>
  )
}
