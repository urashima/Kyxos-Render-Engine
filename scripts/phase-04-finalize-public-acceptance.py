from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

SOURCE_SHA = "0a36ee51b5b40ae2d248f6643deda22090e37e81"
REPAIR_RUN = "30142165936"
MAIN_CI_RUN = "30142381965"
PAGES_RUN = "30142555067"
PAGES_BUILD_JOB = "89638473002"
PAGES_DEPLOY_JOB = "89638523792"
PAGES_PUBLIC_JOB = "89638542938"
PAGES_DEPLOYMENT = "5598181946"
INDEPENDENT_RUN = "30142636656"
EVIDENCE_ARTIFACT = "8615063109"


def replace_once(content: str, old: str, new: str, label: str) -> str:
    count = content.count(old)
    if count != 1:
        raise SystemExit(f"expected one {label} match, found {count}")
    return content.replace(old, new, 1)


updated = datetime.now(ZoneInfo("America/Los_Angeles")).strftime("%Y-%m-%d %H:%M PDT")

status_lines = [
    "# Kyxos Render Engine Work Status",
    "",
    "- **Current Phase:** Phase 5 — Shadows, AO, and Standard Post-Processing",
    "- **Current Branch:** `agent/phase-05-lighting-postfx` / Draft PR #12",
    "- **Overall Progress:** 5 / 15 phases accepted; Phase 5 remains in development with P5-01 preserved",
    "- **Current Task:** P5-02 — Add backend-portable Directional/Spot Light contracts and Scene-owned deterministic light registry",
    "- **Last Completed Task:** P4-14 — Final TRAA, explicit rigid-object Velocity, and coordinated public History resource stability",
    f"- **Next Action:** Synchronize `agent/phase-05-lighting-postfx` / Draft PR #12 with current `main` at `{SOURCE_SHA}`, preserve P5-01 and existing P5-02 work, then pass complete `pnpm verify` before continuing P5-02",
    f"- **CI Status:** P4-14 coordinated-role Verify Run `{REPAIR_RUN}` PASS; main Phase verification Run `{MAIN_CI_RUN}` PASS; Pages Run `{PAGES_RUN}` build/deploy/public interaction PASS; independent public Run `{INDEPENDENT_RUN}` PASS",
    "- **Acceptance Status:** Phase 0–4 Accepted; Phase 5 In Development",
    "- **Known Blockers:** No remaining Phase 4 blocker; Phase 5 PR #12 requires synchronization with current `main`",
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
    "|    04 | Phase Accepted | `phase-04-coordinated-history-roles`   | #31 | PASS | Phase Accepted | `phase-04-accepted` |",
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
    "Branches: `agent/phase-04-temporal`, `agent/phase-04-public-verification`, `agent/phase-04-taa-tuning-panel`, `phase-04-final`, `phase-04-history-role-stability`, `phase-04-non-reusable-history-roles`",
    "Branches: `agent/phase-04-temporal`, `agent/phase-04-public-verification`, `agent/phase-04-taa-tuning-panel`, `phase-04-final`, `phase-04-history-role-stability`, `phase-04-non-reusable-history-roles`, `phase-04-coordinated-history-roles`, `phase-04-resource-stability-finalize`",
    "Phase branches",
)
ledger = replace_once(
    ledger,
    "Pull requests: `#7`, `#10`, `#13`, `#16`, `#20`, `#27`",
    "Pull requests: `#7`, `#10`, `#13`, `#16`, `#20`, `#27`, `#31`, `#33`",
    "Phase pull requests",
)
ledger = replace_once(
    ledger,
    "Previous accepted source: `f926f544c94da2c5ea8f9630c959398b15d2d84f`",
    f"Final accepted source: `{SOURCE_SHA}`",
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
    "- Phase 5 development resumes only after PR #27 passes the exact public resource-stability gate.",
    "- Phase 5 resumes from Draft PR #12 only after synchronization with the final accepted Phase 4 source.",
    "Phase 5 handoff boundary",
)
final_section = "\n".join(
    [
        "## P4-14 public resource-stability final acceptance",
        "",
        "- The official Pages gate isolated the remaining 74/75 → 76 change to two lazily discovered Static",
        "  Accumulation Bind Groups. Texture, Buffer, Pipeline, Renderer, Canvas, and History allocations",
        "  remained stable; the issue was a bounded but non-canonical Dynamic-output × Static-read role pair.",
        "- PR #31 moved role coordination to `TemporalPipelineTransaction`: when History is non-reusable on",
        "  an accumulating frame, Static Accumulation selects the prepared Dynamic TAA write role. The two",
        "  warmed canonical Bind Groups are therefore reused through direct signature and explicit resets.",
        f"- Focused regressions and complete `pnpm verify` passed in Run `{REPAIR_RUN}`; PR #31 was",
        f"  squash-merged to `main` as `{SOURCE_SHA}`.",
        f"- Exact main Phase verification Run `{MAIN_CI_RUN}` passed. Pages Run `{PAGES_RUN}` passed build",
        f"  job `{PAGES_BUILD_JOB}`, deployment job `{PAGES_DEPLOY_JOB}`, and official public interaction",
        f"  job `{PAGES_PUBLIC_JOB}`. GitHub Pages deployment `{PAGES_DEPLOYMENT}` is bound to the exact source.",
        f"- Independent public Run `{INDEPENDENT_RUN}` passed the repository-owned Chromium/WebGPU suite for",
        "  `/phase-0/` through `/phase-4/` and `/latest/`; Artifact",
        f"  `{EVIDENCE_ARTIFACT}` preserves the machine-readable evidence.",
        "- Repeated Jitter → Default resets now keep the captured GPU-resource baseline unchanged. The",
        "  immutable `phase-04-accepted` tag, visual baseline, numerical tolerances, defaults, and Phase 0–3",
        "  routes were not rewritten.",
        "",
    ]
)
ledger, count = re.subn(
    r"## P4-14 public resource-stability re-verification\n.*?(?=### P4-14 visual-baseline isolation)",
    final_section,
    ledger,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"expected one public re-verification section, found {count}")
ledger_path.write_text(ledger, encoding="utf-8")

log_path = Path("docs/execution/WORK_LOG.md")
log = log_path.read_text(encoding="utf-8")
marker = f"## {updated.split()[0]} — P4-14 coordinated public resource stability accepted"
if marker not in log:
    entry = "\n".join(
        [
            "",
            "",
            marker,
            "",
            "### Trigger",
            "",
            "- The clean public Phase 4 gate still discovered two additional Static Accumulation Bind Groups",
            "  after TAA configuration reset even though all owned GPU allocations remained bounded.",
            "",
            "### Completed",
            "",
            "- Traced the exact cross-role combinations between the prepared Dynamic TAA write target and the",
            "  Static Accumulation read target.",
            "- Coordinated both roles in `TemporalPipelineTransaction`, preserving the existing ping-pong",
            "  textures and reusing only the two canonical Bind Groups through direct accumulating resets.",
            "- Added a lifecycle regression that warms the canonical pairs, changes the signature directly in",
            "  accumulation, and proves both Bind Group count and total active resources remain unchanged.",
            f"- Squash-merged PR #31 to `main` as `{SOURCE_SHA}` and redeployed the accepted Phase history.",
            "- Restored P4-14 to Completed and Phase 4 to Accepted without moving the immutable acceptance tag.",
            "",
            "### Validation",
            "",
            f"- Focused History/Temporal Pipeline regressions and complete `pnpm verify`: PASS — Run `{REPAIR_RUN}`.",
            f"- Exact main Phase verification: PASS — Run `{MAIN_CI_RUN}`.",
            f"- Pages accepted-history build: PASS — Run `{PAGES_RUN}`, job `{PAGES_BUILD_JOB}`.",
            f"- GitHub Pages deployment: PASS — deployment `{PAGES_DEPLOYMENT}`, job `{PAGES_DEPLOY_JOB}`.",
            f"- Official public Chromium/WebGPU interactions: PASS — job `{PAGES_PUBLIC_JOB}`.",
            f"- Independent public Phase 0–4 and Latest verification: PASS — Run `{INDEPENDENT_RUN}`, Artifact",
            f"  `{EVIDENCE_ARTIFACT}`.",
            "- Public `/phase-4/` and `/latest/` both serve the exact accepted source and preserve the captured",
            "  resource baseline through repeated Jitter → Default resets.",
            "",
            "### Next",
            "",
            f"- Synchronize `agent/phase-05-lighting-postfx` / Draft PR #12 with `{SOURCE_SHA}`, preserve P5-01",
            "  and existing P5-02 work, and pass complete `pnpm verify` before continuing P5-02.",
            "",
        ]
    )
    log += entry
log_path.write_text(log, encoding="utf-8")
