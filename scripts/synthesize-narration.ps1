Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice('Microsoft Zira Desktop')
$synth.Rate = 0
$target = Join-Path (Get-Location).Path "docs\videos\narration.wav"
$synth.SetOutputToWaveFile($target)

$narration = @"
Welcome to StagedOps, the Human-Guided Endpoint Change Lab. In enterprise IT, AI agents could automate routine fleet maintenance, if only we could trust them with production endpoints. StagedOps solves this by implementing the new WebMCP browser standard with a defense-in-depth human authorization gate. Right now, our deterministic sixty-device fleet sits at eighty percent compliance with twelve active policy collisions across Finance, Operations, and Sales. Notice our WebMCP status: nine tools are registered, but the apply tool is strictly locked.

Our AI agent queries the fleet summary and immediately spots the twelve-device collision. When instructed to find affected Production devices, it inspects device dev-035. Through WebMCP, the agent diagnoses the exact collision: Standard Update Window enforces a seven-day restart deadline, while Rapid Update Enforcement demands two days. The effective deadline cannot resolve, throwing twelve production devices into noncompliance.

The agent simulates aligning the rapid policy to seven days. Crucially, simulation is completely read-only. It projects that ten devices will become compliant, while dev-035 and dev-036 will remain blocked because their operating system is below version twelve. The agent then stages this change plan. Notice that staging creates a visible artifact in our Change Plan drawer, but zero policies have changed on our endpoints.

If the agent attempts to apply this change unilaterally, WebMCP rejects it with authorization required. The apply tool is not even registered in the browser runtime. As the IT administrator, I inspect the twelve-device blast radius, verify the rollback guarantee, and click Authorize agent. This grants a single-use, five-minute authorization bound strictly to this stage ID, dynamically registering our tenth tool: apply_staged_change.

With human authorization granted, the agent executes apply_staged_change atomically. The state commits to Local Storage and updates our live dashboard: compliance rises from eighty percent to ninety-six point seven percent, and policy collisions drop to zero. Instantly, the apply tool is unregistered from WebMCP to prevent duplicate execution. When we inspect dev-035, we see the policy collision is resolved, but it accurately reflects the remaining OS eleven point two prerequisite blocker.

If operational needs require reverting, rollback is available with a single click. The exact pre-apply snapshot is restored: eighty percent compliance and twelve conflicts return instantly. Switching to our Audit view, notice that our audit log is append-only: every inspection, stage, authorization, apply, and rollback is permanently preserved with tamper-evident actor attribution. This is StagedOps, where autonomous agents propose, simulate, and assist, while humans retain absolute control.
"@

$synth.Speak($narration)
$synth.Dispose()
Write-Host "Narration generated successfully at $target"
