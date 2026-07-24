import { readFile, writeFile } from 'node:fs/promises';

let status = await readFile('WORK_STATUS.md', 'utf8');
status = status.replace(
  `- **Current Phase:** Phase 4 — Accepted Dynamic TAA Tuning Hotfix (Deployment Pending)
- **Current Branch:** \`agent/phase-04-taa-tuning-panel\` / Draft PR #13
- **Overall Progress:** 5 / 15 phases accepted; Phase 4 remains accepted and immutable while its public Dynamic TAA tuning surface awaits exact deployment
- **Current Task:** P4-13 — Public Dynamic TAA tuning API, complete parameter panel, and exact Pages deployment
- **Last Completed Task:** P4-12 — Merge, exact public Phase 0–4/Latest WebGPU verification, and immutable \`phase-04-accepted\` freeze
- **Next Action:** Require the final user-authored governance Head to pass complete \`pnpm verify\`, then mark PR #13 ready, merge with expected-Head protection, deploy Pages, and verify the public tuning panel
- **CI Status:** Implementation, append-only provenance, and canonical formatting passed complete verification; final user-authored Head pending standard read-only CI
- **Acceptance Status:** Phase 0–4 Accepted; Phase 4 tuning hotfix Deployment Pending; Phase 5 Draft PR #12 paused until the tuning panel is public
- **Known Blockers:** None
- **Last Updated:** 2026-07-23 09:10 PDT`,
  `- **Current Phase:** Phase 4 — Final TRAA and Explicit Velocity Integration
- **Current Branch:** \`phase-04-final\` / Draft PR #16
- **Overall Progress:** 5 / 15 phases accepted; the immutable Phase 4 acceptance remains valid while a final compatible TRAA/Velocity refinement is verified for the live Phase 4 routes
- **Current Task:** P4-14 — Integrate explicit rigid-object Velocity and the complete compatible TRAA resolve controls without replacing the accepted forward temporal pipeline
- **Last Completed Task:** P4-13 — Public Dynamic TAA tuning API and seven-control Phase 4 Pages panel merged to \`main\`
- **Next Action:** Require PR #16 to pass complete \`pnpm verify\`, mark it ready, merge with expected-Head protection, require green main CI and Pages deployment, then verify public \`/phase-4/\` and \`/latest/\` before resuming Phase 5
- **CI Status:** TRAA/Velocity package build and canonical Shader validation PASS; complete repository verification pending
- **Acceptance Status:** Phase 0–4 Accepted; Phase 4 final refinement In Development; Phase 5 Draft PR #12 remains paused until the refined public routes are verified
- **Known Blockers:** None
- **Last Updated:** 2026-07-24 01:30 PDT`,
);
status = status.replace(
  `|    04 | Accepted / Tuning Hotfix | \`agent/phase-04-taa-tuning-panel\`    | #13 | FINAL CI    | Phase Accepted | \`phase-04-accepted\` |`,
  `|    04 | Accepted / Final Refinement | \`phase-04-final\`                 | #16 | CORE PASS / FINAL PENDING | Phase Accepted | \`phase-04-accepted\` |`,
);
await writeFile('WORK_STATUS.md', status, 'utf8');

let tasks = await readFile('docs/execution/PHASE_04_TASKS.md', 'utf8');
tasks = tasks.replace(
  `Phase status: **Phase Accepted — Post-Acceptance Tuning Hotfix Deployment Pending**
Branches: \`agent/phase-04-temporal\`, \`agent/phase-04-public-verification\`, \`agent/phase-04-taa-tuning-panel\`
Pull requests: \`#7\`, \`#10\`, \`#13\``,
  `Phase status: **Phase Accepted — Final TRAA/Velocity Refinement In Development**
Branches: \`agent/phase-04-temporal\`, \`agent/phase-04-public-verification\`, \`agent/phase-04-taa-tuning-panel\`, \`phase-04-final\`
Pull requests: \`#7\`, \`#10\`, \`#13\`, \`#16\``,
);
tasks = tasks.replace(
  `| P4-13 | Expose complete live Dynamic TAA tuning through the public SDK and Phase 4 Pages panel                      | P4-12             | Seven parameters, four presets, History-only resets, unchanged GPU resources, local/public E2E, exact Pages deployment | In Development |`,
  `| P4-13 | Expose complete live Dynamic TAA tuning through the public SDK and Phase 4 Pages panel                      | P4-12             | Seven parameters, four presets, History-only resets, unchanged GPU resources, local/public E2E, exact Pages deployment | Completed      |
| P4-14 | Integrate compatible TRAA resolve behavior and explicit rigid-object Velocity as the final Phase 4 refinement | P4-13             | Current-only RG16F Velocity MRT, prior rigid transforms, edge/disocclusion/variance/motion/flicker controls, complete verify and public Pages | In Development |`,
);
tasks = tasks.replace(
  `- P4-13 remains In Development until exact Pages deployment exposes the panel on \`/phase-4/\` and
  \`/latest/\`, and the public online gate verifies the controls through WebGPU.`,
  `- P4-13 was merged to \`main\` through PR #13 and is the Phase 4 tuning baseline for P4-14.`,
);
tasks += `

## P4-14 final TRAA and Velocity scope

- Add one current-only \`rg16float\` Velocity MRT while retaining the accepted Color/Depth/Normal
  History ping-pong sets and the existing forward PBR pass order.
- Store prior rigid-object World transforms plus current/previous unjittered Camera transforms and
  generate explicit screen-space Velocity without creating a Deferred or G-buffer pipeline.
- Integrate closest-depth edge selection, Velocity-first reprojection with Camera fallback,
  previous-depth disocclusion validation, AABB plus optional variance clipping, motion and subpixel
  History reduction, minimum current-frame contribution, and HDR luminance flicker reduction.
- Expose Edge Depth Difference, Max Velocity Length, Minimum Current Weight, Variance Clip Gamma,
  Subpixel Correction, and Flicker Reduction alongside all existing public TAA controls.
- Keep advanced controls disabled by default except the inert Velocity range so the accepted visual
  reference and numerical TAA oracle remain unchanged until a user selects a new preset or value.
- Reserve deforming previous-position support for Skinning, Morph, and Instancing to Phase 7, where
  those geometry systems and ownership contracts actually exist.

## P4-14 verification and deployment gate

- Core package build and all canonical Shader mirrors passed before the source checkpoint was committed.
- PR #16 must pass the complete repository \`pnpm verify\` gate, including all unit, browser/WebGPU,
  visual, resource, bundle, acceptance, Pages-build, and documentation-governance checks.
- After merge, main CI, Pages deployment, and public \`/phase-4/\` plus \`/latest/\` interaction checks
  must pass before P4-14 is marked Completed or Phase 5 resumes.
`;
await writeFile('docs/execution/PHASE_04_TASKS.md', tasks, 'utf8');

let log = await readFile('docs/execution/WORK_LOG.md', 'utf8');
log += `

## 2026-07-24 01:30 PDT — P4-14 final TRAA and explicit Velocity core built

### Trigger

- Owner review of the public Phase 4 Dynamic TAA result requested integration of the researched
  Three.js TRAA and Velocity behaviors before Phase 5, while explicitly preserving the current
  forward temporal pipeline and minimizing structural change.

### Completed

- Created \`phase-04-final\` from the current merged \`main\` and opened Draft PR #16.
- Added a current-only \`rg16float\` Velocity attachment to the existing PBR temporal MRT; retained
  the accepted Color/Depth/Normal History ping-pong, Static Accumulation, Present, Surface, Resize,
  Device Lost, and Dispose ownership contracts.
- Added prior rigid-object World matrices and current/previous unjittered Camera matrices to the
  append-only PBR object Uniform contract without changing established Material/IBL offsets.
- Upgraded the existing single full-screen Resolve pass with edge-aware closest-depth Velocity,
  Velocity-first reprojection with Camera fallback, previous-depth disocclusion validation, AABB and
  optional variance clipping, motion/subpixel weighting, minimum current contribution, and HDR
  luminance flicker reduction.
- Added six advanced public settings with accepted behavior preserved by default. Deforming
  Skinning/Morph/Instancing previous positions remain reserved for Phase 7 because those systems do
  not exist in Phase 4.

### Validation

- The core checkpoint passed the package build and exact generated-Shader mirror validation before
  GitHub Actions committed the transformed production source.
- The complete repository gate, public parameter panel, updated unit expectations, browser/WebGPU
  behavior, visual invariance, bundle budgets, and Pages build remain pending this PR's final
  authoritative verification run.

### Next

- Run complete \`pnpm verify\` on the final public-control and test checkpoint.
- If green, mark PR #16 ready, merge with expected-Head protection, require green main CI and Pages
  deployment, verify public \`/phase-4/\` and \`/latest/\`, then resume Phase 5 from its existing Draft PR.
`;
await writeFile('docs/execution/WORK_LOG.md', log, 'utf8');
