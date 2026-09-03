# StagedOps Implementation Plan

## Global Constraints

- Product name is **StagedOps** and all shipped copy, source comments, documentation, and metadata are English. `PolicyPilot` must not appear in tracked files.
- Use React, TypeScript, Vite, pnpm, deterministic demo data, and Local Storage only. No real vendor, endpoint-management, Microsoft, Intune, OpenAI, or other remote application API is permitted.
- The app must remain fully usable without WebMCP. UI and WebMCP must call the same domain queries and commands against the same state.
- Exactly 60 devices exist across Engineering, Finance, Operations, Sales, and Support. Each department has 2 Pilot, 6 Staging, and 4 Production devices.
- Twelve Production devices across Finance, Operations, and Sales initially conflict because `pol-standard-update-window` sets `updates.restartDeadlineDays` to 7 while `pol-rapid-update-enforcement` sets it to 2.
- Changing the rapid policy from 2 to 7 resolves ten conflicts. `dev-035` and `dev-036` remain noncompliant because OS 11.2 is below minimum OS 12. Initial compliance is 48/60 (80.0%); applied compliance is 58/60 (96.7%).
- The visual direction is a permanently light enterprise command center with true white/cool-gray surfaces, navy text, a cobalt action accent, restrained semantic colors, moderate information density, and high screenshot/video legibility. Do not add a dark theme, decorative gradients, protected logos, or marketing-page framing.
- A change is never applied without a visible, five-minute, one-use human authorization bound to the active stage and configuration revision. Stage does not authorize or apply. Apply consumes authorization. Rollback restores the exact operational snapshot and retains append-only audit evidence.
- Target WCAG 2.2 AA and responsive layouts at 360x800, 768x1024, 1280x720, and 1440x900 with no page-level horizontal overflow.
- Use TDD for behavioral production code: add a focused failing test, verify the expected failure, implement minimally, then refactor with tests green.

## Task 1: Application foundation and deterministic domain engine

Scaffold the React/TypeScript/Vite project with pnpm, ESLint, Vitest, Testing Library, and the dependencies named in the approved plan. Create the core domain types, deterministic 60-device seed, policy evaluator, selectors, simulation, persistent staging, five-minute one-use authorization, atomic apply, exact-snapshot rollback, reset, strict hydration recovery, append-only audit, monotonic state/config revisions, and an immutable external store suitable for `useSyncExternalStore`.

Persist the versioned envelope under `stagedops.demo.v1`. Derived compliance/conflicts must not be persisted. Validation or storage-write failure must not publish a partial state. Authorization and the simulation cache are session-memory only. Direct UI and future WebMCP callers must use exported query/command functions rather than duplicating logic.

Add focused unit tests that demonstrate the initial 48/60 and 12-conflict state, the ten-device improvement and two OS blockers, stage without mutation, denial without authorization, authorization expiry/mismatch/one-use behavior, atomic apply, exact rollback, reset, corrupt-state recovery, and persistence failure behavior. Run the focused tests, then the full unit suite, typecheck, and lint before committing.

## Task 2: WebMCP schemas, handlers, and dynamic registration

Implement the ten approved tools: `get_fleet_summary`, `find_devices`, `inspect_device`, `explain_policy_conflicts`, `simulate_policy_change`, `stage_policy_change`, `get_staged_change`, `apply_staged_change`, `rollback_last_change`, and `get_audit_log`.

Put the real, easy-to-find imperative integration in `src/webmcp/registerTools.ts` and call `await document.modelContext.registerTool(...)` directly. Register nine base tools. Register `apply_staged_change` only while human authorization is valid and remove it with its own `AbortController` after invocation, revocation, expiry, stage replacement, refresh, or reset. Delay post-invocation registration abort until the result has completed for Chrome compatibility.

Use JSON Schema 2020-12 object schemas with `additionalProperties: false` at every object level and Ajv runtime validation. Descriptions explicitly state side effects. Tools 1-5, 7, and 10 use `readOnlyHint: true`; stage, apply, and rollback use false. Support optional invocation abort signals and return the approved structured success/error envelope with summary, data or error, recommended next step, and revision metadata.

Add tests for every schema and handler, runtime rejection of extra/invalid properties, read-only annotations, error envelopes, stale revisions, cancellation, visible UI-signal publication, the nine/ten/nine registration lifecycle, and defense-in-depth authorization inside the apply handler. Run focused tests, then the full unit suite, typecheck, and lint before committing.

## Task 3: Approved enterprise UI and accessible manual workflow

Implement the light command-center application shell and four views: Overview, Devices, Policies, and Audit. Include navigation, page header, prominent Reset demo control, persistent WebMCP status, KPI strip, fleet-health visualization, current conflict workbench, simulation panel, filterable/sortable/paginated device table, mobile device cards, device inspector, policy comparison, agent-result panel, and live activity/audit log.

Implement the 520px desktop, 440px tablet, and full-screen mobile change-plan drawer. It must show the 2-to-7 diff, before/after metrics, twelve-device blast radius, ten resolved devices, two named OS blockers, risks, authorization status, revoke/manual-apply fallback, applied result, and rollback. Manual apply uses the same command and authorization gate and is attributed to Human.

Use the locked visual tokens and code-native UI text. Provide semantic landmarks, one h1, a skip link, visible focus states, labeled filters, real table headers with `aria-sort`, dialog focus trapping/restoration, Escape support, non-color status cues, live regions, reduced motion, and 44px primary/mobile targets. Tool/UI signals update visible context without stealing focus except when opening a newly staged plan.

Write component tests first for manual inspect/simulate/stage/authorize/apply/verify/rollback, reset, unavailable-WebMCP fallback, filter behavior, and critical accessibility semantics. Run focused tests, the full unit suite, typecheck, lint, and a production build before committing.

## Task 4: Browser verification, screenshots, and release documentation

Add Playwright configuration and browser tests for the complete manual workflow and a mocked `document.modelContext`, including dynamic apply registration, direct tool-driven UI updates, keyboard-only behavior, responsive breakpoints, and an automated accessibility scan with no serious or critical violations. Capture six deterministic 1440x900 screenshots in `docs/screenshots`: baseline, simulation, staged, human-authorized, applied, and rolled back.

Add a root MIT `LICENSE`; a polished English README; `docs/demo-script.md`; `docs/devpost-submission.md`; `docs/deployment.md`; and `docs/submission-checklist.md`. The README must make `src/webmcp/registerTools.ts` easy to locate, explain setup/architecture/WebMCP/testing/deployment, list exact installed technologies, link the public deployment placeholder, and end with exact ChatGPT/Codex prompts. The demo script must fit under three minutes with audio and end with the same prompts.

Configure Vite development/preview headers and Cloudflare Pages `_headers` for `Origin-Agent-Cluster: ?1` and `Permissions-Policy: tools=(self)`. Provide a build-time mechanism that adds `Origin-Trial` only when a real exact-origin token is supplied; never commit a dummy token.

Run lint, typecheck, unit tests, Playwright tests, and production build. Compare the 1440x900 browser render against both approved concept images using `view_image`, record a five-point fidelity ledger, fix visible mismatches, and commit.

## Task 5: Public repository, deployment, and real-browser verification

Verify `rg -ni "PolicyPilot" .` returns no tracked product references. Create and push the public GitHub repository `Darkatek7/stagedops`. Deploy the production build to Cloudflare Pages using the exact-origin WebMCP trial token when available, confirm the required response headers, and confirm the public UI works without authentication or setup.

Verify the WebMCP workflow in ChatGPT's in-app browser with Website Tools enabled and a supported model, or in Chrome 149+ with WebMCP enabled if the in-app browser is unavailable. Confirm nine base tools, ten after visible human authorization, nine after one apply, immediate UI synchronization, structured errors, audit actor distinction, and rollback restoration. Update documentation with the final public URL, repository URL, commands, verification evidence, screenshot links, and any externally blocked checklist items.
