# ADR-0001：使用端口与适配器隔离业务核心

- 状态：Accepted
- 日期：2026-07-22

## 背景

工具同时依赖 Electron/React、存档格式、SQLite 和 OR-Tools。这些依赖的更新周期不同，且存档/CV 来源可能切换。

## 决策

Domain 保持纯业务模型，Application 定义用例和外部端口，Infrastructure 实现端口，`GBFRTool.Engine.Host` 作为唯一 C# 组合根。Electron Renderer 只通过桌面协议调用 Engine，不直接引用领域或 adapter。项目引用白名单和跨运行时合同测试由自动守卫执行。

## 后果

- 领域与排序测试无需启动 UI、数据库或 Worker。
- 替换存档来源时无需修改用例。
- DTO、领域对象和持久化记录需要显式映射；这部分重复用于阻断技术细节泄漏。
