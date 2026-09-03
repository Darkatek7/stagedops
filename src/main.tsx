import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { agentContextStore } from './state/agentContextStore'
import { stagedOpsStore } from './state/stagedOpsStore'
import { createToolHandlers } from './webmcp/handlers'
import type { ToolName } from './webmcp/schemas'

const handlers = createToolHandlers({ store: stagedOpsStore, agentContext: agentContextStore })

if (typeof window !== 'undefined') {
  ;(window as unknown as { stagedOps: unknown }).stagedOps = {
    store: stagedOpsStore,
    agentContext: agentContextStore,
    handlers,
    callTool: async (tool: ToolName, input: Record<string, unknown> = {}) => {
      const handler = handlers[tool]
      if (!handler) throw new Error(`Unknown tool: ${tool}`)
      return await handler(input)
    },
    listTools: () => Object.keys(handlers),
    getStatus: () => agentContextStore.getSnapshot(),
  }
}

createRoot(document.getElementById('root')!).render(
  <App store={stagedOpsStore} agentContext={agentContextStore} />,
)
