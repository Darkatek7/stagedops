import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))
const originTrialToken = process.env.WEBMCP_ORIGIN_TRIAL_TOKEN?.trim()

const standardHeaders: Record<string, string> = {
  'Origin-Agent-Cluster': '?1',
  'Permissions-Policy': 'tools=(self)',
  ...(originTrialToken ? { 'Origin-Trial': originTrialToken } : {}),
}

function cloudflareHeadersPlugin(): Plugin {
  return {
    name: 'cloudflare-headers',
    closeBundle() {
      const distDir = path.resolve(projectRoot, 'dist')
      if (!fs.existsSync(distDir)) return
      const headersLines = [
        '/*',
        '  Origin-Agent-Cluster: ?1',
        '  Permissions-Policy: tools=(self)',
      ]
      if (originTrialToken) {
        headersLines.push(`  Origin-Trial: ${originTrialToken}`)
      }
      fs.writeFileSync(path.join(distDir, '_headers'), headersLines.join('\n') + '\n', 'utf-8')
    },
  }
}

export default defineConfig({
  plugins: [react(), cloudflareHeadersPlugin()],
  server: {
    headers: standardHeaders,
  },
  preview: {
    headers: standardHeaders,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['node_modules', 'dist', 'tests/**'],
  },
})
