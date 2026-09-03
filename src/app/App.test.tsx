import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyStagedChange,
  authorizeStagedChange,
  createStagedOpsStore,
  stagePolicyChange,
  type StorageAdapter,
} from '../domain/stagedOps'
import { createAgentContextStore } from '../state/agentContextStore'
import { createToolHandlers } from '../webmcp/handlers'
import { App } from './App'

class MemoryStorage implements StorageAdapter {
  private readonly entries = new Map<string, string>()
  getItem(key: string) { return this.entries.get(key) ?? null }
  setItem(key: string, value: string) { this.entries.set(key, value) }
}

function fixture() {
  const store = createStagedOpsStore({ storage: new MemoryStorage(), now: () => 1_800_000_000_000 })
  const agentContext = createAgentContextStore()
  return { store, agentContext }
}

function renderApp() {
  const value = fixture()
  return { ...value, ...render(<App store={value.store} agentContext={value.agentContext} />) }
}

function rgb(value: string): readonly [number, number, number] {
  if (/^#[\da-f]{6}$/i.test(value.trim())) {
    const hex = value.trim().slice(1)
    return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)]
  }
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number)
  if (!channels || channels.length !== 3) throw new Error(`Expected an RGB color, received ${value}`)
  return channels as unknown as readonly [number, number, number]
}

function luminance(color: readonly [number, number, number]) {
  const [red, green, blue] = color.map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastAgainstWhite(element: Element) {
  const foreground = luminance(rgb(getComputedStyle(element).color))
  return 1.05 / (foreground + 0.05)
}

beforeEach(() => {
  Object.defineProperty(document, 'modelContext', { configurable: true, writable: true, value: undefined })
  Object.defineProperty(navigator, 'modelContext', { configurable: true, writable: true, value: undefined })
})

describe('StagedOps application', () => {
  it('completes the human inspect, simulate, stage, authorize, apply, verify, and rollback workflow', async () => {
    const { store } = renderApp()

    fireEvent.click(screen.getByRole('button', { name: 'Review conflict' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Policy comparison' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Selected devices' })).toBeVisible()
    expect(screen.getAllByText('updates.restartDeadlineDays').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Simulate safe change' }))
    const simulation = await screen.findByRole('region', { name: 'Simulation result' })
    expect(within(simulation).getByText('80.0% → 96.7%')).toBeVisible()
    expect(within(simulation).getByText('12 → 0')).toBeVisible()
    expect(within(simulation).getByText('Remaining blockers')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Stage change plan' }))
    const plan = await screen.findByRole('dialog', { name: 'Change plan' })
    expect(within(plan).getByText('Awaiting human authorization')).toBeVisible()
    expect(within(plan).getByText('2 days')).toBeVisible()
    expect(within(plan).getByText('7 days')).toBeVisible()
    expect(within(plan).getByText('dev-035')).toBeVisible()
    expect(within(plan).getByText('dev-036')).toBeVisible()
    expect(within(plan).getAllByText(/OS 11\.2 below required OS 12/)).toHaveLength(2)

    fireEvent.click(within(plan).getByRole('button', { name: 'Apply manually' }))
    expect(within(plan).getByRole('alert')).toHaveTextContent('A visible human authorization is required before applying.')
    expect(store.getSnapshot().configRevision).toBe(1)

    fireEvent.click(within(plan).getByRole('button', { name: 'Authorize agent' }))
    expect(within(plan).getAllByText('Authorized for one agent apply').length).toBeGreaterThan(0)
    expect(within(plan).getByText('The apply tool is now available once.')).toBeVisible()

    fireEvent.click(within(plan).getByRole('button', { name: 'Apply manually' }))
    expect((await within(plan).findAllByText('Applied successfully')).length).toBeGreaterThan(0)
    expect(within(plan).getByText('58 of 60 devices compliant; two OS blockers remain.')).toBeVisible()
    fireEvent.click(within(plan).getByRole('button', { name: 'Close change plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }))
    expect(screen.getByLabelText('Compliance value')).toHaveTextContent('96.7%')
    expect(screen.getByLabelText('Policy conflicts value')).toHaveTextContent('0')
    expect(screen.getByText('2 OS prerequisite blockers')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Review applied change' }))
    const appliedPlan = await screen.findByRole('dialog', { name: 'Change plan' })
    fireEvent.click(within(appliedPlan).getByRole('button', { name: 'Rollback last change' }))
    const confirmation = await screen.findByRole('dialog', { name: 'Rollback last change' })
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm rollback' }))

    expect((await within(appliedPlan).findAllByText('Rolled back successfully')).length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Compliance value')).toHaveTextContent('80.0%')
    expect(screen.getByLabelText('Policy conflicts value')).toHaveTextContent('12')
    expect(store.getSnapshot().audit.map((event) => event.actor)).toEqual(['Human', 'Human', 'Human', 'Human'])
  })

  it('requires confirmation before reset and restores the deterministic baseline', async () => {
    const { store, agentContext } = fixture()
    const staged = stagePolicyChange(store, { policyId: 'pol-rapid-update-enforcement', restartDeadlineDays: 7, actor: 'Agent' })
    if (!staged.ok) throw new Error('stage should succeed')
    authorizeStagedChange(store, { stagedChangeId: staged.data.id })
    render(<App store={store} agentContext={agentContext} />)

    fireEvent.click(screen.getByRole('button', { name: 'Review staged change' }))
    const plan = await screen.findByRole('dialog', { name: 'Change plan' })
    expect(plan).toBeVisible()
    fireEvent.click(within(plan).getByRole('button', { name: 'Close change plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset demo' }))
    const confirmation = await screen.findByRole('dialog', { name: 'Reset demo' })
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm reset' }))

    expect(screen.queryByRole('dialog', { name: 'Change plan' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Compliance value')).toHaveTextContent('80.0%')
    expect(store.getSnapshot().stagedChange).toBeNull()
    expect(store.getSnapshot().authorization).toBeNull()
  })

  it('keeps the manual workflow available when WebMCP is unavailable', async () => {
    renderApp()

    expect(await screen.findByRole('status', { name: 'WebMCP status' })).toHaveTextContent('WebMCP unavailable · UI mode active')
    fireEvent.click(screen.getByRole('button', { name: 'Simulate safe change' }))
    expect(await screen.findByText('Simulation only — no endpoint settings changed')).toBeVisible()
  })

  it('filters devices, clears filters, paginates, and exposes sort state on a real table', async () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Devices' }))

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search devices' }), { target: { value: 'dev-035' } })
    expect(screen.getAllByText('dev-035').length).toBeGreaterThan(0)
    expect(screen.queryByText('dev-036')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('searchbox', { name: 'Search devices' })).toHaveValue('')
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'POLICY_CONFLICT' } })
    expect(screen.getByText('12 devices')).toBeVisible()

    const deviceHeader = screen.getByRole('columnheader', { name: /Device/ })
    expect(deviceHeader).toHaveAttribute('aria-sort', 'ascending')
    fireEvent.click(within(deviceHeader).getByRole('button'))
    expect(deviceHeader).toHaveAttribute('aria-sort', 'descending')

    fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page' }), { target: { value: '15' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'ALL' } })
    expect(screen.getByText('1–15 of 60')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('16–30 of 60')).toBeVisible()
  })

  it('shows an attention-first overview table and opens the selected device inspector', async () => {
    renderApp()
    const attention = screen.getByRole('region', { name: 'Devices needing attention' })
    expect(within(attention).getAllByRole('row')).toHaveLength(6)

    fireEvent.click(within(attention).getByRole('button', { name: 'Inspect dev-035' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Managed devices' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Device inspector' })).toHaveTextContent('dev-035')
  })

  it('provides landmarks, one h1, live regions, modal focus handling, Escape, and focus restoration', async () => {
    renderApp()

    expect(screen.getByText('Skip to main content')).toHaveAttribute('href', '#main-content')
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content')
    expect(screen.getByRole('complementary', { name: 'Live activity' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('log', { name: 'Activity log' })).toBeInTheDocument()

    const stageButton = screen.getByRole('button', { name: 'Simulate safe change' })
    fireEvent.click(stageButton)
    const openButton = await screen.findByRole('button', { name: 'Stage change plan' })
    openButton.focus()
    fireEvent.click(openButton)
    const plan = await screen.findByRole('dialog', { name: 'Change plan' })
    expect(within(plan).getByRole('heading', { name: 'Change plan' })).toHaveFocus()
    fireEvent.keyDown(plan, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Change plan' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review staged change' })).toHaveFocus())
  })

  it('opens mobile navigation as a modal sheet and restores focus when it closes', async () => {
    renderApp()
    const trigger = screen.getByRole('button', { name: 'Open navigation' })
    trigger.focus()

    fireEvent.click(trigger)
    const sheet = await screen.findByRole('dialog', { name: 'Navigation' })
    expect(within(sheet).getByRole('button', { name: 'Overview' })).toHaveFocus()
    fireEvent.keyDown(sheet, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('makes agent filters, inspection, simulation, and a newly staged plan immediately visible', async () => {
    const { store, agentContext } = renderApp()
    const handlers = createToolHandlers({ store, agentContext, now: () => 1_800_000_000_000 })

    fireEvent.click(screen.getByRole('button', { name: 'Devices' }))
    await act(async () => { await handlers.find_devices({ departments: ['Finance'] }) })
    expect(screen.getByRole('combobox', { name: 'Department' })).toHaveValue('Finance')
    expect(screen.getByText('12 devices')).toBeVisible()

    await act(async () => { await handlers.inspect_device({ deviceId: 'dev-021' }) })
    expect(screen.getByRole('region', { name: 'Device inspector' })).toHaveTextContent('dev-021')

    let simulated: Awaited<ReturnType<typeof handlers.simulate_policy_change>> | undefined
    await act(async () => {
      simulated = await handlers.simulate_policy_change({
        policyId: 'pol-rapid-update-enforcement', field: 'updates.restartDeadlineDays', proposedValue: 7, expectedConfigRevision: 1,
      })
    })
    if (!simulated?.ok) throw new Error('simulation should succeed')
    const simulationId = simulated.data.simulationId
    expect(await screen.findByText('10 conflicts resolved · 0 new conflicts')).toBeVisible()
    await act(async () => {
      await handlers.stage_policy_change({ simulationId, expectedConfigRevision: 1 })
    })

    const plan = await screen.findByRole('dialog', { name: 'Change plan' })
    expect(within(plan).getByRole('heading', { name: 'Change plan' })).toHaveFocus()
    fireEvent.click(within(plan).getByRole('button', { name: 'Close change plan' }))
    expect(screen.getByRole('region', { name: 'Latest agent result' })).toHaveTextContent('stage_policy_change')
  })

  it('removes stale simulation and stage actions after apply, then restores the baseline actions after rollback', async () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Policies' }))
    fireEvent.click(screen.getByRole('button', { name: 'Simulate safe change' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stage change plan' }))

    let plan = await screen.findByRole('dialog', { name: 'Change plan' })
    fireEvent.click(within(plan).getByRole('button', { name: 'Authorize agent' }))
    fireEvent.click(within(plan).getByRole('button', { name: 'Apply manually' }))
    expect((await within(plan).findAllByText('Applied successfully')).length).toBeGreaterThan(0)
    fireEvent.click(within(plan).getByRole('button', { name: 'Close change plan' }))

    expect(screen.getByText('Aligned')).toBeVisible()
    expect(screen.getByText('Both policies now assign a 7-day restart deadline to the same Production scope.')).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Simulation result' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stage change plan' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Simulate safe change' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Overview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review applied change' }))
    plan = await screen.findByRole('dialog', { name: 'Change plan' })
    fireEvent.click(within(plan).getByRole('button', { name: 'Rollback last change' }))
    const confirmation = await screen.findByRole('dialog', { name: 'Rollback last change' })
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm rollback' }))
    fireEvent.click(within(plan).getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Policies' }))

    expect(screen.getByText('Collision detected')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Simulate safe change' })).toBeEnabled()
  })

  it('clears transient agent filters, selection, simulation, latest result, and drawer intent on demo reset', async () => {
    const { store, agentContext } = renderApp()
    const handlers = createToolHandlers({ store, agentContext, now: () => 1_800_000_000_000 })

    await act(async () => { await handlers.find_devices({ departments: ['Finance'] }) })
    await act(async () => { await handlers.inspect_device({ deviceId: 'dev-021' }) })
    expect(screen.getByRole('region', { name: 'Device inspector' })).toHaveTextContent('dev-021')
    await act(async () => {
      await handlers.simulate_policy_change({
        policyId: 'pol-rapid-update-enforcement', field: 'updates.restartDeadlineDays', proposedValue: 7, expectedConfigRevision: 1,
      })
    })
    expect(agentContext.getSnapshot().simulation).not.toBeNull()
    expect(agentContext.getSnapshot().drawerOpen).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Reset demo' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Reset demo' })).getByRole('button', { name: 'Confirm reset' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Operations overview' })).toBeVisible())

    expect(agentContext.getSnapshot()).toMatchObject({
      latestResult: null,
      fleetFilters: null,
      selectedDeviceId: null,
      selectedConflictDeviceIds: [],
      simulation: null,
      drawerOpen: false,
    })
    expect(screen.queryByRole('region', { name: 'Latest agent result' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Devices' }))
    expect(screen.getByRole('combobox', { name: 'Department' })).toHaveValue('')
    expect(screen.getByText('60 devices')).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Device inspector' })).not.toBeInTheDocument()
  })

  it('preserves multi-value agent filters in the visible scope and matching device set', async () => {
    const { store, agentContext } = renderApp()
    const handlers = createToolHandlers({ store, agentContext, now: () => 1_800_000_000_000 })

    await act(async () => {
      await handlers.find_devices({
        departments: ['Finance', 'Sales'],
        rings: ['Pilot', 'Production'],
        statuses: ['POLICY_CONFLICT', 'COMPLIANT'],
        limit: 60,
      })
    })

    const scope = await screen.findByRole('status', { name: 'Active agent filter scope' })
    expect(scope).toHaveTextContent('Departments: Finance + Sales')
    expect(scope).toHaveTextContent('Rings: Pilot + Production')
    expect(scope).toHaveTextContent('Statuses: Policy conflict + Compliant')
    expect(screen.getByText('12 devices')).toBeVisible()
    const inventory = screen.getByRole('region', { name: 'Managed devices' })
    expect(within(inventory).getAllByRole('row')).toHaveLength(13)
    expect(inventory).toHaveTextContent('dev-013')
    expect(inventory).toHaveTextContent('dev-021')
    expect(inventory).toHaveTextContent('dev-037')
    expect(inventory).toHaveTextContent('dev-045')
  })

  it('shows conflict-precedence and effective-deadline evidence for dev-035 before and after apply', async () => {
    const { store } = renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Devices' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search devices' }), { target: { value: 'dev-035' } })

    let row = screen.getByRole('row', { name: /dev-035/ })
    expect(row).toHaveTextContent('Policy conflict')
    expect(row).toHaveTextContent('Conflict')
    fireEvent.click(within(row).getByRole('button', { name: 'Inspect dev-035' }))
    let inspector = screen.getByRole('region', { name: 'Device inspector' })
    expect(inspector).toHaveTextContent('Policy conflict')
    expect(inspector).toHaveTextContent('Effective deadlineConflict')

    const mobileCard = within(screen.getByLabelText('Device records')).getByText('dev-035').closest('article')
    expect(mobileCard).toHaveTextContent('Effective deadline')
    expect(mobileCard).toHaveTextContent('Last check-in')
    expect(mobileCard).toHaveTextContent('Conflict')

    await act(async () => {
      const staged = stagePolicyChange(store, { policyId: 'pol-rapid-update-enforcement', restartDeadlineDays: 7, actor: 'Human' })
      if (!staged.ok) throw new Error('stage should succeed')
      const authorized = authorizeStagedChange(store, { stagedChangeId: staged.data.id })
      if (!authorized.ok) throw new Error('authorization should succeed')
      const applied = applyStagedChange(store, { actor: 'Human', authorizationId: authorized.data.id })
      if (!applied.ok) throw new Error('apply should succeed')
    })

    row = screen.getByRole('row', { name: /dev-035/ })
    expect(row).toHaveTextContent('OS prerequisite blocked')
    expect(row).toHaveTextContent('7 days')
    inspector = screen.getByRole('region', { name: 'Device inspector' })
    expect(inspector).toHaveTextContent('OS prerequisite blocked')
    expect(inspector).toHaveTextContent('Effective deadline7 days')
  })

  it('keeps small teal labels and Agent evidence at WCAG AA text contrast', async () => {
    const { store, agentContext } = renderApp()
    const textTeal = (document.querySelector('.app-shell') as HTMLElement).style.getPropertyValue('--teal-text').trim()
    expect(textTeal).not.toBe('')
    if (!textTeal) return
    expect(1.05 / (luminance(rgb(textTeal)) + 0.05)).toBeGreaterThanOrEqual(4.5)
    expect(contrastAgainstWhite(screen.getByText('Demo workspace', { selector: '.eyebrow' }))).toBeGreaterThanOrEqual(4.5)

    const handlers = createToolHandlers({ store, agentContext, now: () => 1_800_000_000_000 })
    await act(async () => { await handlers.get_fleet_summary({}) })
    const latestLabel = within(await screen.findByRole('region', { name: 'Latest agent result' })).getByText('Latest agent result')
    expect(contrastAgainstWhite(latestLabel)).toBeGreaterThanOrEqual(4.5)

    act(() => { stagePolicyChange(store, { policyId: 'pol-rapid-update-enforcement', restartDeadlineDays: 7, actor: 'Agent' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Audit' }))
    expect(contrastAgainstWhite(screen.getByText('Agent', { selector: '.actor-agent' }))).toBeGreaterThanOrEqual(4.5)
  })

  it('uses the locked 14px control token and keeps the responsive trend Today point', () => {
    renderApp()
    const trend = screen.getByRole('img', { name: 'Seven day compliance trend' })
    expect(trend).not.toHaveAttribute('width', '390')
    expect(within(trend).getByText('Today')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Devices' }))
    const controlSize = (document.querySelector('.app-shell') as HTMLElement).style.getPropertyValue('--control-font-size')
    expect(controlSize).toBe('14px')
    expect(screen.getByRole('combobox', { name: 'Department' })).toBeVisible()
    expect(screen.getAllByRole('button', { name: 'Inspect dev-035' })).toHaveLength(2)
  })
})
