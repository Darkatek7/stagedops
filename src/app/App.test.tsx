import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
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
    expect(screen.getByText('10 devices')).toBeVisible()

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
})
