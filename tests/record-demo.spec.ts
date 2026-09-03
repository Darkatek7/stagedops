import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

interface WindowWithStagedOps extends Window {
  stagedOps?: {
    callTool: (name: string, input?: Record<string, unknown>) => Promise<unknown>
  }
}

test.describe('StagedOps Video Demo Recording', () => {
  test('records full high-definition video walkthrough of StagedOps', async ({ page }) => {
    // Generous timeout for video recording walkthrough
    test.setTimeout(180_000)

    const videosDir = path.resolve(process.cwd(), 'docs', 'videos')
    if (!fs.existsSync(videosDir)) {
      fs.mkdirSync(videosDir, { recursive: true })
    }

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')

    // --- SCENE 1: Baseline Overview (0:00 - 0:25) ---
    await expect(page.locator('.app-shell')).toBeVisible()
    await expect(page.getByLabel('Compliance value')).toHaveText('80.0%')
    await expect(page.getByLabel('Policy conflicts value')).toHaveText('12')
    await page.waitForTimeout(3500)

    // Highlight WebMCP status badge
    await page.locator('.webmcp-status').hover()
    await page.waitForTimeout(2500)

    // --- SCENE 2: Agent Exploration & Fleet Inspection (0:25 - 0:55) ---
    // Agent executes get_fleet_summary
    await page.evaluate(async () => {
      const win = window as unknown as WindowWithStagedOps
      if (win.stagedOps?.callTool) {
        await win.stagedOps.callTool('get_fleet_summary')
      }
    })
    await expect(page.getByRole('region', { name: 'Latest agent result' })).toBeVisible()
    await page.waitForTimeout(4000)

    // Navigate to Devices view
    await page.getByRole('button', { name: 'Devices' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Managed devices' })).toBeVisible()
    await page.waitForTimeout(2500)

    // Agent executes find_devices for Production conflicts
    await page.evaluate(async () => {
      const win = window as unknown as WindowWithStagedOps
      if (win.stagedOps?.callTool) {
        await win.stagedOps.callTool('find_devices', { ring: 'Production', status: 'POLICY_CONFLICT' })
      }
    })
    await page.waitForTimeout(3500)

    // Inspect dev-035
    await page.getByRole('searchbox', { name: 'Search devices' }).fill('dev-035')
    await page.waitForTimeout(2500)
    await page.evaluate(async () => {
      const win = window as unknown as WindowWithStagedOps
      if (win.stagedOps?.callTool) {
        await win.stagedOps.callTool('inspect_device', { deviceId: 'dev-035' })
      }
    })
    await page.waitForTimeout(3500)

    // --- SCENE 3: Simulation & Safe Staging (0:55 - 1:25) ---
    await page.getByRole('button', { name: 'Policies' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Policy comparison' })).toBeVisible()
    await page.waitForTimeout(3000)

    // Run safe simulation
    await page.getByRole('button', { name: 'Simulate safe change' }).click()
    await expect(page.getByText('10 conflicts resolved · 0 new conflicts')).toBeVisible()
    await page.waitForTimeout(4500)

    // Stage change plan
    await page.getByRole('button', { name: 'Stage change plan' }).click()
    const drawer = page.getByRole('dialog', { name: 'Change plan' })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByText('Agent apply locked — human authorization required')).toBeVisible()
    await page.waitForTimeout(5000)

    // --- SCENE 4: The Human Authorization Gate (1:25 - 1:55) ---
    // Hover over Authorize button
    const authBtn = drawer.getByRole('button', { name: 'Authorize agent' })
    await authBtn.hover()
    await page.waitForTimeout(2500)

    // Click Authorize agent
    await authBtn.click()
    await expect(drawer.locator('strong', { hasText: 'Authorized for one agent apply' })).toBeVisible()
    await page.waitForTimeout(4500)

    // --- SCENE 5: Agent Execution & Blocker Verification (1:55 - 2:25) ---
    // Agent executes apply_staged_change
    await page.evaluate(async () => {
      const win = window as unknown as WindowWithStagedOps
      if (win.stagedOps?.callTool) {
        await win.stagedOps.callTool('apply_staged_change', { stageId: 'change-000001', expectedConfigRevision: 1 })
      }
    })
    await page.waitForTimeout(4000)

    // Close drawer and observe Overview
    await drawer.getByRole('button', { name: 'Close change plan' }).click()
    await page.getByRole('button', { name: 'Overview' }).click()
    await expect(page.getByLabel('Compliance value')).toHaveText('96.7%')
    await expect(page.getByLabel('Policy conflicts value')).toHaveText('0')
    await page.waitForTimeout(5000)

    // Navigate to Devices to verify dev-035 OS blocker
    await page.getByRole('button', { name: 'Devices' }).click()
    await page.getByRole('searchbox', { name: 'Search devices' }).fill('dev-035')
    await page.waitForTimeout(4000)

    // --- SCENE 6: Rollback & Full Audit Retention (2:25 - 2:50) ---
    await page.getByRole('button', { name: 'Overview' }).click()
    await page.waitForTimeout(2000)
    await page.getByRole('button', { name: 'Review applied change' }).click()
    await expect(drawer).toBeVisible()
    await page.waitForTimeout(2500)

    // Click Rollback
    await drawer.getByRole('button', { name: 'Rollback last change' }).click()
    const confirmModal = page.getByRole('dialog', { name: 'Rollback last change' })
    await expect(confirmModal).toBeVisible()
    await page.waitForTimeout(2500)
    await confirmModal.getByRole('button', { name: 'Confirm rollback' }).click()
    await page.waitForTimeout(3000)

    // Close drawer, verify 80.0% restored
    await drawer.getByRole('button', { name: 'Close change plan' }).click()
    await expect(page.getByLabel('Compliance value')).toHaveText('80.0%')
    await expect(page.getByLabel('Policy conflicts value')).toHaveText('12')
    await page.waitForTimeout(3000)

    // Navigate to Audit view
    await page.getByRole('button', { name: 'Audit' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Recorded activity' })).toBeVisible()
    await page.waitForTimeout(5000)
  })
})
