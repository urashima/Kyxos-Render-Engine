from __future__ import annotations

import os
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"missing required environment variable: {name}")
    return value


def replace_once(content: str, old: str, new: str, label: str) -> str:
    count = content.count(old)
    if count != 1:
        raise SystemExit(f"expected one {label} match, found {count}")
    return content.replace(old, new, 1)


accepted_sha = required_env("ACCEPTED_SOURCE_SHA")
main_ci = required_env("MAIN_CI_RUN")
pages_run = required_env("PAGES_RUN")
build_job = required_env("PAGES_BUILD_JOB")
deploy_job = required_env("PAGES_DEPLOY_JOB")
public_job = required_env("PAGES_PUBLIC_JOB")
deployment = required_env("PAGES_DEPLOYMENT")
updated = datetime.now(ZoneInfo("America/Los_Angeles")).strftime("%Y-%m-%d %H:%M PDT")

status_lines = [
    "# Kyxos Render Engine Work Status",
    "",
    "- **Current Phase:** Phase 5 — Shadows, AO, and Standard Post-Processing",
    "- **Current Branch:** `agent/phase-05-lighting-postfx` / Draft PR #12",
    "- **Overall Progress:** 5 / 15 phases accepted; Phase 5 remains in development with P5-01 preserved",
    "- **Current Task:** P5-02 — Add backend-portable Directional/Spot Light contracts and Scene-owned deterministic light registry",
    "- **Last Completed Task:** P4-14 — Final TRAA, explicit rigid-object Velocity, and public History resource stability",
    f"- **Next Action:** Synchronize `agent/phase-05-lighting-postfx` / Draft PR #12 with current `main` at `{accepted_sha}`, preserve P5-01 and existing P5-02 work, then pass complete `pnpm verify` before continuing P5-02",
    f"- **CI Status:** P4-14 repair verification Run `30141128094` PASS; main Phase verification Run `{main_ci}` PASS; Pages Run `{pages_run}` build/deploy/public interaction PASS",
    "- **Acceptance Status:** Phase 0–4 Accepted; Phase 5 In Development",
    "- **Known Blockers:** No remaining Phase 4 blocker; Phase 5 PR #12 must be synchronized with current `main`",
    f"- **Last Updated:** {updated}",
    "",
    "`WORK_STATUS.md` intentionally does not duplicate the active branch Head SHA. GitHub branch/PR metadata is the",
    "source of truth for the current Commit; this file contains only human-readable current state and one",
    "Next Action.",
    "",
    "## Phase Progress",
    "",
    "| Phase | Status         | Branch                                 | PR  | CI   | Acceptance     | Tag                 |",
    "| ----: | -------------- | -------------------------------------- | --- | ---- | -------------- | ------------------- |",
    "|    00 | Phase Accepted | `agent/phase-00-foundation`            | #1  | PASS | Phase Accepted | `phase-00-accepted` |",
    "|    01 | Phase Accepted | `agent/phase-01-webgpu-core`           | #2  | PASS | Phase Accepted | `phase-01-accepted` |",
    "|    02 | Phase Accepted | `agent/phase-02-scene-camera`          | #3  | PASS | Phase Accepted | `phase-02-accepted` |",
    "|    03 | Phase Accepted | `agent/phase-03-pbr-ibl`               | #5  | PASS | Phase Accepted | `phase-03-accepted` |",
    "|    04 | Phase Accepted | `phase-04-signature-history-stability` | #28 | PASS | Phase Accepted | `phase-04-accepted` |",
    "|    05 | In Development | `agent/phase-05-lighting-postfx`       | #12 | SYNC | In Development | —                   |",
    "|    06 | Planned        | `agent/phase-06-assets`                | —   | —    | Planned        | —                   |",
    "|    07 | Planned        | `agent/phase-07-animation`             | —   | —    | Planned        | —                   |",
    "|    08 | Planned        | `agent/phase-08-material-extensions`   | —   | —    | Planned        | —                   |",
    "|    09 | Planned        | `agent/phase-09-sss`                   | —   | —    | Planned        | —                   |",
    "|    10 | Planned        | `agent/phase-10-webgl2`                | —   | —    | Planned        | —                   |",
    "|    11 | Planned        | `agent/phase-11-texture-lab`           | —   | —    | Planned        | —                   |",
    "|    12 | Planned        | `agent/phase-12-advanced-features`     | —   | —    | Planned        | —                   |",
    "|    13 | Planned        | `agent/phase-13-production`            | —   | —    | Planned        | —                   |",
    "|    14 | Planned        | `agent/phase-14-release`               | —   | —    | Planned        | —                   |",
    "",
]
Path("WORK_STATUS.md").write_text("\n".join(status_lines), encoding="utf-8")

ledger_path = Path("docs/execution/PHASE_04_TASKS.md")
ledger = ledger_path.read_text(encoding="utf-8")
ledger = replace_once(
    ledger,
    "Phase status: **Acceptance Reopened — P4-14 Public Resource-Stability Re-verification**",
    "Phase status: **Phase Accepted**",
    "Phase status",
)
ledger = replace_once(
    ledger,
    "Branches: `agent/phase-04-temporal`, `agent/phase-04-public-verification`, `agent/phase-04-taa-tuning-panel`, `phase-04-final`, `phase-04-history-role-stability`",
    "Branches: `agent/phase-04-temporal`, `agent/phase-04-public-verification`, `agent/phase-04-taa-tuning-panel`, `phase-04-final`, `phase-04-history-role-stability`, `phase-04-signature-history-stability`",
    "Phase branches",
)
ledger = replace_once(
    ledger,
    "Pull requests: `#7`, `#10`, `#13`, `#16`, `#20`",
    "Pull requests: `#7`, `#10`, `#13`, `#16`, `#20`, `#28`",
    "Phase pull requests",
)
ledger = replace_once(
    ledger,
    "Previous accepted source: `f926f544c94da2c5ea8f9630c959398b15d2d84f`",
    f"Final accepted source: `{accepted_sha}`",
    "accepted source",
)
ledger = replace_once(
    ledger,
    "| P4-14 | Integrate compatible TRAA resolve behavior and explicit rigid-object Velocity as the final Phase 4 refinement | P4-13             | Current-only RG16F Velocity MRT, prior rigid transforms, edge/disocclusion/variance/motion/flicker controls, complete verify and public Pages | In Development |",
    "| P4-14 | Integrate compatible TRAA resolve behavior and explicit rigid-object Velocity as the final Phase 4 refinement | P4-13             | Current-only RG16F Velocity MRT, prior rigid transforms, edge/disocclusion/variance/motion/flicker controls, complete verify and public Pages | Completed      |",
    "P4-14 status",
)
ledger = replace_once(
    ledger,
    "- Phase 5 development resumes only after PR #20 passes the exact public resource-stability gate.",
    "- Phase 5 resumes from Draft PR #12 only after synchronization with the final accepted Phase 4 source.",
    "Phase 5 handoff boundary",
)
replacement_lines = [
    "## P4-14 public resource-stability final acceptance",
    "",
    "- The repository-wide Pages gate exposed a 74 → 76 GPU-resource drift after repeated Jitter → Default",
    "  resets. Focused evidence proved the two additional resources were lazily discovered Static",
    "  Accumulation Bind Groups created from non-canonical History roles; Texture, Buffer, Pipeline,",
    "  Renderer, and Canvas ownership remained stable.",
    "- PR #20 restored canonical roles for explicit invalidation. The remaining public path used Temporal",
    "  signature mismatch, so PR #28 additionally restores Dynamic TAA and Static Accumulation read index 0",
    "  whenever History is not reusable and adds signature-mismatch regressions for both owners.",
    "- Repair verification Run `30141128094` passed focused Dynamic/Static History and Temporal Pipeline",
    f"  regressions plus complete `pnpm verify`; PR #28 was squash-merged as `{accepted_sha}`.",
    f"- Exact main Phase verification Run `{main_ci}` passed. Pages Run `{pages_run}` passed build job",
    f"  `{build_job}`, deploy job `{deploy_job}`, and official public interaction job `{public_job}`.",
    f"- GitHub Pages deployment `{deployment}` serves the exact accepted source through `/phase-4/` and",
    "  `/latest/`. The official and independent Chromium/WebGPU gates preserved the canonical 74-resource",
    "  baseline across repeated Jitter → Default resets.",
    "- The immutable `phase-04-accepted` tag, accepted visual baseline, numerical tolerances, defaults, and",
    "  Phase 0–3 routes were not rewritten.",
    "",
]
ledger, count = re.subn(
    r"## P4-14 public resource-stability re-verification\n.*?(?=### P4-14 visual-baseline isolation)",
    "\n".join(replacement_lines),
    ledger,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"expected one P4-14 re-verification section, found {count}")
ledger_path.write_text(ledger, encoding="utf-8")

log_path = Path("docs/execution/WORK_LOG.md")
log = log_path.read_text(encoding="utf-8")
marker = f"## {updated.split()[0]} — P4-14 public resource-stability final acceptance"
if marker not in log:
    entry_lines = [
        "",
        "",
        marker,
        "",
        "### Trigger",
        "",
        "- The clean deployed Phase 4 gate reproduced a 74 → 76 GPU-resource drift after public TAA parameter",
        "  resets, so acceptance remained reopened after the first explicit-invalidation role repair.",
        "",
        "### Completed",
        "",
        "- Added canonical read-role restoration whenever Dynamic TAA or Static Accumulation History is not",
        "  reusable, covering signature mismatch as well as explicit invalidation.",
        "- Added exact Dynamic and Static signature-mismatch role regressions without recreating Texture, Buffer,",
        "  Pipeline, Renderer, Canvas Surface, or accepted History resources.",
        f"- Squash-merged runtime repair PR #28 to `main` as `{accepted_sha}`.",
        "- Restored Phase 4 to Accepted and transferred the unique Next Action to synchronization of Phase 5",
        "  Draft PR #12.",
        "",
        "### Validation",
        "",
        "- Focused History/Temporal Pipeline and complete `pnpm verify`: PASS — Run `30141128094`.",
        f"- Main Phase verification: PASS — Run `{main_ci}`.",
        f"- Pages accepted-history build: PASS — Run `{pages_run}`, job `{build_job}`.",
        f"- GitHub Pages deployment: PASS — deployment `{deployment}`, job `{deploy_job}`.",
        f"- Official public Chromium/WebGPU interaction gate: PASS — job `{public_job}`.",
        "- Independent public suite: PASS for `/phase-0/` through `/phase-4/` and `/latest/`; Phase 4 repeated",
        "  Jitter → Default transitions retained the canonical GPU resource count of 74.",
        "",
        "### Next",
        "",
        f"- Synchronize `agent/phase-05-lighting-postfx` / Draft PR #12 with `{accepted_sha}`, preserve P5-01 and",
        "  existing P5-02 work, and pass complete `pnpm verify` before continuing P5-02.",
        "",
    ]
    log += "\n".join(entry_lines)
log_path.write_text(log, encoding="utf-8")
