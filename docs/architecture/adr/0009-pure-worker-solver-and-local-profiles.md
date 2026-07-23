# ADR-0009：纯 Web Worker 求解与本地方案

状态：Accepted（取代总体架构中 C# Solver、SQLite 草稿与 Catalog adapter 的首版安排）

## 背景

首版需要同时支持 Windows 免安装和 macOS 验证，并保证 Top-10 可由小规模穷举 oracle 校验。配装求解只处理已经脱敏的因子词条、等级和目标，不接触文件系统、存档路径或原始二进制。引入 OR-Tools 与 SQLite 会增加两个平台的原生库、VC++ runtime、迁移和安装验证成本，而当前数据量可以由无损动态规划在约 250 ms 内完成。

## 决定

- C# Engine Host 和独立 SaveReader Worker 只承担存档快照的严格只读解析；FlatBuffers 输入继续处于独立进程。
- 求解器放在独立 Web Worker，输入输出使用 `SolverRequest/SolverAnalysis` 类型。它是纯函数，不引用 React、Electron、Node、DOM、文件或网络 API。
- Renderer 只负责收集编辑状态和展示；排序、多重集、token 分配、方案等价和 Top-K 都在 `domain/solver.ts`。
- Catalog 是随应用打包的固定 JSON 快照；分类纠错只发生在可重放的 import adapter 中。
- Profile codec 和本地存储集中在 `domain/profile-codec.ts`。分享导入、保存和分析都经过同一 schema 与 Catalog-aware 校验；无序屏蔽集合在编码时规范排序。
- 本地方案暂存于 Electron 会话的持久化 `localStorage`，不包含库存、路径或玩家身份。该模块可在不改 UI 和求解器的情况下替换为文件或数据库 adapter。

## 后果

- Electron 包无需 OR-Tools、SQLite 或 VC++ 原生依赖；Windows 采用解压即用目录。
- 20 秒级同步计算被移出 UI 线程；当前真实样本约 14,550 个状态、约 205 ms。
- 精确性由独立穷举 oracle 对反例和确定性随机小库存逐项对照，禁止重新加入无证明的全局状态上限。
- `GBFRTool.Infrastructure.Solver.OrTools`、Catalog/SQLite C# 项目仅保留为早期骨架，不进入运行时组合根；后续若数据规模确实超过纯 Worker 能力，需新 ADR 和等价 oracle 后才可替换。
