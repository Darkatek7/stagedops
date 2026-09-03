import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

test.describe('StagedOps Devpost 3:2 Gallery Generation', () => {
  test('captures 15 high-definition 3:2 ratio gallery images for Devpost', async ({ page }) => {
    test.setTimeout(180_000)

    const galleryDir = path.resolve(process.cwd(), 'docs', 'gallery')
    if (!fs.existsSync(galleryDir)) {
      fs.mkdirSync(galleryDir, { recursive: true })
    }

    // 1440 x 960 is an exact 3:2 aspect ratio (1.5)
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.goto('/')

    // Wait for hydration
    await expect(page.locator('.app-shell')).toBeVisible()
    await expect(page.getByLabel('Compliance value')).toHaveText('80.0%')

    // 1. Overview Baseline (80.0%, 12 conflicts, 60 devices)
    await page.screenshot({ path: path.join(galleryDir, '01-overview-baseline.png'), fullPage: false })

    // 2. Agent Fleet Summary
    await page.evaluate(async () => {
      const win = window as any
      if (win.stagedOps?.callTool) {
        await win.stagedOps.callTool('get_fleet_summary')
      }
    })
    await expect(page.getByRole('region', { name: 'Latest agent result' })).toBeVisible()
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(galleryDir, '02-agent-fleet-summary.png'), fullPage: false })

    // 3. Devices Filtered to Production Conflicts
    await page.getByRole('button', { name: 'Devices' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Managed devices' })).toBeVisible()
    await page.evaluate(async () => {
      const win = window as any
      if (win.stagedOps?.callTool) {
        await win.stagedOps.callTool('find_devices', { ring: 'Production', status: 'POLICY_CONFLICT' })
      }
    })
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(galleryDir, '03-devices-filtered.png'), fullPage: false })

    // 4. Device Inspection dev-035
    await page.getByRole('searchbox', { name: 'Search devices' }).fill('dev-035')
    await page.evaluate(async () => {
      const win = window as any
      if (win.stagedOps?.callTool) {
        await win.stagedOps.callTool('inspect_device', { deviceId: 'dev-035' })
      }
    })
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(galleryDir, '04-device-inspection-dev035.png'), fullPage: false })

    // 5. Policy Comparison View
    await page.getByRole('button', { name: 'Policies' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Policy comparison' })).toBeVisible()
    await page.screenshot({ path: path.join(galleryDir, '05-policy-comparison.png'), fullPage: false })

    // 6. Simulation Results (10 resolved, 2 OS blockers)
    await page.getByRole('button', { name: 'Simulate safe change' }).click()
    await expect(page.getByText('10 conflicts resolved · 0 new conflicts')).toBeVisible()
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(galleryDir, '06-simulation-results.png'), fullPage: false })

    // 7. Staged Change Plan Drawer
    await page.getByRole('button', { name: 'Stage change plan' }).click()
    const drawer = page.getByRole('dialog', { name: 'Change plan' })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByText('Agent apply locked — human authorization required')).toBeVisible()
    await page.waitForTimeout(350)
    await page.screenshot({ path: path.join(galleryDir, '07-staged-change-plan.png'), fullPage: false })

    // 8. Human Authorization Checkpoint
    await drawer.getByRole('button', { name: 'Authorize agent' }).click()
    await expect(drawer.locator('strong', { hasText: 'Authorized for one agent apply' })).toBeVisible()
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(galleryDir, '08-human-authorization.png'), fullPage: false })

    // 9. Applied Fleet Compliance
    await page.evaluate(async () => {
      const win = window as any
      if (win.stagedOps?.callTool) {
        await win.stagedOps.callTool('apply_staged_change', { stageId: 'change-000001', expectedConfigRevision: 1 })
      }
    })
    await page.waitForTimeout(350)
    await drawer.getByRole('button', { name: 'Close change plan' }).click()
    await page.getByRole('button', { name: 'Overview' }).click()
    await expect(page.getByLabel('Compliance value')).toHaveText('96.7%')
    await expect(page.getByLabel('Policy conflicts value')).toHaveText('0')
    await page.screenshot({ path: path.join(galleryDir, '09-applied-fleet-compliance.png'), fullPage: false })

    // 10. Latent OS Blocker Evidence
    await page.getByRole('button', { name: 'Devices' }).click()
    await page.getByRole('searchbox', { name: 'Search devices' }).fill('dev-035')
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(galleryDir, '10-latent-os-blocker-evidence.png'), fullPage: false })

    // 11. Rollback Confirmation Modal
    await page.getByRole('button', { name: 'Overview' }).click()
    await page.getByRole('button', { name: 'Review applied change' }).click()
    await expect(drawer).toBeVisible()
    await drawer.getByRole('button', { name: 'Rollback last change' }).click()
    const confirmModal = page.getByRole('dialog', { name: 'Rollback last change' })
    await expect(confirmModal).toBeVisible()
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(galleryDir, '11-rollback-confirmation.png'), fullPage: false })

    // 12. Restored Baseline
    await confirmModal.getByRole('button', { name: 'Confirm rollback' }).click()
    await page.waitForTimeout(350)
    await drawer.getByRole('button', { name: 'Close change plan' }).click()
    await expect(page.getByLabel('Compliance value')).toHaveText('80.0%')
    await expect(page.getByLabel('Policy conflicts value')).toHaveText('12')
    await page.screenshot({ path: path.join(galleryDir, '12-restored-baseline.png'), fullPage: false })

    // 13. Immutable Audit Trail
    await page.getByRole('button', { name: 'Audit' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Recorded activity' })).toBeVisible()
    await page.screenshot({ path: path.join(galleryDir, '13-immutable-audit-trail.png'), fullPage: false })

    // 14. Full Inventory Devices Table (clean un-filtered)
    await page.getByRole('button', { name: 'Devices' }).click()
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await page.getByRole('searchbox', { name: 'Search devices' }).fill('')
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(galleryDir, '14-full-device-inventory.png'), fullPage: false })

    // 15. Operational Architecture & WebMCP Status
    await page.getByRole('button', { name: 'Overview' }).click()
    await page.locator('.overview-attention').scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(galleryDir, '15-prioritized-review-table.png'), fullPage: false })

    // Verify all 15 gallery files exist
    const galleryFiles = fs.readdirSync(galleryDir).filter(f => f.endsWith('.png'))
    expect(galleryFiles.length).toBe(15)
  })
})
