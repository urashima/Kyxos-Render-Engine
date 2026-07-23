# Contributing to Kyxos Render Engine

## Prerequisites

- Node.js 24.14.0, as pinned in `.nvmrc`.
- Corepack enabled.
- pnpm 11.7.0, as pinned by the root `packageManager` field.

```bash
corepack enable
pnpm install --frozen-lockfile
```

## Branches and commits

Phase work uses `agent/phase-XX-description` branches. Keep commits independently testable and limited to one coherent change.

```text
feat(webgpu): add device lifecycle
test(scheduler): cover sleep and wake
docs(phase-04): record temporal checkpoint
```

Do not rewrite accepted history, bypass a failing check, or merge an unverified Phase head.

## Required checks

Before a checkpoint is considered verified, run:

```bash
pnpm verify
```

Targeted iteration commands include:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm check:docs
pnpm check:boundaries
pnpm check:architecture
pnpm validate:shaders
pnpm build
pnpm check:bundle
pnpm test:e2e
```

Never delete tests, weaken assertions or visual thresholds without evidence, or report an unavailable capability as PASS.

## Architecture review

Every change must preserve [`docs/architecture/dependency-rules.md`](./docs/architecture/dependency-rules.md):

- Product code consumes only the public SDK or a dedicated Integration Adapter.
- Lower layers never import higher layers or private package paths.
- Native GPU objects remain inside concrete graphics backends.
- GPU resources have one owner and an explicit loss/disposal path.
- Features declare Dirty Flags and Temporal History reset behavior.
- Renderer Core contains no unconditional permanent RAF loop.
- Optional features declare capability and WebGL2 degrade/disable behavior.

A change to an accepted architecture decision must update or supersede an ADR in the same PR.

## Documentation governance

### Single source of truth

Use this order and do not copy the same state into another document:

1. Git branch, PR, CI, and immutable accepted tag are repository facts.
2. `WORK_STATUS.md` contains current state and exactly one Next Action.
3. `docs/execution/PHASE_XX_TASKS.md` is the only task-status ledger for that Phase.
4. `docs/execution/WORK_LOG.md` is the append-only checkpoint record.
5. `docs/acceptance/phase-XX/` contains acceptance evidence, not development planning.

PR descriptions summarize the branch but are not a state database. Do not store a duplicated “current Commit” in `WORK_STATUS.md`; the branch Head already provides it.

### Minimal document set

The only always-current project documents are:

- `README.md` — the single documentation index;
- `DEVELOPMENT_PLAN.md` — product and architecture roadmap;
- `PHASE_ACCEPTANCE_PLAN.md` — mandatory acceptance rules;
- `WORK_STATUS.md` — current state and one Next Action;
- one `PHASE_XX_TASKS.md` per started Phase;
- one append-only `WORK_LOG.md`;
- architecture overview/dependency rules and ADRs;
- the required acceptance evidence for each Phase.

Do not create additional status files, blocker files, recovery files, duplicate indexes, meeting notes, implementation summaries, or per-checkpoint Markdown files.

`docs/execution/DECISIONS.md` is frozen legacy history. New irreversible architecture decisions go to an ADR. New execution choices and troubleshooting facts go to `WORK_LOG.md`.

Research documentation is allowed only when a public paper/specification or a non-obvious algorithm contract must be preserved. Starting with Phase 4, consolidate each Phase into at most one research Markdown file.

### Update rules

For every remotely pushed checkpoint:

1. Update the current Phase task row in `PHASE_XX_TASKS.md`.
2. Append one compact `WORK_LOG.md` entry containing Completed, Validation, and Next.
3. Update `WORK_STATUS.md` only when Current Task, Last Completed Task, Next Action, CI, acceptance, or blockers change.
4. Put Run IDs, Artifact digests, Commit SHAs, failure diagnosis, and measured values in `WORK_LOG.md` once; link to them elsewhere instead of copying them.
5. Keep accepted Phase task ledgers fully `Completed` and immutable except for factual corrections.

A new Phase must create its task ledger before PXX-01 implementation begins. A Phase cannot enter acceptance while its ledger, `WORK_STATUS.md`, and `WORK_LOG.md` disagree.

The `pnpm check:docs` gate enforces the canonical execution-document set, Phase ledger continuity, status synchronization, index links, research consolidation, and blocker-file removal.

## Phase evidence

Each Phase must maintain the Demo, automated results, visual baselines, performance/lifecycle records, Technical QA, Owner Acceptance, public Pages verification, and immutable tag required by `PHASE_ACCEPTANCE_PLAN.md`.

Code completion alone is never Phase acceptance.
