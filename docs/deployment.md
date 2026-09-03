# StagedOps Deployment, Origin Trial & Browser Verification Guide

This guide details how to build, deploy, and verify **StagedOps** on Cloudflare Pages, configure required HTTP headers, participate in the Chrome WebMCP Origin Trial, and run end-to-end verifications in real browsers.

---

## 1. Cloudflare Pages Deployment

StagedOps is a static, zero-backend React single-page application hosted on Cloudflare Pages.

### Project Details
- **Project Name**: `stagedops-darkatek7-20260903`
- **Application URL**: `https://stagedops-darkatek7-20260903.pages.dev`
- **Build Output Directory**: `dist`
- **Static Assets Directory**: `public`
- **Optional Custom Domain**: `https://stagedops.darkatek7.com` (CNAME to `stagedops-darkatek7-20260903.pages.dev`)

### Deployment Steps (Direct Upload)

1. Authenticate with Cloudflare Wrangler:
   ```bash
   npx wrangler login
   ```

2. Build the production client bundle:
   ```bash
   pnpm build
   ```

3. Deploy `dist` to Cloudflare Pages:
   ```bash
   npx wrangler pages deploy dist --project-name stagedops-darkatek7-20260903
   ```

4. Verify production HTTP headers:
   ```bash
   curl -sI https://stagedops-darkatek7-20260903.pages.dev
   ```

---

## 2. HTTP Security & Capabilities Headers

WebMCP and modern origin isolation require specific browser headers:

### Static Header Rules (`public/_headers` and `dist/_headers`)

Cloudflare Pages automatically serves custom headers placed in `_headers`:

```http
/*
  Origin-Agent-Cluster: ?1
  Permissions-Policy: tools=(self)
```

- `Origin-Agent-Cluster: ?1`: Demands dedicated process isolation for the origin, satisfying origin-trial prerequisites.
- `Permissions-Policy: tools=(self)`: Explicitly delegates WebMCP tool capabilities to the application origin.

### Local Vite Server Headers

The local Vite dev and preview servers (`vite.config.ts`) are pre-configured with identical headers:
```ts
server: {
  headers: {
    'Origin-Agent-Cluster': '?1',
    'Permissions-Policy': 'tools=(self)',
  },
}
```

---

## 3. Chrome WebMCP Origin Trial (M149–M156)

For Chrome installations running official beta/dev channels (Milestones 149 through 156), WebMCP is available via an official Chrome Origin Trial.

### Enrolling the Origin
1. Visit the [Chrome Origin Trials dashboard](https://developer.chrome.com/origintrials/).
2. Select the **WebMCP (Model Context Protocol)** trial.
3. Register the exact origin:
   `https://stagedops-darkatek7-20260903.pages.dev`
4. Copy the generated trial token.

### Injecting the Origin Trial Token
To adhere to security best practices, **never commit raw Origin Trial tokens to version control**. StagedOps provides an automatic build-time injection mechanism:

```bash
# Set token in environment and build
$env:WEBMCP_ORIGIN_TRIAL_TOKEN="A...your-origin-trial-token..."
pnpm build
```

During the build, the Vite plugin appends the header directly to `dist/_headers`:
```http
/*
  Origin-Agent-Cluster: ?1
  Permissions-Policy: tools=(self)
  Origin-Trial: A...your-origin-trial-token...
```

Deploying `dist` will activate the trial for all visiting Chrome users without local flags.

---

## 4. Local Testing Fallback (Browser Flags)

If testing on an origin without an Origin Trial token, or on `localhost`:

1. Open Google Chrome (v149+).
2. Navigate to:
   ```
   chrome://flags/#enable-webmcp-testing
   ```
3. Set the flag to **Enabled**.
4. Relaunch Chrome.
5. Navigate to `http://localhost:5173` or `https://stagedops-darkatek7-20260903.pages.dev`.
6. Confirm the header status badge displays:
   `WebMCP ready · 9 active + 1 approval-gated`

---

## 5. ChatGPT Desktop In-App Browser Verification

When using OpenAI ChatGPT Desktop with the Website Tools capability:

1. Launch ChatGPT Desktop (macOS or Windows).
2. Ensure **Website Tools** is enabled under Settings > Capabilities.
3. Use a model with browsing/tools support (e.g., GPT-5.6 Sol or Terra).
4. Direct the agent to:
   `https://stagedops-darkatek7-20260903.pages.dev`
5. Verify:
   - The agent detects 9 tools initially.
   - The agent cannot call `apply_staged_change`.
   - After the human clicks "Authorize agent" in the UI, the agent can call `apply_staged_change` exactly once.
   - Live UI updates synchronize in real time.
