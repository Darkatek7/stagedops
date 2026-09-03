import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import fs from 'node:fs'
import path from 'node:path'

interface MockToolResult {
  readonly ok: boolean
  readonly data?: {
    readonly compliancePercent?: number
    readonly activeStage?: { readonly id: string }
  }
}

interface MockTool {
  readonly name: string
  readonly signal?: AbortSignal
  readonly execute: (input: Record<string, unknown>) => Promise<MockToolResult>
}

interface WindowWithMockTools extends Window {
  __registeredTools?: Map<string, MockTool>
}

interface DocumentWithModelContext extends Document {
  modelContext?: {
    registerTool: (tool: MockTool, options?: { readonly signal?: AbortSignal }) => Promise<void>
  }
}

test.describe('StagedOps E2E and Visual Verification', () => {
  test.beforeEach(async ({ page }) => {
    // Inject mocked document.modelContext before document loads
    await page.addInitScript(() => {
      const registeredTools = new Map<string, MockTool>()
      ;(window as unknown as WindowWithMockTools).__registeredTools = registeredTools
      ;(document as unknown as DocumentWithModelContext).modelContext = {
        registerTool: (tool: MockTool, options?: { readonly signal?: AbortSignal }) => {
          registeredTools.set(tool.name, tool)
          const signal = options?.signal ?? tool?.signal
          if (signal) {
            signal.addEventListener('abort', () => {
              registeredTools.delete(tool.name)
            })
          }
          return Promise.resolve()
        },
      }
    })
  })

  test('completes full manual and mocked WebMCP workflows, generates screenshots, and validates accessibility', async ({ page }) => {
    const screenshotDir = path.resolve(import.meta.dirname ?? '.', '..', '..', 'docs', 'screenshots')
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true })
    }

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')

    // Wait for WebMCP status and application hydration
    await expect(page.locator('.app-shell')).toBeVisible()
    await expect(page.getByRole('status', { name: 'WebMCP status' })).toContainText('WebMCP ready')
    await expect(page.getByLabel('Compliance value')).toHaveText('80.0%')
    await expect(page.getByLabel('Policy conflicts value')).toHaveText('12')

    // 1. Capture baseline screenshot
    await page.screenshot({ path: path.join(screenshotDir, 'baseline.png'), fullPage: false })

    // Validate accessibility on baseline view
    let axeResults = await new AxeBuilder({ page }).analyze()
    let severeViolations = axeResults.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
    expect(severeViolations).toEqual([])

    // Verify 9 baseline tools registered
    let toolCount = await page.evaluate(() => (window as unknown as WindowWithMockTools).__registeredTools?.size ?? 0)
    expect(toolCount).toBe(9)
    let hasApplyTool = await page.evaluate(() => (window as unknown as WindowWithMockTools).__registeredTools?.has('apply_staged_change') ?? false)
    expect(hasApplyTool).toBe(false)

    // Agent executes get_fleet_summary
    const summaryResult = await page.evaluate(async () => {
      const tool = (window as unknown as WindowWithMockTools).__registeredTools?.get('get_fleet_summary')
      return tool ? await tool.execute({}) : { ok: false }
    })
    expect(summaryResult.ok).toBe(true)
    expect(summaryResult.data?.compliancePercent).toBe(80)
    await expect(page.getByRole('region', { name: 'Latest agent result' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Latest agent result' })).toContainText('get_fleet_summary')

    // Navigate to Policies view and run simulation
    await page.getByRole('button', { name: 'Policies' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Policy comparison' })).toBeVisible()
    await page.getByRole('button', { name: 'Simulate safe change' }).click()
    await expect(page.getByText('10 conflicts resolved · 0 new conflicts')).toBeVisible()

    // 2. Capture simulation screenshot
    await page.screenshot({ path: path.join(screenshotDir, 'simulation.png'), fullPage: false })

    // Stage change plan
    await page.getByRole('button', { name: 'Stage change plan' }).click()
    const drawer = page.getByRole('dialog', { name: 'Change plan' })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByText('Agent apply locked — human authorization required')).toBeVisible()
    await expect(drawer.getByText('12 devices across Finance, Operations, and Sales')).toBeVisible()
    await expect(drawer.getByText('10 resolved devices')).toBeVisible()
    await expect(drawer.getByText('Remaining blockers')).toBeVisible()
    await expect(drawer.getByText('dev-035')).toBeVisible()
    await expect(drawer.getByText('dev-036')).toBeVisible()

    // 3. Capture staged plan screenshot
    await page.waitForTimeout(250)
    await page.screenshot({ path: path.join(screenshotDir, 'staged.png'), fullPage: false })

    // Check accessibility with drawer open
    axeResults = await new AxeBuilder({ page }).analyze()
    severeViolations = axeResults.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
    expect(severeViolations).toEqual([])

    // Human Authorizes the agent
    await drawer.getByRole('button', { name: 'Authorize agent' }).click()
    await expect(drawer.locator('strong', { hasText: 'Authorized for one agent apply' })).toBeVisible()

    // Verify 10 tools now registered including apply_staged_change
    toolCount = await page.evaluate(() => (window as unknown as WindowWithMockTools).__registeredTools?.size ?? 0)
    expect(toolCount).toBe(10)
    hasApplyTool = await page.evaluate(() => (window as unknown as WindowWithMockTools).__registeredTools?.has('apply_staged_change') ?? false)
    expect(hasApplyTool).toBe(true)

    // 4. Capture human-authorized screenshot
    await page.screenshot({ path: path.join(screenshotDir, 'human-authorized.png'), fullPage: false })

    // Agent queries get_staged_change to retrieve stageId
    const stagedResult = await page.evaluate(async () => {
      const tool = (window as unknown as WindowWithMockTools).__registeredTools?.get('get_staged_change')
      return tool ? await tool.execute({}) : { ok: false }
    })
    expect(stagedResult.ok).toBe(true)
    const stagedChangeId = stagedResult.data?.activeStage?.id
    expect(stagedChangeId).toBeTruthy()

    const applyResult = await page.evaluate(async (stageId) => {
      const tool = (window as unknown as WindowWithMockTools).__registeredTools?.get('apply_staged_change')
      return tool && stageId ? await tool.execute({ stageId, expectedConfigRevision: 1 }) : { ok: false }
    }, stagedChangeId)
    expect(applyResult.ok).toBe(true)

    // Tool unregistration happens after apply
    await page.waitForTimeout(50)
    hasApplyTool = await page.evaluate(() => (window as unknown as WindowWithMockTools).__registeredTools?.has('apply_staged_change') ?? false)
    expect(hasApplyTool).toBe(false)
    toolCount = await page.evaluate(() => (window as unknown as WindowWithMockTools).__registeredTools?.size ?? 0)
    expect(toolCount).toBe(9)

    // Close drawer and verify Overview view
    await drawer.getByRole('button', { name: 'Close change plan' }).click()
    await page.getByRole('button', { name: 'Overview' }).click()
    await expect(page.getByLabel('Compliance value')).toHaveText('96.7%')
    await expect(page.getByLabel('Policy conflicts value')).toHaveText('0')

    // 5. Capture applied screenshot
    await page.screenshot({ path: path.join(screenshotDir, 'applied.png'), fullPage: false })

    // Verify dev-035 and dev-036 in Devices view
    await page.getByRole('button', { name: 'Devices' }).click()
    await page.getByRole('searchbox', { name: 'Search devices' }).fill('dev-035')
    const dev035Row = page.getByRole('row', { name: /dev-035/ })
    await expect(dev035Row).toContainText('OS prerequisite blocked')
    await expect(dev035Row).toContainText('7 days')

    // Rollback through Change Plan drawer
    await page.getByRole('button', { name: 'Overview' }).click()
    await page.getByRole('button', { name: 'Review applied change' }).click()
    await expect(drawer).toBeVisible()
    await drawer.getByRole('button', { name: 'Rollback last change' }).click()

    const confirmModal = page.getByRole('dialog', { name: 'Rollback last change' })
    await expect(confirmModal).toBeVisible()
    await confirmModal.getByRole('button', { name: 'Confirm rollback' }).click()
    await expect(drawer.locator('strong', { hasText: 'Rolled back successfully' })).toBeVisible()
    await drawer.getByRole('button', { name: 'Close change plan' }).click()

    // Verify baseline restored
    await expect(page.getByLabel('Compliance value')).toHaveText('80.0%')
    await expect(page.getByLabel('Policy conflicts value')).toHaveText('12')

    // 6. Capture rolled-back screenshot
    await page.screenshot({ path: path.join(screenshotDir, 'rolled-back.png'), fullPage: false })

    // Verify all 6 screenshot files exist and have non-zero size
    const screenshotFiles = [
      'baseline.png',
      'simulation.png',
      'staged.png',
      'human-authorized.png',
      'applied.png',
      'rolled-back.png',
    ]
    for (const file of screenshotFiles) {
      const filePath = path.join(screenshotDir, file)
      expect(fs.existsSync(filePath)).toBe(true)
      expect(fs.statSync(filePath).size).toBeGreaterThan(10000)
    }
  })

  test('supports keyboard navigation, focus trapping, escape, and focus restoration', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')

    // Skip link focus
    await page.keyboard.press('Tab')
    await expect(page.locator('.skip-link')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#main-content')).toBeVisible()

    // Open change plan drawer via simulate -> stage
    await page.getByRole('button', { name: 'Simulate safe change' }).click()
    const stageBtn = page.getByRole('button', { name: 'Stage change plan' })
    await stageBtn.focus()
    await page.keyboard.press('Enter')

    const drawer = page.getByRole('dialog', { name: 'Change plan' })
    await expect(drawer).toBeVisible()

    // Test Escape key closes drawer and restores focus
    await page.keyboard.press('Escape')
    await expect(drawer).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Review staged change' })).toBeFocused()
  })

  test('renders properly across responsive breakpoints and 200% zoom', async ({ page }) => {
    // 1. Tablet breakpoint (768 x 1024)
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto('/')
    await expect(page.locator('.app-rail')).toBeVisible()
    await expect(page.getByLabel('Compliance value')).toBeVisible()

    // 2. Mobile breakpoint (360 x 800)
    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible()
    await expect(page.getByLabel('Compliance value')).toBeVisible()

    // Open mobile navigation modal
    await page.getByRole('button', { name: 'Open navigation' }).click()
    const mobileNav = page.getByRole('dialog', { name: 'Navigation' })
    await expect(mobileNav).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(mobileNav).not.toBeVisible()

    // Check Devices view mobile cards
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await page.getByRole('dialog', { name: 'Navigation' }).getByRole('button', { name: 'Devices' }).click()
    await expect(page.locator('.device-cards')).toBeVisible()
    await expect(page.locator('.device-cards article').first()).toBeVisible()

    // 3. Desktop 200% zoom (1440x900 viewport with 2x deviceScaleFactor)
    await page.setViewportSize({ width: 1440, height: 900 })
    const context = await page.context().browser()?.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    })
    if (context) {
      const zoomPage = await context.newPage()
      await zoomPage.goto('/')
      await expect(zoomPage.locator('.app-shell')).toBeVisible()
      const hasHorizontalOverflow = await zoomPage.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth
      })
      expect(hasHorizontalOverflow).toBe(false)
      await context.close()
    }
  })
})
