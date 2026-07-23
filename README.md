# Kyxos Render Engine

独立、模块化、可复用的 Web 实时渲染引擎。首先服务 Kyxos Texture Lab，但不依赖 Texture Lab 的 UI、状态管理、账户、数据库或业务流程。

## Single documentation index

本 README 是仓库唯一文档索引。不要创建 `docs/README.md`、目录级索引或重复状态文档。

| Authority | Document | Purpose |
| --------- | -------- | ------- |
| Product scope | [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md) | Phase 0–14 要开发什么、架构和模块边界 |
| Acceptance | [`PHASE_ACCEPTANCE_PLAN.md`](./PHASE_ACCEPTANCE_PLAN.md) | 如何证明一个 Phase 完成，以及公开 Pages/冻结 Tag 门禁 |
| Current state | [`WORK_STATUS.md`](./WORK_STATUS.md) | 当前 Phase、当前任务、最后完成任务、唯一 Next Action 和阻断 |
| Contribution rules | [`CONTRIBUTING.md`](./CONTRIBUTING.md) | 分支、验证、架构和文档治理规则 |
| Execution history | [`docs/execution/WORK_LOG.md`](./docs/execution/WORK_LOG.md) | 追加式检查点事实、CI Run、Artifact 和恢复线索 |
| Architecture | [`docs/architecture/overview.md`](./docs/architecture/overview.md) / [`docs/architecture/dependency-rules.md`](./docs/architecture/dependency-rules.md) / [`docs/adr/`](./docs/adr/) | 当前架构和不可逆决策 |

### Phase task ledgers

每个已启动 Phase 只有一份任务账本，记录任务、依赖、验证和状态；详细过程不在任务账本重复。

- [`PHASE_00_TASKS.md`](./docs/execution/PHASE_00_TASKS.md)
- [`PHASE_01_TASKS.md`](./docs/execution/PHASE_01_TASKS.md)
- [`PHASE_02_TASKS.md`](./docs/execution/PHASE_02_TASKS.md)
- [`PHASE_03_TASKS.md`](./docs/execution/PHASE_03_TASKS.md)
- [`PHASE_04_TASKS.md`](./docs/execution/PHASE_04_TASKS.md)

## Source-of-truth order

```text
Git branch / PR / immutable accepted tag
→ WORK_STATUS.md
→ PHASE_XX_TASKS.md
→ WORK_LOG.md
→ acceptance evidence and CI artifacts
```

- `DEVELOPMENT_PLAN.md` defines what to build.
- `PHASE_ACCEPTANCE_PLAN.md` defines how completion is proven.
- `WORK_STATUS.md` contains current state only and must not duplicate a stale Commit SHA.
- `PHASE_XX_TASKS.md` is the only task-status ledger for that Phase.
- `WORK_LOG.md` stores checkpoint detail once; PR descriptions are summaries, not state authorities.
- `docs/execution/DECISIONS.md` is legacy history. New architecture decisions use ADRs; new execution facts use `WORK_LOG.md`.

A Phase is not complete because code builds or a Demo opens. It is complete only after the mandatory acceptance plan, public deployment, online interaction verification, and immutable accepted tag pass.

## Architecture boundary

```text
Product Application
        ↓
Integration Adapter
        ↓
Public Engine SDK
        ↓
Feature Modules / Render Pipeline
        ↓
Renderer Core
        ↓
Graphics Backend
        ↓
WebGPU / WebGL2
```

Texture Lab may call the engine only through the public SDK and a dedicated Integration Adapter.

## Local development

Requires Node.js 24.14.0 and pnpm 11.7.0 pinned by the repository:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

Start the independent Playground:

```bash
pnpm --dir apps/playground dev
```
