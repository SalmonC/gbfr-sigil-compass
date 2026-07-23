# ADR 0008：Electron 桌面外壳与独立 .NET 引擎

- 状态：Accepted
- 日期：2026-07-22

## 背景

Windows 是正式目标，当前开发机是 macOS；用户希望后续能快速调整目标编辑器和整体视觉，同时保持存档读取、排序和求解易测试。既有 WPF/Avalonia 方案不能同时满足当前跨平台调试和 Web UI 迭代需求。Electron 可以复用一套 React/TypeScript 界面，但若让 Renderer 直接访问 Node、文件或数据库，会破坏安全边界和低耦合目标。

## 决策

采用 Electron 作为桌面外壳，并保留独立 .NET 引擎：

1. Renderer 使用 React + TypeScript，只消费 ViewModel，不包含 Node 权限或业务规则。
2. 沙箱 Preload 通过 `contextBridge` 暴露逐用例方法，不暴露原始 `ipcRenderer`。
3. Electron Main 负责窗口、原生对话框、短期文件授权令牌和 Engine 生命周期。
4. `GBFRTool.Engine.Host` 成为 C# 组合根，通过版本化 NDJSON 与 Main 通信。
5. SaveReader Worker 继续作为独立进程，仅解析由 Engine 创建的稳定只读快照。
6. 使用 Electron Forge 的 Webpack TypeScript 路线打包；Windows 必须支持，macOS 作为调试和可选发布目标。
7. 旧 `GBFRTool.App` WPF 项目在架构终审通过、Electron/Engine 骨架可验证后移除，不保留两个生产组合根。

## 安全约束

- `contextIsolation=true`、`sandbox=true`、`nodeIntegration=false`。
- 只加载本地打包内容，限制 CSP、导航、新窗口、权限和 IPC sender。
- Renderer 不接收绝对存档路径；Main 只接受原生对话框产生的 grant ID。
- 不提供任意文件、channel、进程、shell 或 URL API。
- Electron Main 和 .NET Engine 的所有入口都做 schema/长度/版本验证。

这些约束与 Electron 官方 [Security](https://www.electronjs.org/docs/latest/tutorial/security)、[Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation) 和 [Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox) 建议一致。

## 结果

正面结果：

- Windows 与 macOS 共用界面和绝大多数桌面外壳代码。
- UI 可以使用成熟的布局、搜索、tooltip 和组件测试工具，且不影响 C# 核心。
- 存档崩溃隔离、确定性求解和现有领域测试可以保留。
- Renderer 被攻破时可调用的特权能力受到窄 API 和 path grant 限制。

代价：

- 安装包和内存占用高于纯原生桌面 UI。
- TypeScript 与 C# 之间增加一层协议和合同生成测试。
- 需要同时维护 Node/Electron 与 .NET 依赖更新、两套构建工具和平台签名流程。
- Main、Engine、SaveReader 三层进程使生命周期和诊断更复杂，必须以 correlation ID 和 E2E 测试控制。

## 被否决方案

- WPF：Windows 集成简单，但不能在当前 macOS 开发机运行 UI。
- Avalonia：可跨平台且保持单语言，但当前产品最频繁变化在复杂交互和视觉层，团队更看重 Web UI 迭代与测试生态。
- 全部迁移到 Electron/Node：减少跨语言 IPC，但会放弃现有 C# 领域边界和存档/求解复用，并扩大 Renderer/Main 误用文件系统的风险。
- 在 Renderer 直接启用 Node：实现最快，但与只读存档、安全和 UI 解耦要求冲突。
