# Contributing to Kyxos Render Engine

## Prerequisites

- Node.js 24.14.0, as pinned in `.nvmrc`.
- Corepack enabled.
- pnpm 11.7.0, as pinned by the root `packageManager` field.

Install only from the committed lockfile:

```bash
corepack enable
pnpm install --frozen-lockfile
```

## Branches and commits

Phase work uses `agent/phase-XX-description` branches. Keep commits independently testable and describe one coherent change, for example:

```text
feat(webgpu): add device lifecycle
test(scheduler): cover sleep and wake
docs(phase-00): add acceptance evidence
```

Do not develop a Phase as one large commit, rewrite accepted history, or bypass a failing check.

## Required checks

Before pushing a checkpoint, run the complete gate:

```bash
pnpm verify
```

Targeted commands are available while iterating:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm check:boundaries
pnpm check:architecture
pnpm validate:shaders
pnpm build
pnpm check:bundle
pnpm test:e2e
```

Do not delete tests, weaken assertions or visual thresholds without evidence, or mark an unavailable capability as PASS.

## Architecture review

Every change must preserve [`docs/architecture/dependency-rules.md`](./docs/architecture/dependency-rules.md). In particular:

- Product code consumes only the public SDK or a dedicated integration adapter.
- Lower layers never import higher layers.
- Packages expose and consume root entry points only.
- Native GPU objects remain inside graphics backends.
- GPU resources have one owner and an explicit loss/disposal path.
- Features declare dirty flags and temporal reset behavior.
- No unconditional permanent frame loop is introduced.
- Optional features declare capability and WebGL2 degrade/disable behavior.

If a change alters an accepted public or architectural decision, update or supersede the relevant ADR in the same pull request.

## Phase evidence

Each Phase must maintain its acceptance document, deterministic demo, automated results, visual baselines, and performance record in the paths required by `PHASE_ACCEPTANCE_PLAN.md`. A Phase is not complete merely because its code builds.

Update `WORK_STATUS.md` and append `docs/execution/WORK_LOG.md` at every remotely pushed checkpoint so interrupted work has one unambiguous recovery action.
