# StagedOps – Human-Guided Endpoint Change Lab
*WebMCP Hackathon Submission*

---

## 1. Elevator Pitch

**StagedOps** is a client-side endpoint policy change lab powered by the W3C/Chrome WebMCP standard. It proves that autonomous AI agents can safely diagnose enterprise fleet misconfigurations, simulate safe remediations, and stage changes—without ever executing modifications until a human administrator reviews the 12-device blast radius and explicitly unlocks a single-use execution gate.

---

## 2. The Problem: Silent Endpoint Collisions & The Agent Safety Dilemma

Modern enterprise endpoint management systems (such as Microsoft Intune, Group Policy, and Jamf) manage thousands of heterogeneous laptops, desktops, and mobile workstations across distributed rings and business departments. In real-world enterprise operations:

1. **Silent Policy Collisions**: Multiple overlapping policies (e.g., a standard company-wide update baseline vs. an aggressive rapid-security mandate) frequently assign conflicting deadline values to the same production endpoints. The resulting collision leaves devices in limbo, noncompliant, or restarting unexpectedly.
2. **Latent Dependencies**: Remediating a policy setting might solve a logical collision, yet leave endpoints noncompliant due to hidden hardware or OS version prerequisites (e.g., an outdated macOS/Windows build below required version 12).
3. **The Autonomous Agent Risk**: IT directors want AI agents to analyze complex telemetry and formulate remediation plans. However, granting an LLM direct, unsupervised write access to production endpoint management APIs is an unacceptable catastrophic risk. A hallucinated or misscoped policy change can brick thousands of executive laptops.

---

## 3. Why WebMCP: Direct, Safe, Standardized Browser Integration

Traditional agent integrations rely on brittle screen scraping, complex browser extensions, or direct backend API tokens with excessive privileges. The emerging **WebMCP** standard changes everything:

- **Browser-Native Discovery**: Tools are registered imperatively via `document.modelContext.registerTool()`. When an AI assistant (like ChatGPT in-app browser or Chrome AI) navigates to StagedOps, the agent immediately discovers typed, documented, and bounded tools without server-side middleware.
- **Strict JSON Schema 2020-12**: Every StagedOps tool validates inputs with strict schemas (`type: "object"`, `additionalProperties: false`, and bounded enums). Schema validation runs in-browser via Ajv before domain execution, preventing malformed tool invocations from ever reaching state stores.
- **Progressive Enhancement**: StagedOps is 100% functional without WebMCP. When WebMCP is unavailable, human administrators use the accessible command-center UI. When WebMCP is available, human and agent interact with the exact same domain queries, stores, and audit logs.

---

## 4. The Human–Agent Collaboration Model: Defense-in-Depth Authorization

StagedOps introduces an architecture for safe agentic operation in mission-critical enterprise environments:

```
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│   Agent Reads   │ ────> │ Agent Simulates │ ────> │   Agent Stages  │
│  Fleet Metrics  │       │  & Models Blast │       │  Visible Plan   │
└─────────────────┘       └─────────────────┘       └─────────────────┘
                                                             │
                                                             ▼
                                                    ┌─────────────────┐
                                                    │   Human Admin   │
                                                    │ Reviews Diff &  │
                                                    │  Blast Radius   │
                                                    └─────────────────┘
                                                             │
                                                             ▼ (Clicks "Authorize agent")
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│ Tool Removed &  │ <──── │ Agent Executes  │ <──── │ Dynamic Tool 10 │
│ State Committed │       │  Apply Once     │       │ Registered      │
└─────────────────┘       └─────────────────┘       └─────────────────┘
```

1. **Read & Explain**: The agent reads the 60-device fleet summary, queries specific rings, and explains the 12-device collision between `pol-standard-update-window` (7 days) and `pol-rapid-update-enforcement` (2 days).
2. **Simulate Without Mutating**: The agent simulates correcting the rapid enforcement deadline from 2 to 7 days. Simulation calculates the exact transition (48 compliant → 58 compliant) and identifies that `dev-035` and `dev-036` will remain blocked by OS version 11.2.
3. **Stage, Don't Apply**: The agent calls `stage_policy_change`. This generates a visible Change Plan drawer on the human dashboard and logs an immutable audit event. It does **not** change any policy and does **not** grant apply permission.
4. **Dynamic Runtime Registration**: In baseline state, only **9 tools** exist. If the agent attempts to apply, WebMCP rejects it with `AUTHORIZATION_REQUIRED`.
5. **The One-Use Human Gate**: The human administrator inspects the 12 affected devices, projected resolutions, and remaining blockers. When the human clicks **"Authorize agent"**, a 5-minute single-use authorization token is minted, and the 10th tool—`apply_staged_change`—is dynamically registered with its own `AbortController`.
6. **Self-Invalidating Apply**: As soon as `apply_staged_change` executes, it unregisters itself immediately from WebMCP, transitions the state atomically to Local Storage, and updates the live dashboard to 96.7% compliance.
7. **Snapshot Rollback**: The human retains a one-click rollback guarantee that restores the exact pre-change snapshot while keeping the entire chronological audit trail.

---

## 5. Technical Implementation & Stack

- **Frontend Core**: React 19, TypeScript 5.9, Vite 8, pnpm 10.
- **WebMCP Integration**: Native `document.modelContext.registerTool()` following the Chrome M149–M156 draft specification and OpenAI Website Tools guidelines.
- **Validation**: Strict JSON Schema 2020-12 enforcement with Ajv 8.
- **State Management**: Zero-dependency immutable store wrapping a versioned Local Storage envelope (`stagedops.demo.v1`) synchronized via React 19's `useSyncExternalStore`.
- **Accessibility & UI**: Radix UI Dialog primitives, Lucide icons, Recharts responsive visualizations, custom design tokens, and WCAG 2.2 AA compliance verified via automated `@axe-core/playwright` scanning.
- **Verification Suite**: 78 unit/integration tests with Vitest, comprehensive Playwright end-to-end browser test suite simulating live WebMCP tool executions, keyboard navigation, and responsive layouts (360×800 to 1440×900).

---

## 6. Enterprise Impact & Measurable Value

- **Zero Accidental Outages**: By separating proposal from execution through runtime tool gating, organizations eliminate rogue agent deployments.
- **Audit-Ready Compliance**: Every agent query, staging event, human authorization, and execution is recorded in an immutable, append-only log with distinct actor attribution (`Human`, `Agent`, `System`).
- **High-Velocity Remediation**: IT teams shift from manually diagnosing JSON policy conflicts to reviewing well-reasoned, simulated change proposals with guaranteed blast radiuses.

---

## 7. Links & Resources

- **Public Live Application**: [https://stagedops.darkatek7.com](https://stagedops.darkatek7.com) (Canonical Pages: [https://stagedops-darkatek7-20260903.pages.dev](https://stagedops-darkatek7-20260903.pages.dev))
- **GitHub Repository**: [https://github.com/Darkatek7/stagedops](https://github.com/Darkatek7/stagedops)
- **Key Implementation File**: [`src/webmcp/registerTools.ts`](https://github.com/Darkatek7/stagedops/blob/main/src/webmcp/registerTools.ts)
- **Demo Script**: [`docs/demo-script.md`](https://github.com/Darkatek7/stagedops/blob/main/docs/demo-script.md)
- **Deployment & Headers**: [`docs/deployment.md`](https://github.com/Darkatek7/stagedops/blob/main/docs/deployment.md)
