# 主审阅复核补充

> 日期：2026-07-22
> 复核对象：`independent_requirements_cross_review.md` 及其引用的当前仓库证据
> 原则：保留独立报告原文，本补充只记录主 agent 的证据复核、严重度判断和新增发现。

## 结论

独立报告的五项核心发现均成立，严重度 P1 合理。当前端口与适配器方向无需推倒重来，但以下内容尚不能视为冻结规格：排序比较器、Catalog/unknown 数据流、分析结果信封和随机 Top-K 算法。

Phase A 可以继续准备，但在编写真正的存档 DTO 映射前，需要先修复 Catalog 与 typed partial 合同。Phase B 在排序规则获得用户确认前不应启动。

## 五项核心发现复核

| 发现 | 复核结论 | 证据摘要 |
|---|---|---|
| 少槽优先改变原排序 | 接受，P1 | 原始 5.1/5.2 指向等级优先；研究方案把 `UsedSlots` 插在等级前，并据此进行预过滤 |
| Catalog 与未知 hash 边界缺位 | 接受，P1 | Core 有 raw trait hash，Wire DTO 只剩 Skill ID，solution 没有 Catalog 项目，Snapshot 没有 partial 状态 |
| 分析返回合同不可重放 | 接受，P1 | 文档要求 snapshot/request/comparator/seed，当前用例只返回 `BuildResult[]` |
| signature hash 随机键无法直接线性优化 | 接受，P1 | CP-SAT 不能直接把整套 canonical signature 的 hash 当线性目标；任取 10 个同分解再排序不能保证全局 Top-10 |
| 待确认规则提前成为测试门槛 | 接受，P1 | 研究报告仍列三项待签字，测试策略已写死屏蔽→目标位置→槽位→等级→seed |

## 推荐处置顺序

### Phase A 前立即修订

1. Worker/Core 只输出原始 sigil/trait hash、等级、flags 和解析诊断。
2. Client 侧通过版本化 Catalog adapter 解析稳定 Skill ID；Wire DTO 同时保留 raw hash。
3. `InventorySnapshot` 增加 typed completeness、unknown entries 和结构化 diagnostics。
4. IPC v1 增加显式 `messageType` envelope，并冻结输入限制、失败类型和退出码。
5. 定义 App 与 Worker 的配套发布目录、协议版本与文件 hash manifest。

这组选择让 Worker 保持“只理解存档格式”，Catalog 可以独立更新，UI 侧仍能追踪未知 hash。若后续实测证明 Catalog 依赖游戏表解析必须进入 Worker，再通过新 ADR 调整。

### Phase B 前由用户确认

1. 是否接受“少用槽位优先”；未确认时按原文等级优先，且不能删除无关高等级因子候选。
2. 屏蔽数量按出现次数、种类数还是仅二值判断。
3. 同覆盖数时，屏蔽次数和目标位置谁先比较。
4. “因子等级总数”使用 `sigilLevel` 还是 trait level 组合。
5. Top-10 以实例组合、等级签名组合还是技能展示组合为去重单位。

确认后发布带版本的排序规范，例如 `GBFR-RANK-1`。求解器、缓存、分享字符串和诊断包都记录该版本。

### Phase C 前补齐

- `BuildProfile` 聚合及 Get/List/Save/Delete 仓储合同。
- 分享字符串 schema v1 的字段范围。
- Windows 上 App + Worker 的原子发布与升级验证。

## 主审阅新增发现

### P3：架构时序图与当前导入端口/取消协议漂移

**证据**

- `software-architecture.md:108-110` 仍写 `ExecuteAsync(path)` 和 `ImportAsync(path, context)`。
- 当前代码 `InventoryImportRequest.cs:3-6` 使用 `SourceId + Uri + Options`，`ImportInventoryUseCase.cs:23-36` 接收完整请求。
- `software-architecture.md:122` 写“先发送取消信号”，但 `save-reader-ipc.md:50-52` 定义的是关闭 stdin 后按宽限期终止进程，没有 Cancel 消息类型。

**影响**

Phase A 开发者可能按旧时序实现文件专属接口，或等待一个协议中不存在的取消消息。

**建议**

在开始 Worker Client 实现前同步时序图：使用 `InventoryImportRequest`；将取消统一描述为“关闭 stdin/进程级取消”，或在 IPC v1 中正式增加 `CancelRequest`。

## 不立即修复的原因

本轮用户要求独立提炼和交叉审阅，没有授权按审阅意见改变产品语义。尤其“少槽优先”、屏蔽层级和等级字段会改变前 10 结果，必须由用户确认后再修改方案、测试和代码合同。

## 基础属性主词条增量审阅处置（2026-07-22）

用户后续确认了少槽、屏蔽层级、`sigilLevel`、方案身份、基础属性目标和替代池语义，因此本轮可以修订此前冻结的合同。

| 增量发现 | 处置 |
|---|---|
| 旧请求/结果无法表达两类目标和替代解释 | 接受；新增 `BasicPrimaryTargetPolicy` 与逐目标 `PrimaryTargetMatch` |
| 普通与基础目标可能双计数 | 依据“从 24 个目标中划出 X 个”的原文，确定共享 token 容量；同一主词条不能双计数 |
| 精确与完成数量缺全序 | 确定先最大化基础目标完成数量，再比较按目标顺序的精确覆盖，最后比较替代池顺序 |
| 共享替代池不能贪心 | 接受；规格要求统一 assignment/CP-SAT，并与穷举 oracle 对比 |
| 24 固定还是上限 | 24 是 UI 容量上限，不要求填满；选中目标仍为 1..24，`X <= MaxSlots <= 12` |
| 替代池需进入持久化与 hash | 接受；有序唯一列表进入 Profile、分享字符串、request hash 和诊断包 |
| “普通目标全部必选” | 不接受该转述；原规则仍是普通目标前 N 项必选，其余普通目标为有序软目标 |

该阶段结论已由双层屏蔽需求提升为 [`GBFR-RANK-2`](../architecture/ranking-specification.md)。

## 双层屏蔽增量审阅处置（2026-07-22）

| 增量发现 | 处置 |
|---|---|
| 未启用替代池可能继续占用技能 | 采纳；inactive draft 不进入互斥占用、规范化请求或 request hash，重开时重新验证 |
| 旧冲突双方可能互相锁死 | 采纳；状态拆为 `CanAdd/CanRemove`，已选值始终可删，并提供原子保留动作 |
| 封闭类别 enum 妨碍跟随游戏筛选器 | 采纳；业务 `SemanticCategory` 与开放字符串 `FilterCategoryId` 分离 |
| 同分 assignment 的解释可能漂移 | 采纳；增加不改变方案排名的 canonical witness 规则 |
| 缺少集中规范化和 10 组交集验证 | 采纳；新增 `NormalizedBuildRequest`、normalizer 与 typed occupancy/issue 合同 |
| 旧配置迁移矩阵不足 | 采纳到测试规格；旧 blocked 默认迁移 SoftBlocked，orphan/重分类不静默删除 |
