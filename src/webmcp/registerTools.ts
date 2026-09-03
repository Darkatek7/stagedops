import type { StagedOpsStore } from '../domain/stagedOps'
import { agentContextStore as defaultAgentContextStore, type AgentContextStore } from '../state/agentContextStore'
import { createToolHandlers, type InvocationOptions, type ToolHandlers } from './handlers'
import { toolSchemas, type ToolName } from './schemas'

const baseToolNames: readonly ToolName[] = [
  'get_fleet_summary', 'find_devices', 'inspect_device', 'explain_policy_conflicts', 'simulate_policy_change',
  'stage_policy_change', 'get_staged_change', 'rollback_last_change', 'get_audit_log',
]

const descriptions: Record<ToolName, { title: string; description: string; readOnly: boolean }> = {
  get_fleet_summary: { title: 'Get fleet summary', description: 'Reads fleet compliance, issue counts, stage, authorization, and rollback availability. It has no persistent side effects and updates transient visible dashboard result context.', readOnly: true },
  find_devices: { title: 'Find devices', description: 'Reads and filters deterministic fleet devices. It has no persistent side effects and updates transient visible dashboard filters.', readOnly: true },
  inspect_device: { title: 'Inspect device', description: 'Reads one device and its policy evidence. It has no persistent side effects and updates transient visible dashboard device detail.', readOnly: true },
  explain_policy_conflicts: { title: 'Explain policy conflicts', description: 'Reads root-cause evidence for active policy conflicts. It has no persistent side effects and updates transient visible dashboard conflict detail.', readOnly: true },
  simulate_policy_change: { title: 'Simulate policy change', description: 'Calculates the approved policy impact. It has no persistent side effects and updates transient visible dashboard simulation context.', readOnly: true },
  stage_policy_change: { title: 'Stage policy change', description: 'Stages the approved policy plan and appends an audit event. It changes persistent state but does not authorize or apply the policy.', readOnly: false },
  get_staged_change: { title: 'Get staged change', description: 'Reads the active stage and runtime authorization status. It has no persistent side effects and updates transient visible dashboard result context.', readOnly: true },
  apply_staged_change: { title: 'Apply staged change', description: 'Applies one human-authorized staged policy change atomically, changes persistent policy state, and creates a rollback point.', readOnly: false },
  rollback_last_change: { title: 'Rollback last change', description: 'Restores the exact policy state before the last apply and appends an immutable audit event. It changes persistent state.', readOnly: false },
  get_audit_log: { title: 'Get audit log', description: 'Reads immutable audit events newest first. It has no persistent side effects and updates transient visible dashboard result context.', readOnly: true },
}

interface TransitionNavigator extends Navigator { readonly modelContext?: WebMCP.ModelContext }
interface RegistrationOptions {
  readonly store: StagedOpsStore
  readonly agentContext?: AgentContextStore
  readonly scheduleTask?: (task: () => void) => void
}

let disposeActiveRegistration: (() => void) | null = null

function descriptor(name: ToolName, handlers: ToolHandlers, lifecycle?: { beforeExecute?: () => void; afterExecute?: () => void }): WebMCP.ModelContextTool {
  const copy = descriptions[name]
  return {
    name,
    title: copy.title,
    description: copy.description,
    inputSchema: toolSchemas[name],
    annotations: { readOnlyHint: copy.readOnly },
    execute: async (input: Record<string, unknown>, options?: WebMCP.ToolExecuteCallbackOptions) => {
      lifecycle?.beforeExecute?.()
      try { return await handlers[name](input, options as InvocationOptions | undefined) }
      finally { lifecycle?.afterExecute?.() }
    },
  }
}

async function registerDescriptor(tool: WebMCP.ModelContextTool, signal: AbortSignal): Promise<void> {
  if (document.modelContext?.registerTool) {
    await document.modelContext.registerTool(tool, { signal })
    return
  }
  const transitionContext = (navigator as TransitionNavigator).modelContext
  if (transitionContext?.registerTool) await transitionContext.registerTool(tool, { signal })
}

/** Registers the real browser tools imperatively; disposing aborts every registration. */
export async function registerStagedOpsTools(options: RegistrationOptions): Promise<() => void> {
  disposeActiveRegistration?.()
  const context = options.agentContext ?? defaultAgentContextStore
  const scheduleTask = options.scheduleTask ?? ((task: () => void) => { setTimeout(task, 0) })
  const documentContext = document.modelContext?.registerTool ? document.modelContext : undefined
  const modelContext = documentContext ?? (navigator as TransitionNavigator).modelContext
  if (!modelContext?.registerTool) {
    context.setRegistration('unavailable', 0)
    return () => undefined
  }

  const handlers = createToolHandlers({ store: options.store, agentContext: context })
  const baseController = new AbortController()
  let disposed = false
  let registeredCount = 0
  let registrationFailed = false
  let applyController: AbortController | null = null
  let applyRegistered = false
  let applyExecuting = false

  context.setRegistration('registering', 0)
  for (const name of baseToolNames) {
    try {
      await registerDescriptor(descriptor(name, handlers), baseController.signal)
      registeredCount += 1
      context.setRegistration(registrationFailed ? 'error' : 'registering', registeredCount)
    } catch {
      registrationFailed = true
      context.setRegistration('error', registeredCount)
    }
  }
  context.setRegistration(registrationFailed ? 'error' : 'available', registeredCount)

  const removeApply = () => {
    if (!applyController) return
    applyController.abort()
    applyController = null
    if (applyRegistered) registeredCount -= 1
    applyRegistered = false
    context.setApplyRegistered(false)
    context.setRegistration(registrationFailed ? 'error' : 'available', registeredCount)
  }

  const schedulePostInvocationRemoval = () => {
    scheduleTask(() => {
      applyExecuting = false
      removeApply()
    })
  }

  const syncApplyRegistration = async () => {
    if (disposed) return
    const authorizationValid = options.store.getSnapshot().authorization?.valid ?? false
    if (!authorizationValid) {
      if (!applyExecuting) removeApply()
      return
    }
    if (applyController) return
    const controller = new AbortController()
    applyController = controller
    try {
      await registerDescriptor(descriptor('apply_staged_change', handlers, { beforeExecute: () => { applyExecuting = true }, afterExecute: schedulePostInvocationRemoval }), controller.signal)
      if (controller.signal.aborted || disposed) return
      applyRegistered = true
      registeredCount += 1
      context.setApplyRegistered(true)
      context.setRegistration(registrationFailed ? 'error' : 'available', registeredCount)
    } catch {
      if (applyController === controller) applyController = null
      if (controller.signal.aborted || disposed) return
      registrationFailed = true
      context.setRegistration('error', registeredCount)
    }
  }

  const unsubscribe = options.store.subscribe(() => { void syncApplyRegistration() })
  await syncApplyRegistration()

  const dispose = () => {
    if (disposed) return
    disposed = true
    unsubscribe()
    baseController.abort()
    removeApply()
    registeredCount = 0
    context.setRegistration('unavailable', 0)
    if (disposeActiveRegistration === dispose) disposeActiveRegistration = null
  }
  disposeActiveRegistration = dispose
  return dispose
}
