# Kyxos Render Engine 完整开发计划

> Repository: `urashima/Kyxos-Render-Engine`  
> Document: `DEVELOPMENT_PLAN.md`  
> Status: Architecture Baseline / Master Plan  
> Target: 建立一套独立、可复用、可扩展的 Web 实时渲染引擎，首先服务 Kyxos Texture Lab，后续可复用于 Kyxos Shader Recipes、Kyxos Mobile Visual Lab、在线模型查看器、材质商店预览、虚拟室内预览、Unity 资产预览及其他 SaaS 产品。

---

## 1. 项目定义

Kyxos Render Engine 是独立于任何具体业务产品的实时渲染子系统。

它不属于 Kyxos Texture Lab 的页面组件，也不依赖 Texture Lab 的 React 状态、路由、账户、支付、数据库、工具流程或业务数据结构。Texture Lab 只能通过稳定的公共 SDK 调用渲染引擎。

引擎第一阶段以复刻 Sketchfab 已公开和可观察的实时渲染能力为功能目标，包括：

- Web 端高质量 PBR 渲染
- HDRI、IBL 与直接光照
- 静态网格、骨骼动画、Morph Target
- 高级材质：Clearcoat、Sheen、Anisotropy、Transmission、Volume、SSS
- 阴影、AO、Bloom、DOF、Tone Mapping、TAA
- 用户交互时优先帧率，静止后渐进累积采样
- 达到目标采样数后停止持续渲染
- 按需唤醒、低功耗与多视口管理
- 渐进资源加载与质量分档
- 截图、材质球、平面、模型与室内预览

本项目只复刻功能、行为和可验证的画面结果，不复制 Sketchfab 私有源码、私有资源、商标、服务接口或非公开实现。

---

## 2. 产品目标

### 2.1 首要目标

1. 为 Kyxos Texture Lab 提供流畅、美观、准确的材质与模型实时预览。
2. 作为独立 npm SDK 被任意 Web 产品调用。
3. 允许在未来替换 UI、业务框架或后端，而无需修改渲染核心。
4. 支持 WebGPU 优先、WebGL2 兼容的双后端架构。
5. 为 GPU 贴图烘焙、节点计算、材质生成和虚拟室内预览提供统一底层。

### 2.2 长期目标

- 成为 Kyxos 系列产品共享的渲染基础设施。
- 支持外部插件或内部扩展包接入新的 Pass、材质模型、资源格式和预览模式。
- 支持 SSDO、SSR、SSGI、室内映射、体积雾、路径追踪预览等功能，而不修改核心 API。
- 支持未来桌面壳、Electron、Tauri、Web Worker、OffscreenCanvas 与服务端无头截图。
- 在工程结构、性能、画面和扩展性上达到产品级，而不是 Demo 级。

### 2.3 非目标

第一阶段不开发：

- 完整游戏引擎编辑器
- 物理、导航、网络同步和游戏玩法框架
- DCC 建模、蒙皮、绑定工具
- 复制 Sketchfab 网站界面
- 与 Texture Lab UI 强绑定的状态管理
- 第一阶段直接实现电影级离线路径追踪

---

## 3. 强制架构原则

以下原则属于项目硬约束，任何阶段不得破坏。

### 3.1 依赖方向单向

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

禁止底层反向引用上层：

- Backend 不知道 Material、Scene 或 Texture Lab。
- Renderer Core 不知道 React、DOM 面板或业务工具。
- Material 不直接依赖 PostFX。
- PostFX 不直接修改 Scene。
- Asset Loader 不直接创建 UI。
- Texture Lab 不允许导入引擎内部私有路径。

### 3.2 模块只通过接口通信

每个包必须：

- 暴露最小公共接口。
- 内部实现默认隐藏。
- 不跨包访问私有对象。
- 不使用全局可变单例作为主要通信方式。
- 通过句柄、描述对象、事件和 Command API 通信。
- 可被 Mock，便于单元测试。

### 3.3 核心不依赖具体 UI 框架

引擎核心禁止依赖：

- React
- Vue
- Svelte
- Next.js
- Tailwind
- Zustand
- Redux
- 浏览器业务路由

允许在独立适配包中提供：

- `@kyxos/render-react`
- `@kyxos/render-web-component`
- `@kyxos/render-worker`

### 3.4 功能通过注册扩展

高级能力必须通过注册机制接入：

```ts
engine.registerRenderFeature(ssdoFeature);
engine.registerMaterialExtension(subsurfaceExtension);
engine.registerAssetDecoder(ktx2Decoder);
engine.registerPreviewPreset(interiorPreset);
```

禁止为了增加 SSDO 或室内映射而直接修改所有渲染模块。

### 3.5 Clean-room 实现

- 只使用公开论文、标准、官方文档和合法开源实现作为算法参考。
- 不反编译、复制或移植 Sketchfab 私有代码。
- 对参考项目记录许可证、来源和采用方式。
- 所有关键算法写入 `docs/research/`，说明数学来源和实现差异。

---

## 4. 技术路线

### 4.1 语言与工程

- TypeScript：公共 SDK、场景、资源、调度和平台层。
- WGSL：WebGPU Shader 与 Compute Shader。
- GLSL ES 3.0：WebGL2 兼容 Shader。
- Rust/WASM：仅在有明确性能收益时用于解码、网格处理、BVH 或压缩，不作为第一阶段强制依赖。
- pnpm workspace：Monorepo 包管理。
- Vite：示例、开发服务器和演示应用。
- Vitest：单元测试。
- Playwright：浏览器集成、视觉与交互测试。
- ESLint + TypeScript strict + Prettier：代码质量。
- Changesets：版本与发布管理。

### 4.2 图形后端

#### WebGPU 主后端

负责：

- 主实时渲染
- Compute Shader
- Storage Buffer / Storage Texture
- GPU Mipmap
- GPU 烘焙
- 现代 Bind Group 和 Pipeline Cache
- 高级后处理
- 未来路径追踪与 GPU Culling

#### WebGL2 兼容后端

负责：

- 基础 PBR
- 静态模型与骨骼动画
- 标准阴影和后处理
- 不支持 WebGPU 设备的降级预览

WebGL2 不是 WebGPU API 的模拟器。两者实现共同的抽象接口，但允许能力不同。

### 4.3 数学和坐标约定

项目建立统一规范：

- 右手坐标系。
- Y-Up。
- 线性空间内部计算。
- 明确 NDC 与后端差异，转换只存在于 Backend。
- SI 单位优先，默认 1 unit = 1 meter。
- 矩阵布局、乘法顺序和四元数规则写入 ADR。
- 颜色、法线、HDR、深度、速度缓冲均有明确格式约定。

---

## 5. Monorepo 目录规划

```text
Kyxos-Render-Engine/
├─ apps/
│  ├─ playground/                 # 独立开发与功能调试
│  ├─ benchmark/                  # 性能基准
│  ├─ visual-regression/          # 视觉回归场景
│  └─ docs-site/                  # 文档和 API 示例
├─ packages/
│  ├─ core/                       # 生命周期、句柄、错误、事件、基础类型
│  ├─ math/                       # 向量、矩阵、四元数、几何
│  ├─ platform/                   # Canvas、DPR、RAF、输入、Worker 抽象
│  ├─ backend-api/                # 图形后端接口，不含业务逻辑
│  ├─ backend-webgpu/             # WebGPU 实现
│  ├─ backend-webgl2/             # WebGL2 实现
│  ├─ render-graph/               # Pass、资源、依赖和生命周期
│  ├─ renderer/                   # 帧构建、队列、提交、质量设置
│  ├─ frame-scheduler/            # Dirty、交互、累积、休眠与唤醒
│  ├─ temporal/                   # Jitter、TAA、重投影、累积
│  ├─ scene/                      # Scene Graph、Transform、Bounds
│  ├─ camera/                     # 相机和控制器接口
│  ├─ geometry/                   # Mesh、Primitive、Vertex Layout
│  ├─ visibility/                 # Frustum、Occlusion、LOD、BVH
│  ├─ material-core/              # 材质参数、Feature Key、绑定
│  ├─ material-pbr/               # 标准 PBR
│  ├─ material-extensions/        # Clearcoat、SSS、Sheen 等
│  ├─ lighting/                   # 灯光、聚类、阴影调度
│  ├─ environment/                # HDRI、IBL、探针、天空
│  ├─ animation/                  # Clip、Track、Mixer、Crossfade
│  ├─ skinning/                   # GPU Skinning
│  ├─ morph/                      # Morph Target
│  ├─ postfx-core/                # 后处理扩展接口
│  ├─ postfx-standard/            # AO、Bloom、DOF、Tone Mapping 等
│  ├─ asset-core/                 # Asset 生命周期和缓存
│  ├─ asset-gltf/                 # glTF/GLB
│  ├─ asset-texture/              # PNG/JPEG/HDR/EXR/KTX2
│  ├─ asset-worker/               # Worker 解码
│  ├─ picking/                    # Raycast、GPU ID Picking
│  ├─ capture/                    # 截图、离屏渲染、累积导出
│  ├─ debug/                      # GPU 统计、GBuffer、Pass 查看
│  ├─ presets/                    # 材质球、平面、模型、室内预设
│  ├─ sdk/                        # 面向产品的稳定公共入口
│  ├─ integration-texture-lab/    # Texture Lab 专用适配，不能反向进入 core
│  ├─ render-react/               # 可选 React 适配
│  └─ testing/                    # Mock Backend、测试场景和工具
├─ shaders/
│  ├─ shared/
│  ├─ webgpu/
│  └─ webgl2/
├─ docs/
│  ├─ architecture/
│  ├─ adr/
│  ├─ research/
│  ├─ api/
│  ├─ performance/
│  └─ integration/
├─ test-assets/
│  ├─ gltf/
│  ├─ materials/
│  ├─ animation/
│  └─ environments/
└─ tools/
   ├─ shader-build/
   ├─ asset-validation/
   └─ screenshot-diff/
```

---

## 6. 公共 SDK 边界

业务产品只允许依赖：

```ts
import { createKyxosRenderer } from '@kyxos/render-sdk';
```

建议最小调用方式：

```ts
const renderer = await createKyxosRenderer({
  canvas,
  backend: 'auto',
  quality: 'high',
  powerPreference: 'high-performance',
});

const scene = renderer.createScene();
const model = await scene.loadModel(modelUrl);
const material = scene.createPBRMaterial();

material.setTexture('baseColor', baseColorTexture);
material.setTexture('normal', normalTexture);
material.setTexture('roughness', roughnessTexture);

renderer.setScene(scene);
renderer.setPreviewPreset('material-sphere');
renderer.invalidate('material');
```

### 6.1 公共 API 分类

- Engine 生命周期
- Canvas / Viewport
- Scene 与 Entity Handle
- Mesh 与 Model Handle
- Material Handle
- Texture Handle
- Light Handle
- Camera Handle
- Animation Controller
- Render Settings
- Preview Preset
- Capture API
- Event API
- Diagnostic API

### 6.2 公共 API 稳定性

- `@kyxos/render-sdk` 遵循语义化版本。
- 内部包在 1.0 前允许快速迭代。
- Texture Lab 禁止导入 `@kyxos/renderer/internal/*`。
- 所有公共对象优先使用 Handle 和 Command，不直接暴露 GPU 对象。
- 公共 API 变更必须新增 ADR 和迁移说明。

### 6.3 事件

```ts
renderer.on('ready', callback);
renderer.on('frame', callback);
renderer.on('settled', callback);
renderer.on('sleep', callback);
renderer.on('wake', callback);
renderer.on('asset-progress', callback);
renderer.on('device-lost', callback);
renderer.on('error', callback);
```

---

## 7. Render Graph 设计

渲染流程不得写成固定的巨型 `render()`。

Render Graph 负责：

- 声明 Pass 输入输出。
- 自动建立依赖。
- 临时纹理生命周期管理。
- 资源复用和别名。
- Pass 开关与质量分档。
- 调试可视化。
- 后续插件插入。

基础 Pass：

```text
Upload / Prepare
Shadow
Depth Prepass
GBuffer or Forward Opaque
SSS Preparation
AO / SSDO
Lighting
Sky / Environment
Transparent / Transmission
Temporal Resolve
Bloom
DOF
Color Grading
Tone Mapping
Sharpen
Overlay
Present
```

Pass 插入接口：

```ts
renderGraph.registerPass({
  id: 'ssdo',
  stage: 'after-depth',
  reads: ['depth', 'normal', 'albedo'],
  writes: ['indirect-diffuse'],
  execute(context) {},
});
```

Render Graph 不知道 React、Texture Lab 或预览面板。

---

## 8. 帧调度与静止渐进渲染

这是引擎第一优先级能力，不是后期优化。

### 8.1 状态机

```text
Sleeping
   ↓ dirty event
Interactive
   ↓ interaction end
Stabilizing
   ↓ camera inertia stopped
Accumulating
   ↓ sample target or convergence reached
Sleeping
```

```ts
enum RenderMode {
  Interactive,
  Stabilizing,
  Accumulating,
  Sleeping,
}
```

### 8.2 Interactive

目标：低延迟、稳定帧率。

- 相机和参数立即响应。
- 动态分辨率可降低。
- AO、阴影、DOF 使用低成本档。
- 重置静态累积。
- 动态 TAA 使用短历史。

### 8.3 Stabilizing

- 等待 Orbit 惯性结束。
- 等待纹理上传和 Shader 编译完成。
- 等待布局或 Canvas 尺寸稳定。
- 默认静止判定窗口 80–150 ms，可配置。

### 8.4 Accumulating

- 投影矩阵使用低差异 Jitter。
- 对颜色、AO、阴影、DOF 等支持时间域累积。
- 根据设备和质量档使用 4–64 个样本。
- 截图模式允许 16–256 个样本。
- 支持固定样本数和误差阈值收敛。

### 8.5 Sleeping

- 达到收敛条件后停止提交完整帧。
- 尽量停止 `requestAnimationFrame`。
- 保留最终累积结果。
- UI、鼠标、纹理、材质、动画等 Dirty Event 重新唤醒。

### 8.6 Dirty Flags

```ts
enum DirtyFlag {
  Camera,
  Transform,
  Geometry,
  Material,
  Texture,
  Light,
  Environment,
  Animation,
  Viewport,
  PostProcess,
  Selection,
  Accumulation,
}
```

所有功能必须明确自己触发的 Dirty Flag，禁止无条件永久 RAF。

### 8.7 验收标准

- 静止场景收敛后 GPU 使用率明显下降。
- 没有动画和资源加载时停止完整渲染。
- 任意材质参数改变可在下一帧唤醒。
- 相机拖动期间无明显重影。
- 停止拖动后画面逐帧变得更稳定、更清晰。
- 累积重置没有残留上一场景图像。

---

## 9. Scene 与 Entity 系统

### 9.1 Scene Graph

支持：

- 父子层级
- Local / World Transform
- Dirty Propagation
- Visibility
- Layer Mask
- Bounds
- Mesh Renderer
- Camera
- Light
- Skeleton
- Morph
- Annotation Anchor

### 9.2 Entity 方案

第一阶段使用轻量 Entity + Component Handle，不引入完整游戏 ECS。

目标：

- 场景层级清晰。
- 可对节点单独更新。
- 避免巨型继承树。
- 未来可替换为 Data-oriented 存储而不破坏 SDK。

### 9.3 Bounds 与原点

- AABB、Bounding Sphere。
- 自动场景包围盒。
- 自动相机 framing。
- 大坐标场景原点偏移预留。
- 非法 NaN/Infinity 数据保护。

---

## 10. 可见性、排序与提交

### 10.1 P0

- Frustum Culling
- Layer Culling
- Opaque 状态排序
- Transparent 距离排序
- Draw List 缓存
- Material / Pipeline Key

### 10.2 P1

- Screen-size LOD
- Small Feature Culling
- Instancing
- Static Batching
- Meshlet 数据结构预留

### 10.3 P2

- Hi-Z Occlusion Culling
- GPU Indirect Draw
- GPU Culling
- Cluster / Tile Light Culling

可见性系统只输出 Render Items，不直接调用具体 WebGPU API。

---

## 11. 几何与网格系统

支持顶点属性：

- Position
- Normal
- Tangent
- UV0 / UV1
- Vertex Color
- Joint Index
- Joint Weight
- Morph Delta

基础几何：

- Plane
- Cube
- Sphere
- Cylinder
- Rounded Cube
- Material Ball
- Custom Mesh

功能：

- Indexed Geometry
- Multiple Primitives
- Submesh
- 16/32 位索引
- Tangent 生成
- Normal 生成
- Mesh Bounds
- GPU Buffer 复用
- Dynamic Mesh 更新

后续：

- Mesh Compression
- Meshopt Decode
- Draco Decode
- BVH
- Meshlet

---

## 12. PBR 材质系统

### 12.1 基础材质

- Base Color
- Metallic
- Roughness
- Normal
- Occlusion
- Emission
- Opacity
- Alpha Cutoff
- Double-sided
- UV Transform
- Texture Channel Mapping

### 12.2 BRDF

- GGX / Trowbridge-Reitz NDF
- Smith Geometry
- Schlick Fresnel
- Energy Conservation
- Multiple Scattering Compensation 预留
- Lambert 或 Burley Diffuse，可配置并以视觉测试决定默认值

### 12.3 Shader Feature 系统

材质通过 Feature Key 选择 Shader Variant：

- Compile-time：Skinning、Morph、Alpha Mode、Major BRDF Lobe。
- Runtime：颜色、强度、贴图参数和连续数值。

必须实现：

- Shader Module Cache
- Pipeline Cache
- Bind Group Cache
- Variant Warmup
- Fallback Material
- Shader 编译失败诊断

### 12.4 材质扩展

独立扩展包：

- Clearcoat
- Sheen
- Anisotropy
- Transmission
- Volume / Absorption
- IOR
- Specular
- Iridescence
- Subsurface
- Hair Approximation

每个扩展必须声明：

- 额外参数
- 额外纹理
- Shader Chunk
- Render State
- GBuffer / Forward 输出需求
- 兼容性和质量降级

---

## 13. HDRI、IBL 与环境系统

功能：

- Equirectangular HDR 加载
- HDR → Cubemap
- Diffuse Irradiance
- GGX Specular Prefilter
- BRDF LUT
- Environment Rotation
- Intensity / Exposure
- Background 与 Lighting 分离
- Ground Plane / Ground Shadow
- Skybox
- 环境资源缓存

格式：

- HDR
- EXR 后续支持
- KTX2 Cubemap

预计算策略：

- 优先加载已预过滤环境。
- 允许 WebGPU 运行时 Compute 预过滤。
- 结果可缓存到 IndexedDB。

---

## 14. 灯光系统

### 14.1 基础灯光

- Directional Light
- Point Light
- Spot Light
- Area Light Approximation 后续

参数：

- Color / Temperature
- Intensity
- Range
- Spot Cone
- Shadow
- Layer Mask

### 14.2 灯光提交

阶段路线：

1. 小灯光数量的 Forward。
2. Clustered Forward / Forward+。
3. 必要时增加 Deferred 或 Hybrid 路径。

引擎不得永久绑定单一 Forward Pipeline。Render Graph 和 Material Contract 必须允许未来增加 Deferred 功能。

---

## 15. 阴影系统

P0：

- Directional Shadow Map
- Spot Shadow Map
- PCF
- Bias / Normal Bias
- Shadow Resolution Quality
- Ground Shadow

P1：

- Cascaded Shadow Maps
- Point Light Cubemap Shadow
- Stabilized Cascade
- Contact Shadow
- Temporal Shadow Jitter

P2：

- PCSS
- Variance / EVSM 研究
- Ray Query 或路径追踪后端预留

阴影必须是独立 Feature，不在 PBR Shader 中硬编码所有策略。

---

## 16. 动画、骨骼与 Morph

### 16.1 Animation

- glTF Animation Clip
- Translation / Rotation / Scale Track
- Morph Weight Track
- Loop / Once / Ping-pong
- Playback Rate
- Pause / Resume / Seek
- Crossfade
- Multiple Mixer Layers 后续

### 16.2 GPU Skinning

- Linear Blend Skinning
- 4 Bone Influences
- Bone Matrix Uniform / Storage Buffer
- 大骨架 Bone Texture 作为 WebGL2 兼容方案
- Skinned Normal / Tangent
- Skinning Bounds 策略

后续研究：

- Dual Quaternion Skinning
- Compute Skinning
- Shared Animation Pose

### 16.3 Morph Target

- Position Delta
- Normal Delta
- Tangent Delta 后续
- Active Target 限制
- GPU Buffer / Texture Storage
- 与 Skinning 联合

### 16.4 动画与 Temporal

- 动画播放时禁止静态无限累积。
- 使用短历史动态 TAA。
- 动画暂停后重置并开始静态累积。
- 必须避免骨骼动画残影。

---

## 17. Subsurface Scattering

SSS 独立于基础 PBR。

### 17.1 质量档

Low：

- Wrap Diffuse
- Back Lighting
- Thickness Map

Medium：

- Thickness + Curvature Approximation
- 多通道散射颜色

High：

- Screen-space Separable Diffusion
- 深度和法线边缘保护
- Diffuse 与 Specular 分离
- 可配置散射 Profile

### 17.2 材质参数

- Subsurface Color
- Strength
- Radius / Profile
- Thickness Texture
- Curvature Texture 可选
- Transmission / Backscatter

### 17.3 验收

- 皮肤耳朵背光自然。
- 蜡、玉石、叶片可获得不同散射效果。
- 高光不被 SSS 模糊。
- 模型轮廓不产生明显漏光。
- 低端设备自动降级。

---

## 18. 透明、Transmission 与 Volume

支持：

- Opaque
- Alpha Mask
- Alpha Blend
- Additive
- Premultiplied Alpha 可选

Transmission：

- Scene Color Refraction
- IOR
- Rough Refraction
- Thickness
- Beer-Lambert Absorption
- Volume Color / Distance

后续：

- Weighted Blended OIT
- Depth Peeling 研究
- 多层透明近似

必须明确屏幕空间折射的局限，并提供降级策略。

---

## 19. 后处理系统

后处理是插件化 Pass 链，不由 Renderer Core 写死。

### 19.1 P0

- Exposure
- Filmic Tone Mapping
- Gamma / sRGB
- FXAA 兼容选项
- TAA
- Sharpen

### 19.2 P1

- SSAO / GTAO
- Bloom
- Vignette
- Color Balance
- Saturation / Contrast
- LUT Color Grading
- Depth of Field

### 19.3 P2

- SSR
- SSDO
- SSGI
- Contact Shadow
- Motion Blur
- Chromatic Aberration 可选
- Volumetric Fog

### 19.4 输出约定

所有 Pass 声明：

- 输入资源
- 输出资源
- 颜色空间
- 分辨率比例
- Temporal History
- Quality Levels
- 是否支持 WebGL2

---

## 20. TAA 与 Temporal 系统

### 20.1 基础

- Halton、Hammersley 或 R2 低差异序列，基准测试后选定。
- Projection Jitter。
- Previous View Projection。
- Depth Reprojection。
- History Color。
- Neighborhood Clamp。
- Disocclusion Rejection。
- Responsive Mask。

### 20.2 动态场景

- Camera Motion Reprojection。
- Skinned/Morph Motion Vector 后续。
- 透明和 Emission 降低历史权重。
- Material ID 或 Depth/Normal Validation。

### 20.3 静态累积

- 精确 Sample Count。
- Running Average 或高精度累积缓冲。
- 支持 AO、Shadow、DOF Jitter 联动。
- 达到 Max Sample 或 Error Threshold 后停止。

### 20.4 调试

- 查看当前 Sample Index。
- 查看 Jitter Pattern。
- 查看 History Weight。
- 查看 Rejection Mask。
- 查看 Motion Vector。
- 一键 Reset History。

---

## 21. AO、SSDO 与未来屏幕空间间接光

### 21.1 AO 路线

1. SSAO 基线。
2. GTAO 高质量默认。
3. Temporal AO。
4. Bent Normal 输出。

### 21.2 SSDO 扩展接口

SSDO 不能修改 Scene 或 Material Core。

需要的输入：

- Depth
- Normal
- Albedo
- Direct / Indirect Light
- Noise / Sample Pattern

输出：

- Directional Occlusion
- Bent Normal
- Approximate Indirect Diffuse

### 21.3 SSGI 兼容

Render Graph 从一开始预留：

- Hi-Z Depth
- Normal Buffer
- Albedo Buffer
- Lighting History
- Motion Vector

但不要求 P0 全部启用。

---

## 22. 室内映射扩展

室内映射作为独立 Material Extension + Render Feature 开发。

目标：

- 建筑窗户通过低成本 Shader 显示房间深度。
- 支持 Cubemap Interior Mapping。
- 支持 Atlas Rooms。
- 支持楼层、房间随机化。
- 支持窗帘、灯光、家具层。
- 支持日夜状态。
- 支持 Parallax Corrected Interior。
- 支持可选真实室内几何预览模式。

接口示例：

```ts
material.enableExtension('interior-mapping', {
  roomAtlas,
  roomDepth,
  roomSize,
  floorCount,
  randomSeed,
});
```

室内映射扩展只依赖材质扩展接口和标准相机数据，不依赖 Texture Lab。

---

## 23. 资源系统与渐进加载

### 23.1 格式

P0：

- glTF / GLB
- PNG / JPEG / WebP
- HDR

P1：

- KTX2 / Basis Universal
- Draco
- Meshopt
- EXR

### 23.2 Asset 生命周期

```text
Requested
→ Fetching
→ Decoding
→ CPU Ready
→ Uploading
→ GPU Ready
→ Resident
→ Evicted / Disposed
```

### 23.3 渐进加载

- 先显示最低可用资源。
- 高分辨率纹理到达后替换。
- 替换后触发 Texture Dirty 和 Temporal Reset。
- 支持加载进度和取消。
- 支持资源优先级。
- 支持多视口共享 GPU 资源。

### 23.4 缓存

- HTTP Cache
- Memory Cache
- GPU Resource Cache
- IndexedDB 可选
- Reference Count / Ownership
- 显存预算和 LRU 预留

---

## 24. Preview Preset 系统

预览环境不是 UI 硬编码。

首批预设：

- Material Sphere
- Plane
- Cube
- Cylinder
- Rounded Cube
- Fabric / Draped Surface 后续
- Custom Model
- UV Tile Preview
- Turntable
- Studio Product
- Outdoor HDRI
- Interior Room

Preset 定义：

- Mesh / Scene
- Camera
- Lights
- Environment
- Ground
- PostFX
- Quality
- Interaction Rules

Texture Lab 只选择预设并设置材质贴图。

---

## 25. Kyxos Texture Lab 接入协议

接入包：

```text
@kyxos/render-integration-texture-lab
```

职责：

- 将 Texture Lab 输出通道转换为标准材质参数。
- 管理 Preview Preset。
- 监听贴图节点输出变化。
- 合并高频参数更新。
- 控制预览分辨率。
- 提供导出截图。

禁止：

- 引擎读取 Texture Lab Store。
- 引擎依赖 Texture Lab API Route。
- 引擎认识订阅等级、用户 ID 或项目数据库。
- Texture Lab 直接访问 GPUDevice、RenderGraph 或 Shader Cache。

建议桥接接口：

```ts
interface TextureLabRenderBridge {
  mount(canvas: HTMLCanvasElement): Promise<void>;
  setMaterialMaps(maps: MaterialMapSet): void;
  setPreviewPreset(id: string): void;
  setQuality(level: RenderQuality): void;
  capture(options: CaptureOptions): Promise<Blob>;
  dispose(): void;
}
```

高频滑杆修改使用事务：

```ts
bridge.beginUpdate();
bridge.setMaterialParameters(params);
bridge.endUpdate();
```

避免每个参数触发多次无意义的 Shader 或 Bind Group 重建。

---

## 26. 多视口与产品复用

引擎必须支持：

- 一个页面多个 Canvas。
- 多个 Viewport 共用资源。
- 非可见 Canvas 自动暂停。
- `IntersectionObserver` 触发休眠。
- 标签页隐藏时降频或停止。
- 每个 Viewport 独立 Dirty 和 Accumulation。
- Device Lost 后统一恢复。

未来产品通过同一 SDK 使用：

- Texture Lab：材质生成预览。
- Shader Recipes：Shader 参数和示例模型。
- Mobile Visual Lab：低端质量模拟。
- Asset Store：模型和材质在线展示。
- Virtual Interior：室内场景预览。
- Unity Plugin Portal：Unity 资源在线预览。

---

## 27. 性能预算

基准目标需通过真实设备测试，不以开发机单点结果为准。

### 27.1 桌面目标

在 1080p、单材质球、PBR + IBL + Shadow + AO + Bloom + TAA 下：

- 交互 60 FPS 目标。
- 中端独显 GPU 帧时间 ≤ 8 ms 目标。
- 集显 GPU 帧时间 ≤ 16.6 ms 目标。
- 静止收敛后停止持续完整渲染。

### 27.2 移动目标

- 交互 30–60 FPS 自动分档。
- 动态分辨率 0.5–1.0。
- 低端关闭高成本 SSS、DOF、SSR。
- 显存和纹理大小受预算控制。
- 静止后允许少量样本累积并休眠。

### 27.3 CPU 目标

静止时：

- 不遍历完整 Scene。
- 不重复排序 Draw List。
- 不重复创建 JS 对象。
- 不上传未变化 Uniform。
- 不保持无意义 RAF。

### 27.4 性能基准场景

- 单材质球。
- 100 个同材质实例。
- 100 个不同材质对象。
- 1M / 5M 三角形。
- 100 / 500 骨骼。
- 8 / 32 Morph Target。
- 4K PBR 贴图组。
- 透明和 Transmission 压力场景。
- 多视口压力场景。

---

## 28. 质量分档

```ts
type RenderQuality = 'low' | 'medium' | 'high' | 'ultra' | 'auto';
```

分档控制：

- Render Scale
- Shadow Resolution
- Shadow Filtering
- AO Samples
- Temporal Samples
- Environment Resolution
- Bloom Levels
- DOF
- SSS Mode
- Transmission Quality
- Texture Resolution
- Light Count

`auto` 根据：

- WebGPU / WebGL2
- GPU Adapter 信息
- DPR
- GPU Frame Time
- 内存
- 移动设备
- 电池与可见性状态

动态调整必须有滞回，避免质量来回跳动。

---

## 29. Debug 与开发工具

必须内置而非最后补做：

- FPS / CPU / GPU Time
- Draw Calls
- Triangles / Vertices
- Material / Pipeline Count
- Texture Memory Estimate
- Buffer Memory Estimate
- Shader Compile Time
- Render Graph Viewer
- Pass Enable / Disable
- GBuffer Viewer
- Depth / Normal / Motion / AO / Shadow Viewer
- Overdraw View
- Mip Level View
- Light Cluster View
- Bounding Box / Frustum
- Temporal History / Rejection
- Accumulation Sample Count
- Resource Lifetime

Debug 包不进入默认生产 Bundle，支持 Tree Shaking。

---

## 30. 错误处理与设备恢复

必须处理：

- WebGPU 不可用。
- Adapter / Device 创建失败。
- Device Lost。
- WebGL Context Lost。
- Shader 编译失败。
- Pipeline 创建失败。
- 纹理解码失败。
- 非法 glTF。
- 资源取消。
- Canvas 尺寸为零。
- GPU 资源泄漏。

公共错误应包含：

- 稳定错误代码。
- 可读信息。
- 原始原因。
- 发生模块。
- 是否可恢复。
- 建议降级路径。

---

## 31. 测试体系

### 31.1 单元测试

覆盖：

- Math
- Scene Transform
- Bounds
- Dirty Propagation
- Render Graph Dependency
- Resource Lifetime
- Material Feature Key
- Animation Sampling
- Frame Scheduler State Machine
- Quality Selection

### 31.2 集成测试

- WebGPU Backend 创建和销毁。
- WebGL2 Fallback。
- glTF 加载。
- 贴图上传。
- 材质更新。
- 动画播放。
- Device Lost 模拟。
- 多视口。

### 31.3 视觉回归

固定：

- 浏览器版本。
- Canvas 尺寸。
- DPR。
- 相机。
- 环境。
- Seed。
- Accumulation Sample Count。

场景：

- Dielectric / Metal
- Roughness 梯度
- Normal Map
- Clearcoat
- SSS
- Transmission
- Anisotropy
- Skinning
- Morph
- AO / Shadow / Bloom / DOF

允许按平台定义差异阈值。

### 31.4 性能回归

CI 或定期 Benchmark 记录：

- CPU Frame Time
- GPU Frame Time
- Draw Calls
- Memory
- Bundle Size
- Asset Load Time
- Static-to-Sleep Time

性能退化超过阈值必须阻止发布或生成告警。

---

## 32. CI/CD 与发布

每个 PR 必须执行：

1. Install
2. Format Check
3. Lint
4. Type Check
5. Unit Tests
6. WebGPU Integration Smoke Test
7. WebGL2 Integration Smoke Test
8. Shader Validation
9. Build
10. Bundle Size Check
11. Visual Regression 核心场景

发布流程：

- Changesets 生成版本。
- `next` 预发布通道。
- `latest` 稳定通道。
- npm 包独立版本或统一版本，第一阶段建议统一版本。
- 自动生成 API Docs 和 Changelog。

包发布建议：

```text
@kyxos/render-sdk
@kyxos/render-react
@kyxos/render-integration-texture-lab
```

内部包默认不公开，待 API 稳定后决定。

---

## 33. 文档体系

必须持续维护：

- `README.md`：快速开始。
- `DEVELOPMENT_PLAN.md`：总计划。
- `docs/architecture/overview.md`：架构。
- `docs/architecture/dependency-rules.md`：依赖规则。
- `docs/adr/`：架构决策。
- `docs/research/`：算法调研。
- `docs/api/`：公共 API。
- `docs/integration/texture-lab.md`：Texture Lab 接入。
- `docs/performance/`：基准和预算。
- `CONTRIBUTING.md`：开发规范。

关键 ADR：

- ADR-001 WebGPU First / WebGL2 Fallback
- ADR-002 Coordinate and Color Conventions
- ADR-003 Render Graph
- ADR-004 Public SDK Boundary
- ADR-005 Temporal Accumulation and Sleep
- ADR-006 Material Extension System
- ADR-007 Asset Ownership and Cache
- ADR-008 Forward+ and Future Hybrid Pipeline

---

## 34. 开发阶段与里程碑

> 阶段按依赖关系推进。时间只用于规划，不作为牺牲架构和验收质量的理由。

### Phase 0：仓库与架构基线

交付：

- Monorepo
- TypeScript strict
- Lint / Test / Build / CI
- Playground
- Package Boundary Lint
- ADR 基线
- Mock Backend

验收：

- 所有包可独立构建。
- 禁止循环依赖。
- SDK 空壳可被独立示例调用。
- CI 全绿。

### Phase 1：WebGPU Core 与基础三角形

交付：

- Backend API
- WebGPU Device / Queue / Surface
- Buffer / Texture / Sampler / Pipeline
- Command Encoder
- Resource Disposal
- Device Lost

验收：

- 绘制基础几何。
- Resize、DPR 和 Context 生命周期正确。
- 无明显 GPU 资源泄漏。

### Phase 2：Scene、Camera、Geometry 与基础渲染

交付：

- Scene Graph
- Transform Dirty
- Camera
- Orbit Controller
- Mesh / Primitive
- Frustum Culling
- Render Queue

验收：

- Plane、Sphere、Cube、Custom Mesh 正确。
- 自动 framing。
- 可见性裁剪和排序正确。

### Phase 3：基础 PBR 与 IBL

交付：

- Metallic/Roughness PBR
- Normal / AO / Emission
- HDRI
- Irradiance
- Prefiltered Specular
- BRDF LUT
- Tone Mapping

验收：

- 与标准 glTF PBR 参考场景结果接近。
- 线性空间、法线和粗糙度正确。
- 材质球达到产品可用画质。

### Phase 4：Frame Scheduler、TAA 与静止累积

交付：

- Dirty Flags
- Render State Machine
- Jitter
- Dynamic TAA
- Static Accumulation
- Convergence / Sample Limit
- Sleep / Wake

验收：

- 交互流畅。
- 静止画质逐步提高。
- 收敛后停止完整渲染。
- 所有指定 Dirty Event 可唤醒。

### Phase 5：阴影、AO 与标准后处理

交付：

- Directional / Spot Shadow
- CSM
- GTAO
- Bloom
- DOF
- Color Grading
- Sharpen

验收：

- Pass 可独立开关。
- 质量分档生效。
- AO、阴影和 TAA 无明显冲突。

### Phase 6：glTF、纹理压缩与渐进资源

交付：

- glTF / GLB
- KTX2 / Basis
- Draco / Meshopt
- Worker Decode
- Progressive Texture
- Resource Cache

验收：

- 标准 glTF 测试模型正确加载。
- 低分辨率到高分辨率替换无崩溃。
- 资源更新重置 Temporal。

### Phase 7：骨骼动画与 Morph

交付：

- Animation Clips
- Mixer
- GPU Skinning
- Morph Target
- Crossfade

验收：

- 多种骨骼模型正确。
- 动画无明显 TAA 拖影。
- 暂停后开始静态累积。

### Phase 8：高级材质

交付：

- Clearcoat
- Sheen
- Anisotropy
- Transmission
- Volume
- IOR / Specular

验收：

- 各扩展可独立启用。
- 禁用时不产生多余 Pass。
- WebGL2 有明确降级。

### Phase 9：SSS

交付：

- Low / Medium / High SSS
- Thickness
- Backscatter
- Screen-space Diffusion
- Profile

验收：

- 皮肤、蜡、叶片基准场景通过。
- 边缘不明显漏光。
- Specular 不被错误模糊。

### Phase 10：WebGL2 兼容后端

交付：

- WebGL2 Backend
- 基础 PBR
- Shadow
- Animation
- 标准 PostFX
- Capability Fallback

验收：

- 不支持 WebGPU 时自动启动。
- API 无需业务层改写。
- 画质和性能降级可预测。

### Phase 11：Texture Lab 正式接入

交付：

- Texture Lab Bridge
- Preview Presets
- Material Map 更新
- High-frequency Parameter Transaction
- Screenshot
- Theme / Resize Compatibility

验收：

- Texture Lab 只依赖公共接入包。
- 删除 Texture Lab 不影响引擎构建。
- 引擎可在 Playground 独立运行全部功能。

### Phase 12：SSDO、SSR 与室内映射

交付：

- SSDO Feature
- Bent Normal
- SSR
- Interior Mapping Extension
- Interior Preview Preset

验收：

- 新功能通过注册接入。
- Core、Scene、SDK 不因扩展发生破坏性修改。
- 可独立 Tree Shake。

### Phase 13：高级性能与生产加固

交付：

- Forward+
- GPU Culling
- Hi-Z
- Instancing
- Dynamic Resolution
- Memory Budget
- 多视口资源共享
- 完整 Debugger

验收：

- 大场景和多视口基准达到目标。
- Device Lost 可恢复。
- 长时间运行无明显内存增长。

### Phase 14：1.0 发布

条件：

- 公共 SDK 稳定。
- Texture Lab 正式使用。
- WebGPU / WebGL2 可用。
- 核心 Sketchfab 类能力完成。
- 文档、示例、基准、视觉测试完整。
- 无 P0/P1 阻断缺陷。

---

## 35. Sketchfab 功能对齐矩阵

| 能力 | Kyxos 目标 | 阶段 |
|---|---|---:|
| PBR Metallic/Roughness | 完整 | 3 |
| HDRI / IBL | 完整 | 3 |
| Direct Lights | 完整 | 3–5 |
| Shadow | 完整 | 5 |
| Tone Mapping | 完整 | 3 |
| TAA | 完整 | 4 |
| 静止渐进采样 | 完整 | 4 |
| 收敛后停止渲染 | 完整 | 4 |
| SSAO/GTAO | 完整 | 5 |
| Bloom | 完整 | 5 |
| DOF | 完整 | 5 |
| glTF / GLB | 完整 | 6 |
| Progressive Assets | 完整 | 6 |
| KTX2 / Basis | 完整 | 6 |
| Skeletal Animation | 完整 | 7 |
| Morph Target | 完整 | 7 |
| Clearcoat | 完整 | 8 |
| Sheen | 完整 | 8 |
| Anisotropy | 完整 | 8 |
| Transmission / Volume | 完整 | 8 |
| SSS | 多档完整 | 9 |
| WebGL2 Fallback | 完整 | 10 |
| Screenshot Accumulation | 完整 | 4 / 11 |
| Picking | 完整 | 5–7 |
| Multi-viewport | 完整 | 13 |
| SSDO | 扩展增强 | 12 |
| SSR | 扩展增强 | 12 |
| Interior Mapping | Kyxos 增强能力 | 12 |

---

## 36. Definition of Done

任何功能只有同时满足以下条件才算完成：

- 实现代码。
- 公共接口或内部接口清晰。
- 单元测试。
- 集成测试。
- 视觉基准场景。
- 性能数据。
- 错误和降级路径。
- 文档。
- 不产生循环依赖。
- 不破坏 WebGPU / WebGL2 能力声明。
- 不在业务产品中加入临时私有调用。
- 资源可正确 dispose。
- Temporal History 可正确重置。

“画面看起来能跑”不等于完成。

---

## 37. 代码审查强制检查项

每个 PR 检查：

1. 是否引入反向依赖。
2. 是否直接访问其他包私有路径。
3. 是否新增长期 RAF 或无条件每帧工作。
4. 是否正确触发 Dirty Flag。
5. 是否正确 Reset Temporal History。
6. 是否声明 GPU 资源所有权。
7. 是否处理 Dispose / Device Lost。
8. 是否增加不受控 Shader Variant。
9. 是否有 WebGL2 降级或 Capability 声明。
10. 是否有测试和性能结果。
11. 是否可在 Playground 独立验证。
12. 是否误把 Texture Lab 业务逻辑写入引擎。

---

## 38. 首批实施任务

仓库建立后立即执行：

1. 创建 pnpm workspace 和基础目录。
2. 创建 `core`、`backend-api`、`backend-webgpu`、`renderer`、`sdk`、`playground`。
3. 建立 TypeScript strict、ESLint、Prettier、Vitest、Playwright。
4. 建立 GitHub Actions。
5. 添加 dependency-cruiser 或等价工具阻止循环和越层依赖。
6. 编写 ADR-001 到 ADR-005。
7. 完成 Canvas 初始化、WebGPU 设备创建和清屏。
8. 完成第一个三角形和 Sphere。
9. 建立 Renderer Lifecycle 与 Dispose。
10. 建立 Frame Scheduler 空状态机。
11. 建立 Debug HUD 基线。
12. 建立第一个视觉回归截图。

首批任务完成后才开始 PBR，不允许跳过工程基线直接堆 Shader。

---

## 39. 最终架构验收

当以下测试成立时，说明“独立渲染子系统”目标真正完成：

1. `apps/playground` 不依赖 Kyxos Texture Lab，可完整展示引擎。
2. Texture Lab 删除后，引擎所有测试和构建仍然通过。
3. 新建第三方示例项目，只安装 `@kyxos/render-sdk` 即可显示材质球和模型。
4. 新增 SSDO 不需要修改 Scene Graph、Texture Lab Bridge 或公共 Engine 生命周期。
5. 新增室内映射不需要复制 Renderer。
6. WebGPU 与 WebGL2 使用同一公共 SDK。
7. 静止收敛后不持续占用完整 GPU 渲染。
8. 所有 GPU 资源可跟踪、可释放、可在 Device Lost 后恢复。
9. 所有高级功能可以按能力和质量关闭。
10. 1.0 公共 API 有版本、文档和迁移策略。

---

## 40. 项目执行原则

- 先建立边界，再开发功能。
- 先实现正确，再优化性能。
- 优化必须有测量，不凭感觉。
- 视觉效果必须有固定基准，不靠人工记忆。
- 高级效果必须可关闭和降级。
- 静止渐进采样与停止渲染属于核心架构。
- Texture Lab 是第一个调用者，不是引擎的主人。
- Kyxos Render Engine 必须始终能够独立运行、独立测试、独立发布。
