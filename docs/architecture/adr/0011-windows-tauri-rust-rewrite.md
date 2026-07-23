# ADR-0011：Windows-only Tauri 2 + Rust 轻量化重构

- 状态：接受
- 日期：2026-07-23
- 决策人：项目所有者

## 背景

Electron v0.2.0 的 Windows ZIP 为 173 MiB，解压后约 426 MiB。实际前端与业务代码约 1 MiB，主要体积来自内置 Chromium 和 self-contained .NET 运行时。项目所有者要求在不牺牲功能和界面质量的前提下显著缩小体积，并明确轻量化版本只需支持 Windows。

## 同类工具核查

| 项目 | 技术路线 | 与本项目的关系 | 结论 |
|---|---|---|---|
| `choeki/gbfr-relink-sim` | React + Vite 静态站，Cloudflare Pages 托管 | 当前界面与数据参考项目 | 页面本身很轻，但没有本地桌面权限、存档路径缓存和原生文件生命周期要求 |
| `BitterG/GBFR-PE-Patch-Tool` | Wails + Go + WebView2 | 同一游戏、直接处理存档 | 最新单文件 EXE 约 20.8 MB，证明系统 WebView 路线适合 GBFR 工具 |
| `wormtql/genshin_artifact`（莫娜占卜铺） | Vue + Rust/WASM，并保留 Tauri 桌面入口 | 用途接近的配装优化器 | 证明复杂配装 UI、Web Worker/WASM 求解和 Tauri 可以共存 |
| `fribbels/Fribbels-Epic-7-Optimizer` | Electron + React，另依赖 Java/Python | 成熟的多角色装备优化器 | 功能强，但运行时和外部依赖不符合轻量、免配置目标 |

`gbfr-relink-sim` 的 `DEPLOYMENT.md` 明确它是纯 Vite 静态站：`npm run build` 生成 `dist`，Cloudflare Pages 每次推送自动部署。这解释了为什么网页版本没有桌面包体积；它没有携带浏览器或 .NET，也没有承担本项目的只读存档解析职责。

## 决策

采用 **Tauri 2 + Rust + React/Vite**，只支持 Windows 10/11 x64。

1. 保留 React 组件、设计 token、CSS、领域模型、方案编解码、缓存状态机和精确求解 oracle。
2. 第一阶段继续让精确求解器运行在 Web Worker 中，保证排序行为不变。只有基准证明需要时才迁移到 Rust；不为“技术统一”承担无收益重写。
3. 用 Rust 重写只读存档适配器，移除 .NET Engine Host、SaveReader Worker 和 self-contained .NET。
4. Rust 侧只承担文件选择、私有快照、校验、FlatBuffers 读取、库存快照持久化和最小 Tauri command。所有 command 使用窄 DTO，不向前端开放任意文件系统能力。
5. 正式构建不包含 Node、Chromium 或 .NET 运行时，使用 Windows 自带的 WebView2。
6. 迁移期间保留 Electron v0.2.0 作为行为与视觉基线；Tauri 版本通过同一真实存档、同一截图方案和同一排序 oracle 后才替换。

## WebView2 分发边界

Tauri 在 Windows 使用系统 WebView2。Windows 10 1803 及以后版本和 Windows 11 通常已经提供该运行时。把 WebView2 离线安装器完整封入会额外增加约 127 MB，固定版本约增加 180 MB，会抵消轻量化目标。

因此：

- 主产物提供免安装 portable EXE/ZIP，目标环境为已更新的 Windows 10/11 x64。
- 同一 Release 另提供可选 NSIS 兼容安装包，内嵌约 1.8 MB 的 WebView2 bootstrapper；只在系统缺少运行时时联网安装。
- 不捆绑 127–180 MB 的离线/固定 WebView2。
- UI 和 Release 说明必须明确这一平台依赖，不把它描述成应用自带组件。

参考：

- https://v2.tauri.app/start/prerequisites/
- https://v2.tauri.app/distribute/windows-installer/
- https://v2.tauri.app/start/

## 目标结构

```text
app/
  src/                    # React/Vite；从现有 renderer/domain 迁移
  src-tauri/
    src/
      commands/           # 窄 Tauri command
      save/               # 只读解析、校验、FlatBuffers
      storage/            # 原子缓存与迁移
      contracts/          # 前后端 DTO
    capabilities/         # 最小权限
legacy/electron/          # parity 完成前保留；完成后由独立提交删除
tools/                    # 共享 oracle、夹具和发行检查
```

实际迁移时可以先原位保留 `desktop/`，避免一次性移动造成难以审查的超大 diff；目录收敛放在行为一致之后。

## 验收门槛

- 功能：原始需求、后续 addendum 和 v0.2.0 已实现功能无回退。
- 求解：相同输入、seed 和库存得到相同有序 Top-10、相同实例身份及问题标记。
- 存档：真实 `SaveData1.dat` 仍读取 401 个双词条因子，源文件 hash 在读取前后不变。
- 视觉：1440×900、1920×1080、125%/150% Windows 缩放下与基线一致，无技能池高度回归。
- 性能：401 因子基准 p95 不劣于 v0.2.0 的两倍；求解不占用 UI 线程。
- 体积：portable ZIP 目标不超过 35 MB，不含系统 WebView2。
- 安全：无 shell、无任意路径读写、无远程导航、无写回存档能力。

## 不采用的方案

- 继续裁剪 Electron：仍必须携带 Chromium，无法达到“小工具”合理体积。
- 纯网页/PWA：最小，但本地路径、只读快照、持久化权限和免安装桌面入口不够稳定。
- Wails：同样可行且已有同游戏成功案例；项目所有者选择 Rust/Tauri，且 Tauri 权限模型和现有 Rust/WASM 配装器案例更贴近后续路线。
- 全 Rust 原生 UI：体积可能更小，但会重写全部 React 交互，视觉和功能回归风险最高。
