# 软件架构文档索引

- [总体架构](software-architecture.md)：质量属性、模块边界、依赖规则和运行时视图。
- [Electron 桌面合同](desktop-contracts.md)：八域 schema、版本化编辑、path grant、子进程启动和资源限制。
- [存档工作进程协议](save-reader-ipc.md)：进程模型、NDJSON 消息、版本与错误处理。
- [调试与可观测性](debugging-and-observability.md)：关联 ID、结构化日志、诊断包和隐私。
- [测试策略](testing-strategy.md)：测试金字塔、契约测试、golden fixtures 和确定性验证。
- [匹配与排序规格](ranking-specification.md)：`GBFR-RANK-4`、三类主词条、双层屏蔽、位置敏感的结果去重和 Top-10 比较器。
- [目标配置交互](block-pool-ui.md)：统一技能池、子目标激活、动态容量、问号气泡、互斥原因和无障碍状态。
- [ADR-0011：Windows-only Tauri 2 + Rust 轻量化重构](adr/0011-windows-tauri-rust-rewrite.md)：Electron 可用基线之后的技术栈、迁移边界和验收门槛。
- [ADR-0010：方案缓存、因子占用与计算状态机](adr/0010-cache-reservations-and-analysis-state.md)：实例身份、缓存键、确认冲突和求解触发边界。
- [ADR](adr/)：已经接受的架构决策及其后果。

当前实现边界以 [ADR-0009：纯 Web Worker 求解与本地方案](adr/0009-pure-worker-solver-and-local-profiles.md) 为准；它取代总体架构中尚未实现的 C# Solver/SQLite 草案，但不改变存档解析的双进程隔离。

架构约束由 `tests/GBFRTool.ArchitectureTests` 执行。新增项目或项目引用时必须同步更新依赖策略；守卫失败时不得绕过测试。
