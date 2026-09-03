# StagedOps Video Demonstration Script

**Target Duration**: 2:45 – 2:55  
**Setting**: Screen recording of StagedOps at 1440×900 in Chrome or ChatGPT desktop in-app browser with WebMCP enabled, accompanied by spoken audio narration.

---

### Phase 1: Introduction & Baseline Overview (0:00 – 0:25)

**Visual**: 
The browser opens to `https://stagedops-darkatek7-20260903.pages.dev/`. The cursor hovers over the header WebMCP badge reading *"WebMCP ready · 9 active + 1 approval-gated"*, then sweeps across the KPI strip showing 80.0% compliance and 12 policy conflicts.

**Narration (Speaker)**:
> "Welcome to StagedOps, the Human-Guided Endpoint Change Lab. In enterprise IT, AI agents could automate routine fleet maintenance—if only we could trust them with production endpoints. StagedOps solves this by implementing the new WebMCP browser standard with a defense-in-depth human authorization gate. 
> 
> Right now, our deterministic 60-device fleet sits at 80.0% compliance with 12 active policy collisions across Finance, Operations, and Sales. Notice our WebMCP status: nine tools are registered, but the apply tool is strictly locked."

---

### Phase 2: Agent Exploration & Conflict Diagnosis (0:25 – 0:55)

**Visual**:
The AI prompt dialog opens. Prompt 1 is submitted:
*"Use the available StagedOps website tools to get the fleet summary..."*
The visible UI highlights the Agent Result panel in real time. Prompt 2 is entered:
*"Find all Production-ring devices with active policy conflicts, then inspect dev-035..."*
The Devices view updates with filtered rows; `dev-035` is inspected showing competing 7-day baseline and 2-day rapid update policies. Prompt 3 runs:
*"Explain the highest-impact policy conflict..."*

**Narration (Speaker)**:
> "Our AI agent queries the fleet summary and immediately spots the 12-device collision. When instructed to find affected Production devices, it inspects device `dev-035`. 
> 
> Through WebMCP, the agent diagnoses the exact collision: `Standard Update Window` enforces a 7-day restart deadline, while `Rapid Update Enforcement` demands 2 days. The effective deadline cannot resolve, throwing 12 production devices into noncompliance."

---

### Phase 3: Simulation & Safe Staging (0:55 – 1:25)

**Visual**:
Prompt 4 is submitted:
*"Simulate the recommended correction from 2 days to 7 days. Do not stage or apply it..."*
The simulation result appears in the Policies view, projecting 96.7% compliance and identifying 2 remaining OS blockers. Prompt 5 is submitted:
*"Stage that exact simulation as a visible change plan, but do not authorize or apply it."*
The Change Plan drawer slides in from the right. The visual diff displays 2 days → 7 days, 10 resolved devices, and 2 remaining OS blockers.

**Narration (Speaker)**:
> "The agent simulates aligning the rapid policy to 7 days. Crucially, simulation is completely read-only. It projects that 10 devices will become compliant, while `dev-035` and `dev-036` will remain blocked because their operating system is below version 12.
> 
> The agent then stages this change plan. Notice that staging creates a visible artifact in our Change Plan drawer, but zero policies have changed on our endpoints."

---

### Phase 4: The Human Authorization Gate (1:25 – 1:55)

**Visual**:
Prompt 6 is submitted:
*"Try to apply the staged change before I authorize it..."*
The agent's tool call fails with `AUTHORIZATION_REQUIRED`, explaining that human approval is mandatory.
The human cursor moves to the drawer and clicks the prominent cobalt button: **"Authorize agent"**.
The drawer updates with the green badge: *"Authorized for one agent apply"*.
The WebMCP status pill changes to *"10 active"*, registering `apply_staged_change`.

**Narration (Speaker)**:
> "If the agent attempts to apply this change unilaterally, WebMCP rejects it with `AUTHORIZATION_REQUIRED`. The apply tool is not even registered in the browser runtime.
> 
> As the IT administrator, I inspect the 12-device blast radius, verify the rollback guarantee, and click 'Authorize agent'. This grants a single-use, 5-minute cryptographic authorization bound strictly to this stage ID, dynamically registering our tenth tool: `apply_staged_change`."

---

### Phase 5: Agent Execution & Blocker Verification (1:55 – 2:25)

**Visual**:
Prompt 7 is submitted:
*"The human has now clicked 'Authorize agent'. Apply the staged change once..."*
The drawer shows "Applied successfully". The Overview dashboard metrics update immediately: Compliance jumps to **96.7%**, Policy Conflicts drop to **0**.
WebMCP status reverts to 9 tools as `apply_staged_change` is immediately unregistered.
Prompt 8 is entered:
*"Inspect the two devices that remain noncompliant..."*
The Devices view filters to `dev-035`, showing status *"OS prerequisite blocked"* with effective deadline 7 days.

**Narration (Speaker)**:
> "With human authorization granted, the agent executes `apply_staged_change` atomically. The state commits to Local Storage and updates our live dashboard: compliance rises from 80% to 96.7%, and policy collisions drop to zero.
> 
> Instantly, the apply tool is unregistered from WebMCP to prevent duplicate execution. When we inspect `dev-035`, we see the policy collision is resolved, but it accurately reflects the remaining OS 11.2 prerequisite blocker."

---

### Phase 6: One-Click Rollback & Full Audit Retention (2:25 – 2:50)

**Visual**:
Prompt 9 is submitted:
*"Roll back the last applied change, then verify that the original policy configuration, 80.0% compliance, and 12 policy conflicts were restored while the audit history was retained."*
The Change Plan drawer opens, the human confirms rollback. The dashboard resets to 80.0% compliance and 12 conflicts. The user clicks into the **Audit** view, displaying the complete chronological audit trail with distinct icons for `Human`, `Agent`, and `System` actors.

**Narration (Speaker)**:
> "If operational needs require reverting, rollback is available with a single click. The exact pre-apply snapshot is restored: 80.0% compliance and 12 conflicts return instantly.
> 
> Switching to our Audit view, notice that our audit log is append-only: every inspection, stage, authorization, apply, and rollback is permanently preserved with tamper-evident actor attribution. This is StagedOps—where autonomous agents propose, simulate, and assist, while humans retain absolute control."

---

### Exact Demo Prompts

1. “Use the available StagedOps website tools to get the fleet summary. Do not modify anything. Report compliance, policy conflicts, managed devices, open changes, and the recommended next step.”
2. “Find all Production-ring devices with active policy conflicts, then inspect `dev-035`. Do not change any policy.”
3. “Explain the highest-impact policy conflict, including the competing policies, affected scope, latent risks, and safest exact correction.”
4. “Simulate the recommended correction from 2 days to 7 days. Do not stage or apply it. Report before/after compliance, resolved devices, remaining blockers, and risks.”
5. “Stage that exact simulation as a visible change plan, but do not authorize or apply it.”
6. “Try to apply the staged change before I authorize it. Explain why application is unavailable and what human action is required.”
7. “The human has now clicked ‘Authorize agent’. Apply the staged change once, then get the fleet summary and audit log to verify the result.”
8. “Inspect the two devices that remain noncompliant and explain why the policy change did not resolve them.”
9. “Roll back the last applied change, then verify that the original policy configuration, 80.0% compliance, and 12 policy conflicts were restored while the audit history was retained.”
