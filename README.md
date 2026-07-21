# Kyxos Render Engine

独立、模块化、可复用的 Web 实时渲染引擎。首先服务 Kyxos Texture Lab，但不依赖 Texture Lab 的 UI、状态管理、账户、数据库或业务流程。

## 强制项目文档

1. [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md)  
   定义产品目标、系统架构、模块边界、技术路线和 Phase 0–14 开发内容。

2. [`PHASE_ACCEPTANCE_PLAN.md`](./PHASE_ACCEPTANCE_PLAN.md)  
   定义每个阶段的可见成果、自动测试、视觉回归、性能报告、人工操作、失败条件和最终验收门禁。

两份文档具有同等约束力：

```text
Development Plan defines what to build.
Acceptance Plan defines how completion is proven.
```

任何阶段只有达到 `PHASE_ACCEPTANCE_PLAN.md` 中的 `Phase Accepted` 状态后，才允许默认进入下一阶段。

“代码已提交”“Demo 可以运行”或“开发者自测通过”均不等于阶段验收完成。

## 架构边界

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

Texture Lab 只允许通过公共 SDK 和专用 Integration Adapter 调用引擎。

详细规则见：

- [`docs/architecture/overview.md`](./docs/architecture/overview.md)
- [`docs/architecture/dependency-rules.md`](./docs/architecture/dependency-rules.md)
- [`docs/adr/`](./docs/adr/)

## 当前开发状态

[`WORK_STATUS.md`](./WORK_STATUS.md) 是当前 Phase、分支、检查点、CI、验收状态和唯一下一步操作的入口。执行历史与技术决策保存在 [`docs/execution/`](./docs/execution/)；GitHub 分支和提交是恢复工作的可信状态来源。

## 本地开发

要求 Node.js 24.14.0 和由仓库 `packageManager` 字段固定的 pnpm 11.7.0：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

启动独立 Playground：

```bash
pnpm --dir apps/playground dev
```

Phase 0 验收页面位于 `/acceptance/phase-00`。它只通过公共 SDK 和开发用 Mock Backend 运行，不依赖 Texture Lab 或 UI 框架。

贡献、门禁和分支要求见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。
