import * as Dialog from '@radix-ui/react-dialog'
import { useRef, useState, type ReactNode, type Ref } from 'react'
import {
  Activity,
  FileClock,
  House,
  Laptop,
  Menu,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react'
import type { ToolRegistrationStatus } from '../../state/agentContextStore'
import type { ViewName } from '../model'

const navigation = [
  { id: 'overview', label: 'Overview', icon: House },
  { id: 'devices', label: 'Devices', icon: Laptop },
  { id: 'policies', label: 'Policies', icon: ShieldCheck },
  { id: 'audit', label: 'Audit', icon: FileClock },
] as const

const viewTitles: Record<ViewName, { title: string; detail: string }> = {
  overview: { title: 'Operations overview', detail: 'Fleet health and the active policy decision.' },
  devices: { title: 'Managed devices', detail: 'Inspect endpoint state, assignments, and blockers.' },
  policies: { title: 'Policy comparison', detail: 'Review overlapping scope and restart-deadline evidence.' },
  audit: { title: 'Audit log', detail: 'Immutable evidence for staged, authorized, and applied changes.' },
}

interface AppShellProps {
  readonly view: ViewName
  readonly onViewChange: (view: ViewName) => void
  readonly onReset: () => void
  readonly toolStatus: ToolRegistrationStatus
  readonly authorizationValid: boolean
  readonly children: ReactNode
  readonly activity: ReactNode
}

function NavigationItems({ view, onChange, firstRef }: { view: ViewName; onChange: (view: ViewName) => void; firstRef?: Ref<HTMLButtonElement> }) {
  return navigation.map(({ id, label, icon: Icon }, index) => (
    <button
      className={`nav-item ${view === id ? 'is-current' : ''}`}
      type="button"
      aria-current={view === id ? 'page' : undefined}
      aria-label={label}
      title={label}
      key={id}
      ref={index === 0 ? firstRef : undefined}
      onClick={() => onChange(id)}
    >
      <Icon aria-hidden="true" />
      <span>{label}</span>
    </button>
  ))
}

function StatusCopy({ status, authorizationValid }: { status: ToolRegistrationStatus; authorizationValid: boolean }) {
  if (status === 'available') return <>{authorizationValid ? 'Agent apply authorized · 10 active' : 'WebMCP ready · 9 active + 1 approval-gated'}</>
  if (status === 'error') return <>WebMCP registration issue · UI mode active</>
  if (status === 'registering') return <>WebMCP registering · UI mode active</>
  return <>WebMCP unavailable · UI mode active</>
}

export function AppShell({ view, onViewChange, onReset, toolStatus, authorizationValid, children, activity }: AppShellProps) {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const firstMobileNavigationItem = useRef<HTMLButtonElement>(null)
  const page = viewTitles[view]

  const changeView = (next: ViewName) => {
    onViewChange(next)
    setMobileNavigationOpen(false)
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>

      <aside className="app-rail" aria-label="Application navigation">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span className="brand-copy"><strong>StagedOps</strong><small>Human-Guided Endpoint Change Lab</small></span>
        </div>
        <nav aria-label="Primary navigation"><NavigationItems view={view} onChange={changeView} /></nav>
        <div className="rail-context">
          <Activity aria-hidden="true" />
          <span><strong>Demo workspace</strong><small>Deterministic local data</small></span>
        </div>
      </aside>

      <div className="app-stage">
        <header className="top-header">
          <Dialog.Root open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
            <Dialog.Trigger asChild><button className="mobile-menu icon-button" type="button" aria-label="Open navigation"><Menu aria-hidden="true" /></button></Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="mobile-nav-overlay" />
              <Dialog.Content
                className="mobile-nav-dialog"
                aria-describedby="mobile-navigation-description"
                onOpenAutoFocus={(event) => { event.preventDefault(); firstMobileNavigationItem.current?.focus() }}
              >
                <Dialog.Title className="visually-hidden">Navigation</Dialog.Title>
                <Dialog.Description className="visually-hidden" id="mobile-navigation-description">Choose a StagedOps workspace view.</Dialog.Description>
                <div className="brand-lockup">
                  <span className="brand-mark" aria-hidden="true"><span /></span>
                  <span className="brand-copy"><strong>StagedOps</strong><small>Human-Guided Endpoint Change Lab</small></span>
                  <Dialog.Close className="mobile-nav-close icon-button" aria-label="Close navigation"><X aria-hidden="true" /></Dialog.Close>
                </div>
                <nav aria-label="Mobile navigation"><NavigationItems view={view} onChange={changeView} firstRef={firstMobileNavigationItem} /></nav>
                <div className="rail-context"><Activity aria-hidden="true" /><span><strong>Demo workspace</strong><small>Deterministic local data</small></span></div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <div className="page-title">
            <span className="eyebrow">Demo workspace</span>
            <h1>{page.title}</h1>
            <p>{page.detail}</p>
          </div>
          <div className="header-actions">
            <button className="button button-secondary reset-button" type="button" onClick={onReset}>
              <RotateCcw aria-hidden="true" /> Reset demo
            </button>
            <div className={`webmcp-status status-${toolStatus}`} role="status" aria-label="WebMCP status">
              <span className="status-dot" aria-hidden="true" />
              <StatusCopy status={toolStatus} authorizationValid={authorizationValid} />
            </div>
          </div>
        </header>

        <div className="content-frame">
          <main id="main-content" tabIndex={-1}>{children}</main>
          {activity}
        </div>
      </div>
    </div>
  )
}
