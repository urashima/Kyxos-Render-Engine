# Kyxos Render Engine 阶段验收与成果确认计划

> Repository: `urashima/Kyxos-Render-Engine`  
> Document: `PHASE_ACCEPTANCE_PLAN.md`  
> Status: Mandatory Acceptance Standard  
> Related: `DEVELOPMENT_PLAN.md`

---

## 1. 文档定位

本文件是 `DEVELOPMENT_PLAN.md` 的强制配套验收规范。

`DEVELOPMENT_PLAN.md` 负责定义：

- 要开发什么。
- 系统如何拆分。
- 模块之间如何保持解耦。
- Phase 0–14 的功能与技术路线。

本文件负责定义：

- 每个阶段完成后必须展示什么。
- 项目负责人如何亲自确认成果。
- 哪些自动测试必须通过。
- 视觉、性能、架构和稳定性如何判定。
- 什么情况下必须退回，不能进入下一阶段。

任何阶段只有同时满足本文件要求，才允许标记为 `Phase Accepted`。

“代码已经提交”“页面看起来能跑”“开发者说已经完成”均不等于验收完成。

---

## 2. 阶段状态定义

每个 Phase 必须使用以下状态，禁止使用“基本完成”“差不多完成”等模糊表述：

```text
Planned
→ In Development
→ Development Complete
→ Automated Verification Passed
→ Technical QA Passed
→ Owner Acceptance Passed
→ Phase Accepted
```

含义：

- `Planned`：只有计划，尚未开发。
- `In Development`：正在开发，不可对外宣称完成。
- `Development Complete`：开发者完成代码，但尚未完成验证。
- `Automated Verification Passed`：CI、测试、视觉回归和依赖检查通过。
- `Technical QA Passed`：性能、资源生命周期、降级和错误路径通过。
- `Owner Acceptance Passed`：项目负责人已按人工清单操作确认。
- `Phase Accepted`：全部门禁通过，并创建冻结 Tag。

只有 `Phase Accepted` 后，默认才允许启动下一 Phase。

---

## 3. 每阶段必须提交的验收包

每个 Phase 的 PR 必须同时提交：

```text
docs/acceptance/phase-XX/PHASE_XX_ACCEPTANCE.md
apps/playground/src/acceptance/phase-XX/
test-results/phase-XX/automated-summary.json
benchmarks/phase-XX/performance.json
visual-baselines/phase-XX/
```

其中：

### 3.1 `PHASE_XX_ACCEPTANCE.md`

必须记录：

- Phase 名称与目标。
- PR、Commit SHA 和测试日期。
- 开发内容。
- 明确未完成内容。
- 在线验收页面地址。
- 自动测试结果。
- 性能数据。
- 视觉回归结果。
- 人工验收步骤。
- 已知限制。
- PASS / FAIL 结论。

### 3.2 独立验收 Demo

每个阶段必须提供固定入口：

```text
/acceptance/phase-00
/acceptance/phase-01
/acceptance/phase-02
...
```

验收 Demo 必须独立于 Kyxos Texture Lab 运行。

页面至少显示：

- Phase 编号。
- Commit SHA。
- 当前 Backend：WebGPU / WebGL2。
- 浏览器、Canvas 尺寸和 DPR。
- 当前质量档。
- FPS、CPU Frame Time、GPU Frame Time。
- Draw Calls、Triangles、Pipeline Count。
- Texture / Buffer Memory Estimate。
- Render Mode。
- Temporal Sample Count。
- 当前启用的 Render Pass。
- Reset Scene。
- Reset Temporal History。
- Dispose / Recreate Renderer。

### 3.3 自动化报告

GitHub Actions 至少必须包含：

```text
Install
Format Check
Lint
Type Check
Unit Tests
Integration Tests
WebGPU Smoke Test
WebGL2 Smoke Test
Shader Validation
Build
Bundle Size Check
Dependency Boundary Check
Visual Regression
```

任何一项红色，本阶段不得进入 `Owner Acceptance`。

### 3.4 视觉回归包

每个核心视觉测试必须包含：

```text
Reference
Current
Difference
```

必须固定：

- 浏览器版本。
- Canvas 尺寸。
- DPR。
- 相机位置和 FOV。
- 环境光和 HDRI。
- 材质参数。
- 随机 Seed。
- Temporal Sample Count。
- Backend。

### 3.5 性能报告

至少记录：

- CPU Frame Time。
- GPU Frame Time。
- FPS。
- Draw Calls。
- Triangles / Vertices。
- Pipeline / Material Count。
- GPU Texture Estimate。
- GPU Buffer Estimate。
- Bundle Size。
- Asset Load Time。
- Static-to-Sleep Time。
- Renderer Dispose 后资源差值。
- 与上一阶段的性能差异。

### 3.6 人工验收清单

项目负责人至少确认：

```text
[ ] 页面可正常打开
[ ] 本阶段功能可直接看到
[ ] 参数和开关立即生效
[ ] 刷新后仍可运行
[ ] Resize 和 DPR 正确
[ ] 控制台没有持续错误
[ ] 视觉结果没有明显异常
[ ] 性能达到本阶段预算
[ ] 错误和降级路径可理解
[ ] Playground 可独立运行
```

---

## 4. 通用阶段门禁

一个阶段只有同时满足以下条件才算通过：

```text
CI 全绿
+ 独立 Demo 可用
+ 人工验收通过
+ 视觉回归通过
+ 性能未越过预算
+ 没有架构越界
+ GPU 资源可正确释放
+ Temporal History 可正确重置
+ 错误与降级路径完整
+ 文档完成
+ Git Tag 已冻结
```

### 4.1 直接失败条件

出现以下任意情况，阶段直接判定失败：

- Core 或 Backend 依赖 React、Texture Lab 或业务 Store。
- 出现循环依赖或跨包访问私有实现。
- 通过删除、跳过或关闭测试使 CI 变绿。
- 新增无条件永久 `requestAnimationFrame`。
- GPU 资源没有所有权和 Dispose 路径。
- 新功能没有触发正确 Dirty Flag。
- 材质、贴图、相机变化后 Temporal History 未重置。
- 只在开发者电脑运行，固定验收环境无法运行。
- 没有 WebGL2 降级声明或 Capability 结果。
- 视觉结果只能口头描述，没有固定场景。
- 性能数据缺失。
- Demo 依赖 Texture Lab 才能运行。
- 未说明已知限制却宣称完整完成。

---

## 5. Phase 0：仓库与架构基线

### 必须看到

- pnpm Monorepo。
- 基础 packages 和 Playground。
- TypeScript strict。
- ESLint、Prettier、Vitest、Playwright。
- GitHub Actions。
- 包边界和循环依赖检查。
- Mock Backend。
- ADR 基线。
- 空 SDK 可被独立网页调用。

### 项目负责人操作

1. 打开 Playground。
2. 确认页面不依赖 Texture Lab。
3. 查看 CI 所有检查。
4. 查看依赖图。
5. 删除或临时排除 `integration-texture-lab`，验证引擎仍能构建。
6. 在空白示例中仅导入 `@kyxos/render-sdk`。

### 自动通过条件

- 所有 package 可独立构建。
- 无循环依赖。
- 无越层依赖。
- CI 全绿。
- SDK 空壳示例启动成功。

### 失败条件

- Core 引用 React。
- Renderer 引用 Texture Lab。
- 只有根仓库能构建，单包不能构建。
- Playground 必须依赖业务产品才能启动。

---

## 6. Phase 1：WebGPU Core 与基础几何

### 必须看到

- WebGPU 初始化。
- 清屏、三角形和基础球体。
- Canvas Resize 和 DPR。
- Renderer Create / Dispose。
- Device Lost 处理。
- GPU Resource Debug Count。

### 项目负责人操作

1. 调整窗口尺寸和 DPR。
2. 连续创建、销毁 Renderer。
3. 隐藏并恢复 Canvas。
4. 切换多个 Canvas。
5. 运行 Device Lost 模拟。
6. 查看 Dispose 前后资源数量。

### 通过条件

- 无变形、黑屏或持续报错。
- Resize 和 DPR 正确。
- Dispose 后 RAF 停止。
- GPU Resource Count 回归基线。
- Device Lost 有明确恢复或错误结果。

---

## 7. Phase 2：Scene、Camera、Geometry 与基础渲染

### 必须看到

- Plane、Cube、Sphere、Custom Mesh。
- Scene Graph 层级。
- Transform Dirty Propagation。
- Orbit Camera。
- 自动 Framing。
- Frustum Culling。
- Opaque / Transparent Render Queue。

### 项目负责人操作

1. 切换所有基础几何。
2. 拖动、缩放和旋转相机。
3. 修改父节点 Transform。
4. 将物体移出视锥。
5. 切换透明对象顺序。
6. 查看 Draw Calls 和可见对象计数。

### 通过条件

- 几何和法线方向正确。
- 自动 Framing 正确。
- 父子 Transform 更新正确。
- 屏幕外对象不进入 Draw List。
- 透明排序可预测。

---

## 8. Phase 3：基础 PBR 与 IBL

### 必须看到

固定材质基准画廊：

- Metallic 0–1 梯度。
- Roughness 0–1 梯度。
- 白色 Dielectric。
- 金、铜、铁。
- Normal Map 方向测试。
- AO 测试。
- Emission 测试。
- HDRI 旋转。
- Linear / sRGB 测试。
- Tone Mapping 测试。

### 项目负责人操作

1. 调整 Metallic 和 Roughness。
2. 旋转 HDRI。
3. 切换 Normal Y 方向基准图。
4. 单独开关 AO。
5. 调整 Exposure。
6. 与固定 glTF PBR 参考截图对比。

### 通过条件

- 金属漫反射符合标准工作流。
- Roughness 方向正确。
- Normal Map 方向正确。
- AO 主要影响间接光。
- HDRI 旋转会正确改变反射。
- sRGB / Linear 读取正确。
- 材质球达到产品可用画质。

### 失败条件

- 金属仍有错误漫反射。
- Roughness 反向。
- 法线 Y 方向错误。
- AO 将全部直接光粗暴压黑。
- HDRI 旋转后高光方向不变。

---

## 9. Phase 4：Frame Scheduler、TAA 与静止累积

### 必须看到

调试 HUD 必须实时显示：

```text
Render Mode
Sample Index / Target Samples
RAF Active
Frame Count
GPU Frame Time
History Valid
Dirty Flags
```

状态必须可观察：

```text
Interactive
→ Stabilizing
→ Accumulating 1 / N
→ Accumulating N / N
→ Sleeping
```

### 项目负责人操作

1. 拖动相机，确认 Sample 立即归零。
2. 停止拖动，确认开始逐帧累积。
3. 等待达到目标样本。
4. 静止数秒，确认 Frame Count 不再增长。
5. 修改 Roughness，确认下一帧立即唤醒。
6. 替换纹理，确认 History 自动重置。
7. 播放动画，确认不会进入静态无限累积。
8. 暂停动画，确认重新开始静态累积。

### 通过条件

- 拖动时无明显鬼影。
- 停止后边缘、高光、AO 和阴影逐步稳定。
- 达到目标样本后停止完整渲染。
- GPU 使用率明显下降。
- 所有声明的 Dirty Event 可唤醒。
- 唤醒和重置时没有上一场景残影。

### 失败条件

- 静止后仍永久提交完整帧。
- 材质修改不唤醒。
- Camera / Texture 变化不重置 History。
- 动画产生严重拖影。
- 收敛后 Sample Count 仍无限增长。

---

## 10. Phase 5：阴影、AO 与标准后处理

### 必须看到

独立开关：

- Directional / Spot Shadow。
- CSM。
- GTAO。
- Bloom。
- DOF。
- Color Grading。
- Sharpen。

### 项目负责人操作

1. 单独开关每个 Pass。
2. 切换 Low / Medium / High / Ultra。
3. 调整阴影 Bias 和分辨率。
4. 调整 AO 半径与强度。
5. 调整 Bloom 和 DOF。
6. 查看 Render Graph 和中间 Buffer。

### 通过条件

- 每个 Pass 可独立启停。
- 关闭后不再执行对应 Pass。
- 质量分档真实改变采样或分辨率。
- AO、阴影与 TAA 不产生明显冲突。
- Render Graph 资源生命周期正确。

---

## 11. Phase 6：glTF、纹理压缩与渐进资源

### 固定测试资产

- 静态 GLB。
- 多材质 GLB。
- 多 Primitive glTF。
- KTX2 / Basis 贴图。
- Draco 模型。
- Meshopt 模型。
- 4K PBR 贴图组。
- 损坏和非法模型。

### 必须看到

资源状态：

```text
Requested
→ Fetching
→ Decoding
→ CPU Ready
→ Uploading
→ GPU Ready
→ Resident
```

### 项目负责人操作

1. 加载不同格式模型。
2. 观察低清到高清替换。
3. 加载中取消资源。
4. 重复加载相同资源。
5. 加载损坏模型。
6. 查看 Worker、主线程和缓存状态。

### 通过条件

- 标准模型正确加载。
- 渐进替换无崩溃和错误残影。
- 替换后 Temporal 自动重置。
- 重复资源可共享缓存。
- 取消后不继续占用资源。
- 损坏资产不会拖垮整个引擎。
- 解码不长时间阻塞主线程。

---

## 12. Phase 7：骨骼动画与 Morph

### 固定测试模型

- 人形骨骼。
- 四足动物。
- 机械骨骼。
- 100 Bone 模型。
- 500 Bone 压力模型。
- Morph Face。
- Skinning + Morph 联合模型。

### 项目负责人操作

1. Play / Pause / Resume。
2. Seek。
3. 调整播放速度。
4. 切换 Loop / Once / Ping-pong。
5. 执行 Crossfade。
6. 同时启用 Skinning 和 Morph。
7. 暂停后观察静态累积。

### 通过条件

- Position、Normal 和 Tangent 蒙皮正确。
- 阴影跟随动画。
- Crossfade 无明显跳变。
- 动态 TAA 无明显骨骼残影。
- 暂停后静态累积正常。
- WebGL2 大骨架有明确降级方案。

---

## 13. Phase 8：高级材质

### 必须看到

独立材质画廊：

- Clearcoat。
- Sheen。
- Anisotropy。
- Transmission。
- Volume / Absorption。
- IOR / Specular。

### 项目负责人操作

1. 独立启用和禁用每个扩展。
2. 查看 Pipeline / Variant Count。
3. 切换 WebGPU / WebGL2。
4. 调整 Rough Transmission 和 Volume Distance。
5. 查看关闭功能后 Render Graph。

### 通过条件

- 各扩展互不强依赖。
- 禁用后不产生多余 Pass。
- Shader Variant 数量可控。
- WebGL2 有明确 Capability 和降级。
- 未导入扩展时可 Tree Shake。

---

## 14. Phase 9：SSS

### 固定基准场景

- 皮肤头部和耳朵背光。
- 蜡。
- 玉石。
- 叶片。
- 厚度梯度物体。

### 项目负责人操作

1. 切换 Low / Medium / High SSS。
2. 调整 Thickness。
3. 调整 Scatter Radius / Profile。
4. 单独查看 Diffuse 和 Specular。
5. 检查轮廓、接缝和深度边缘。

### 通过条件

- 不同材质呈现不同散射特征。
- 耳朵和薄片背光自然。
- 高光不被 SSS Blur 错误模糊。
- 轮廓不出现明显漏光。
- 低端设备可以自动降级。

---

## 15. Phase 10：WebGL2 兼容后端

### 项目负责人操作

1. 强制使用 WebGL2。
2. 在不支持 WebGPU 的环境启动。
3. 使用与 WebGPU 相同的 SDK 调用。
4. 加载 PBR、动画和标准后处理场景。
5. 查看 Capability Report。

### 通过条件

- 不支持 WebGPU 时自动启动 WebGL2。
- 业务层 API 无需改写。
- 不支持功能明确提示或降级。
- 画质与性能降级可预测。
- WebGL2 Context Lost 可处理。

---

## 16. Phase 11：Texture Lab 正式接入

### 架构硬验收

Texture Lab 只允许依赖：

```text
@kyxos/render-integration-texture-lab
```

Texture Lab 代码中禁止出现：

```text
GPUDevice
RenderGraph
ShaderCache
@kyxos/*/internal
```

### 项目负责人操作

1. 打开 Texture Lab 预览。
2. 切换 Preview Preset。
3. 实时修改 Base Color、Normal、Roughness 等贴图。
4. 快速拖动连续参数。
5. Resize 和切换 Light / Dark Theme。
6. 导出截图。
7. 独立打开 Render Engine Playground。
8. 验证删除 Texture Lab 后引擎仍能构建。

### 通过条件

- Texture Lab 只使用 Bridge。
- 高频参数更新被事务合并。
- 主题和 Resize 不破坏 Canvas。
- 引擎不读取账户、订阅、路由或业务 Store。
- Playground 可独立展示全部能力。
- 新建第三方示例可直接使用 SDK。

---

## 17. Phase 12：SSDO、SSR 与室内映射

### 必须使用注册机制

```ts
engine.registerRenderFeature(ssdoFeature);
engine.registerRenderFeature(ssrFeature);
engine.registerMaterialExtension(interiorMappingExtension);
```

### 允许主要修改的区域

```text
packages/features/ssdo
packages/features/ssr
packages/material-interior-mapping
packages/presets/interior
```

### 项目负责人操作

1. 分别注册和卸载 SSDO、SSR、Interior Mapping。
2. 查看 Render Graph Pass。
3. 查看未导入插件时 Bundle。
4. 切换 WebGL2，查看降级结果。
5. 打开 Interior Preset，调整房间 Atlas、深度、楼层和随机种子。
6. 查看本 Phase Git Diff。

### 通过条件

- 新功能通过注册接入。
- Core、Scene 和 SDK 没有破坏性改造。
- 禁用后不执行对应 Pass。
- 插件异常不拖垮整个 Renderer。
- 未导入时可 Tree Shake。
- 新增室内映射不需要复制 Renderer。

### 失败条件

- 为增加 SSDO 修改 Scene Graph 数据定义。
- 为增加室内映射修改 Texture Lab 业务 Store。
- 为增加 SSR 将固定流程写入巨型 `render()`。

---

## 18. Phase 13：高级性能与生产加固

### 压力场景

- 1M / 5M Triangles。
- 100 个同材质实例。
- 100 个不同材质对象。
- 100 / 500 Bones。
- 8 / 32 Morph Targets。
- 4K PBR 贴图组。
- 多 Canvas / 多 Viewport。
- 透明与 Transmission 压力场景。

### 稳定性测试

必须覆盖：

- 长时间相机操作。
- 持续材质修改。
- 模型反复加载和卸载。
- Canvas 反复创建和销毁。
- 页面隐藏和恢复。
- Device Lost / Context Lost。
- 多视口资源共享。

### 记录指标

- JS Heap。
- GPU Texture Estimate。
- GPU Buffer Estimate。
- Resource Handle Count。
- Pipeline Count。
- RAF Count。
- CPU / GPU Frame Time。
- Dynamic Resolution Scale。

### 通过条件

- 大场景和多视口达到定义的预算。
- Device Lost 可恢复。
- 回到空场景后资源数量基本回归基线。
- 长时间运行没有持续线性内存增长。
- Dynamic Resolution 有滞回，不频繁抖动。
- 非可见 Canvas 可自动暂停。

---

## 19. Phase 14：1.0 发布

### 必须完成

- 公共 SDK API 稳定。
- npm 安装测试。
- WebGPU / WebGL2 支持矩阵。
- Texture Lab 正式接入。
- 全部核心 Sketchfab 类能力。
- 文档站和 API Reference。
- 所有 Demo 和固定基准资产。
- 性能报告。
- 视觉回归报告。
- Changelog 和 Migration Guide。
- 无 P0 / P1 阻断缺陷。

### 最终独立性验收

1. `apps/playground` 不依赖 Texture Lab。
2. 删除 Texture Lab 后，引擎所有测试和构建仍通过。
3. 新建空白项目，只安装 `@kyxos/render-sdk` 即可显示材质球和模型。
4. WebGPU 与 WebGL2 使用相同公共 SDK。
5. SSDO、SSR、SSS 和室内映射可作为扩展启停。
6. 静止场景可累积并进入 Sleep。
7. 动态动画可保持实时 TAA。
8. 所有 GPU 资源可 Dispose。
9. 第三方产品无需了解 Render Graph 和 GPUDevice。

### 发布条件

只有以上全部通过，才能创建：

```text
v1.0.0
```

---

## 20. 验收页面统一格式

每个阶段页面顶部必须显示：

```text
Kyxos Render Engine — Phase Acceptance

Phase: 04
Status: Technical QA Passed
Commit: abc123
Backend: WebGPU
Browser: Chrome xxx
Resolution: 1920 × 1080
DPR: 1
CI: PASS
Visual Regression: PASS
Performance: PASS
Memory: PASS
Architecture Boundary: PASS
```

页面内容顺序：

1. Phase 目标。
2. 功能 Demo。
3. Debug HUD。
4. 自动测试结果。
5. Reference / Current / Difference。
6. 性能数据。
7. 人工操作步骤。
8. 已知限制。
9. PASS / FAIL 结论。

---

## 21. PR 验收要求

每个 Phase PR 描述必须包含：

```text
## Phase

## Delivered

## Not Delivered

## Acceptance Demo

## Automated Validation

## Visual Regression

## Performance

## Architecture Boundary

## Known Limitations

## Owner Checklist

## Final Status
```

禁止：

- 未提供 Demo 就要求合并。
- 将未完成内容描述为“优化项”。
- 删除失败基准图以通过视觉回归。
- 用开发机单次 FPS 代替固定 Benchmark。
- 未说明降级能力却宣称双后端完整支持。

---

## 22. 阶段冻结与回退

Owner Acceptance 通过后创建 Git Tag：

```text
phase-00-accepted
phase-01-accepted
phase-02-accepted
...
phase-14-accepted
```

Tag 对应 Commit 必须满足：

- CI 全绿。
- 验收文档完整。
- Benchmark 已归档。
- Visual Baseline 已归档。
- Known Limitations 已记录。

后续发现回归时：

1. 与最近 Accepted Tag 对比。
2. 定位视觉、性能或架构差异。
3. 不允许静默更新旧的验收结果。
4. 需要新增修复 PR 和回归说明。

---

## 23. Owner 最终确认原则

项目负责人不需要阅读全部实现代码才能完成验收，但必须能通过统一页面确认：

- 功能是否存在。
- 画面是否正确。
- 交互是否顺畅。
- 静止是否逐步收敛并停止渲染。
- 性能是否符合预算。
- 资源是否正确释放。
- 错误是否可以恢复或降级。
- 功能是否保持模块解耦。
- Texture Lab 是否只通过公共 Bridge 使用引擎。

最终采用以下判定：

```text
功能可见
+ 自动测试可重复
+ 视觉结果可比较
+ 性能数据可量化
+ 架构边界可检查
+ 人工步骤可复现
= Phase Accepted
```

---

## 24. Continuous Deployment Gate（持续部署门禁）

This section applies to every development phase (Phase 0–14).

A phase MUST NOT be marked as Accepted unless all requirements in this section are satisfied.

---

### Mandatory Online Playground

Every completed phase must produce a publicly accessible online Playground through GitHub Pages.

The Playground is considered the official acceptance environment for all rendering, interaction, and visual validation.

### Required Workflow

After each Phase is completed:

1. Build the Playground automatically using GitHub Actions.
2. Deploy the latest build to GitHub Pages automatically.
3. Publish a stable online URL.
4. Ensure the Playground can run independently without any local development environment.
5. Showcase all newly implemented features of the current Phase.
6. All interactions required by the Phase Acceptance Checklist must be executable online.
7. Performance statistics (FPS, Frame Time, Draw Calls, GPU Timing when available) must be visible whenever applicable.
8. The Playground must pass every visual, interaction, and performance acceptance item defined for the current Phase.

---

### Required Demo URLs

The deployment must always maintain the following structure:

```text
/latest/      -> Latest stable Playground
/phase-0/
/phase-1/
/phase-2/
...
/phase-14/
```

Requirements:

- `latest` always points to the newest accepted version.
- Every Phase keeps a historical Playground snapshot.
- Historical Playgrounds must remain accessible for regression testing and visual comparison.

---

### GitHub Actions Requirements

Every accepted Phase must successfully complete:

- Build
- Type Check
- Lint
- Tests (when applicable)
- Playground Build
- GitHub Pages Deployment

Any failed workflow automatically blocks Phase acceptance.

---

### Phase Acceptance Gate

A Phase is considered Accepted only if all of the following are true:

- All development tasks are completed.
- All Phase Acceptance Checklist items pass.
- GitHub Actions completes successfully.
- GitHub Pages deployment succeeds.
- Online Playground is publicly accessible.
- Newly implemented functionality is fully demonstrable online.
- No blocking rendering or interaction defects remain.

---

### Not Accepted

The following DO NOT qualify as a completed Phase:

- Code committed but not deployed.
- Pull Request created without an online Playground.
- Local-only demonstration.
- Screenshots or recorded videos instead of an interactive demo.
- Manual verification without a deployable Playground.
- GitHub Pages deployment failure.

---

### Objective

Every development milestone must be immediately reviewable from any device through a web browser.

This guarantees continuous integration, continuous delivery, transparent progress tracking, rapid regression testing, and a permanent online showcase of the Kyxos Render Engine development process.
