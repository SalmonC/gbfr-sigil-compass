# ADR-0002：存档解析使用独立工作进程

- 状态：Accepted
- 日期：2026-07-22

## 背景

解析器处理外部二进制文件，并可能依赖 FlatBuffers 或社区库。损坏存档、版本漂移和库缺陷不应终止 Electron 桌面外壳或 .NET Engine Host。

## 决策

每次导入启动短生命周期 SaveReader.Worker。Engine Host 内的 SaveReader Client 先创建稳定只读快照，再通过版本化 NDJSON 协议传递快照路径和 SHA-256。Worker 不引用 Domain、Application 或数据库。

## 后果

- Worker 崩溃、超时或泄漏被限制在单次导入。
- 可以单独运行 Worker 复现解析问题。
- 需要维护 IPC 合同、进程生命周期和 DTO 映射。
- Solver 留在 Engine Host；出现真实稳定性证据后再单独决定是否使用独立求解进程。
