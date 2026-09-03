# StagedOps – Human-Guided Endpoint Change Lab

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-blue.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-purple.svg)](https://vitejs.dev/)
[![WebMCP](https://img.shields.io/badge/WebMCP-Draft%20Standard-teal.svg)](https://webmachinelearning.github.io/webmcp/)

**StagedOps** is a client-side enterprise endpoint change workbench built for the WebMCP Hackathon. It demonstrates how autonomous AI agents and human IT administrators can safely collaborate on fleet configuration changes without risking endpoint stability.

Using the emerging [WebMCP browser standard](https://webmachinelearning.github.io/webmcp/), an AI agent can inspect fleet health, diagnose competing update-deadline policies, simulate safe remediations, and stage formal change plans. Crucially, **the agent cannot mutate fleet configuration until a human administrator reviews the 12-device blast radius and explicitly authorizes execution.** Authorization is single-use, bounded to a 5-minute window, and dynamically exposes the execution tool (`apply_staged_change`) to the browser runtime only while valid.

---

## Quick Reference: WebMCP Implementation

The imperative WebMCP tool registration logic is located in:
👉 [`src/webmcp/registerTools.ts`](src/webmcp/registerTools.ts)

All tool schemas and input definitions adhere to **JSON Schema 2020-12** with `additionalProperties: false` at all object depths:
👉 [`src/webmcp/schemas.ts`](src/webmcp/schemas.ts)

Shared tool execution handlers and structured envelope responses:
👉 [`src/webmcp/handlers.ts`](src/webmcp/handlers.ts)

---

## Architectural Principles & Design Decisions

### 1. Deterministic Domain & Fleet Model
- **60 Devices**: Seeded deterministically across 5 departments (Engineering, Finance, Operations, Sales, Support) and 3 deployment rings (2 Pilot, 6 Staging, 4 Production per department).
- **The Policy Conflict**:
  - `Standard Update Window` assigns `updates.restartDeadlineDays = 7` to all devices.
  - `Rapid Update Enforcement` assigns `updates.restartDeadlineDays = 2` to 12 Production devices across Finance, Operations, and Sales.
  - Initial baseline: **48/60 compliant devices (80.0%)**, 12 active policy conflicts.
- **The Remediation**:
  - Remediating `Rapid Update Enforcement` from 2 days to 7 days resolves 10 conflicts.
  - Devices `dev-035` and `dev-036` (Operations, Production) remain noncompliant because OS version `11.2.0` is below the required minimum `12.0.0`.
  - Remediated result: **58/60 compliant devices (96.7%)**, 0 policy collisions, 2 named OS blockers.

### 2. The Human Authorization Gate
- **Staging Never Mutates**: The `stage_policy_change` tool creates a visual change plan in the visible dashboard, but does not alter policy configuration or grant apply privileges.
- **Dynamic Tool Registration**: In the baseline state, exactly **9 tools** are registered. The 10th tool, `apply_staged_change`, is registered **only after a human administrator clicks "Authorize agent"** in the Change Plan drawer.
- **Ephemeral & Single-Use**: Human authorization lasts at most 5 minutes, is bound strictly to the active stage ID and configuration revision, and is immediately invalidated by apply execution, stage replacement, manual revocation, browser refresh, or demo reset.
- **Atomic Apply & Rollback**: Apply writes next state atomically to Local Storage before publishing to the UI. Rollback restores the exact pre-apply snapshot while retaining an append-only audit trail.

### 3. Progressive Enhancement & Accessibility
- **Full Manual Workflow**: The application is 100% operational through standard keyboard and mouse interaction when WebMCP is unsupported or inactive.
- **Enterprise Design System**: Permanent light command-center aesthetic, cobalt primary accents, teal data cues, high-contrast typography, semantic landmarks, real table headers with `aria-sort`, focus trapping and restoration, and 44px minimum touch targets.
- **WCAG 2.2 AA Compliant**: Automated accessibility scans via `@axe-core/playwright` verify 0 critical or serious violations across desktop, tablet, and mobile viewports.

---

## WebMCP Public Tool Contract

All tools return a standardized JSON-serializable envelope containing human-readable summaries, data/errors, recommended next steps, and revision metadata:

| # | Tool Name | Mode | Read-Only | Disclosed Effects & Behavior |
|---|---|---|:---:|---|
| 1 | `get_fleet_summary` | Base | Yes | Exposes fleet metrics, compliance rates, and updates visible Agent Result panel. |
| 2 | `find_devices` | Base | Yes | Queries device inventory by department, ring, or status; filters visible table in-place. |
| 3 | `inspect_device` | Base | Yes | Retrieves detailed assignment evidence, effective deadline, and active issues for one device. |
| 4 | `explain_policy_conflicts` | Base | Yes | Diagnoses conflicting policy rules, overlapping scopes, and latent risks. |
| 5 | `simulate_policy_change` | Base | Yes | Models 2d → 7d change; projects 48→58 compliance and identifies remaining OS blockers. |
| 6 | `stage_policy_change` | Base | No | Creates visible Change Plan drawer and audit entry; never applies or authorizes changes. |
| 7 | `get_staged_change` | Base | Yes | Returns active staged plan ID, expected revision, and human authorization state. |
| 8 | `apply_staged_change` | **Dynamic** | No | Registered **only** during active human authorization; applies atomically once. |
| 9 | `rollback_last_change` | Base | No | Restores exact operational snapshot prior to last apply; preserves audit evidence. |
| 10 | `get_audit_log` | Base | Yes | Exposes chronological, append-only audit trail with actor attribution (`Human`, `Agent`, `System`). |

---

## Local Development & Verification

### Prerequisites
- Node.js 20+
- pnpm 10+
- Supported browser: Chromium-based browser with WebMCP enabled, or modern desktop browser for UI/mock testing.

### Commands

```bash
# Install dependencies
pnpm install

# Start local development server
pnpm dev

# Run unit and integration tests (domain, schemas, handlers, UI)
pnpm test

# Run end-to-end browser tests with Playwright and Axe accessibility scans
pnpm test:e2e

# Run TypeScript typecheck
pnpm typecheck

# Run ESLint check
pnpm lint

# Build production bundle
pnpm build
```

---

## Cloudflare Pages Deployment & Headers

StagedOps is pre-configured for static deployment to Cloudflare Pages (`stagedops-darkatek7-20260903`).

### Security & Capability Headers

The static build automatically generates `_headers` ensuring:
```http
/*
  Origin-Agent-Cluster: ?1
  Permissions-Policy: tools=(self)
```

When building with a valid Chrome Origin Trial token for WebMCP:
```bash
WEBMCP_ORIGIN_TRIAL_TOKEN="<your-token>" pnpm build
```
Vite automatically appends the `Origin-Trial` header to `dist/_headers`. No dummy tokens are ever committed to version control.

---

## Exact Test Prompts for AI Agents

To test StagedOps in ChatGPT Desktop (with Website Tools enabled) or Chrome 152+ with WebMCP testing enabled, use the following sequence of exact prompts:

1. **Fleet Summary**:
   > “Use the available StagedOps website tools to get the fleet summary. Do not modify anything. Report compliance, policy conflicts, managed devices, open changes, and the recommended next step.”

2. **Device Search & Inspection**:
   > “Find all Production-ring devices with active policy conflicts, then inspect `dev-035`. Do not change any policy.”

3. **Conflict Explanation**:
   > “Explain the highest-impact policy conflict, including the competing policies, affected scope, latent risks, and safest exact correction.”

4. **Simulation**:
   > “Simulate the recommended correction from 2 days to 7 days. Do not stage or apply it. Report before/after compliance, resolved devices, remaining blockers, and risks.”

5. **Staging**:
   > “Stage that exact simulation as a visible change plan, but do not authorize or apply it.”

6. **Unauthorized Apply Attempt**:
   > “Try to apply the staged change before I authorize it. Explain why application is unavailable and what human action is required.”

7. **Authorized Apply Execution**:
   > “The human has now clicked ‘Authorize agent’. Apply the staged change once, then get the fleet summary and audit log to verify the result.”

8. **Latent Blocker Verification**:
   > “Inspect the two devices that remain noncompliant and explain why the policy change did not resolve them.”

9. **Snapshot Rollback**:
   > “Roll back the last applied change, then verify that the original policy configuration, 80.0% compliance, and 12 policy conflicts were restored while the audit history was retained.”
