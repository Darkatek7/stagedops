import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { agentContextStore } from './state/agentContextStore'
import { stagedOpsStore } from './state/stagedOpsStore'

createRoot(document.getElementById('root')!).render(
  <App store={stagedOpsStore} agentContext={agentContextStore} />,
)
