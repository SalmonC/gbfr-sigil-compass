# GBFR 因子配装工具：独立需求交叉审阅

> 审阅日期：2026-07-22
> 审阅范围：`docs/original_requirements.md`、`docs/GBFR_factor_build_tool_research_and_implementation_plan.md`、`docs/architecture/` 全部 Markdown/ADR、`README.md`、`GBFRTool.slnx`、`src/` 与 `tests/` 中全部手写源码及项目文件（排除 `bin/obj`）、`findings.md`。
> 证据原则：仅以仓库文件为依据。本报告不把尚未实现的占位 adapter、空白 WPF 页面或 Worker 仅支持 `--self-test` 本身列为缺陷。

## 执行摘要

当前成果已经形成一套质量较高的研究方案和清晰的端口—适配器骨架：原始诉求被完整落盘；V+ 双词条、主副顺序、重复库存实例、有序重复目标、必出前缀、屏蔽词条、最多 12 槽、前 10 结果等核心概念均被识别；存档严格只读、独立 Worker、不可变库存快照、CP-SAT + 穷举 oracle、可复现诊断等决策具有良好的安全性和可维护性。当前没有 P0 问题，也没有理由把基础设施项目中的 `AssemblyMarker`、Worker 的 Phase A 提示或架构测试尚未使用测试框架误报为实现缺陷。

但还不能把当前方案直接当作已冻结的实现规格。最重要的问题有五个：

1. 方案新增了“同等满足时少用槽位优先”，并据此提前剪枝；这会把原始 5.1/5.2 中“等级总和优先”的结果改写，且研究文档自己仍把它列为待确认项。
2. Catalog 的所有权没有落到项目或协议边界上；原始 trait hash 在 IPC 中被换成稳定 Skill ID，Domain 又只保留字符串诊断，无法落实“未知 hash 不丢失、快照标为 partial”。
3. 架构要求结果携带 snapshot ID、request hash、比较器版本和 run seed，但现有 `IBuildSolver`/`AnalyzeBuildUseCase` 只返回 `BuildResult` 列表，返回合同无法承载这些重放元数据。
4. “`runSeed + canonicalBuildSignature` 作为最终随机键”的定义是非线性的；现有方案没有说明 CP-SAT 如何在不枚举巨大同分集合的情况下严格求得该随机全序的 Top-10，因此“保证正确的前 10”尚缺可实现证明。
5. 屏蔽计数口径、屏蔽与目标优先级的先后、等级总和字段仍被研究文档列为待确认，但测试策略已经把某一顺序写成发布门槛。需求冻结状态与架构承诺不一致。

结论：可以继续做只读存档 Phase A 的实验性解析，但在进入会固化求解器、持久化 schema 和 UI 合同的 Phase B/C 前，必须先冻结排序规格、Catalog/未知项边界、分析结果信封和 Top-K 算法。

## 状态口径

追踪矩阵只使用以下状态：

- **已覆盖**：研究方案和架构/骨架已给出一致、足以继续实现的约束；不表示最终功能已经完成。
- **部分覆盖**：已有设计或模型，但仍缺关键规则、合同字段或验收闭环。
- **未覆盖**：方案或架构没有处理该诉求。
- **有冲突**：后续决策改变或互相矛盾于原始语义。
- **尚未进入实现**：研究方案已覆盖，但按明确分期尚无功能实现；这种状态本身不是缺陷。

## 逐条需求规格

### 0. 前置领域规则

**明确规则**

- 首版只考虑具有两个有效技能的 V+ 因子；单技能因子不参加配装。
- 每个因子的两个技能有顺序，前者是主词条；`A&B` 与 `B&A` 不等价。
- 覆盖目标按“技能出现次数”计算，不按技能等级效果计算；同一技能可要求和携带多次。
- 等级不影响“是否满足一条目标”，但原始 5.1 要求等级参与最终排序。
- 内容和等级完全相同的两个因子仍是两个库存实例，求解时可同时使用。
- 技能存在分类；原始文本中的分类名称不确定，需要外部资料确认。

**隐含约束**

- 库存模型必须同时保留实例身份、主副顺序和等级，不能只存技能集合或按内容去重。
- 经过合成得到的非常规主副组合只要实际存在于存档中就应被信任，不能用旧掉落池规则过滤。
- “V+”判定需要稳定数据规则，不能仅靠显示名称。

**可验收条件**

- 两个完全相同实例导入后数量为 2、实例键不同，并可在一套结果中同时选择。
- `A&B` 与 `B&A` 产生不同 canonical signature 和不同展示组合。
- `A&A` 能提供两次 A；目标 `A,A,A` 最多覆盖两次时结果为 2/3。
- 主、副 trait 与各等级对真实存档抽样 100% 对齐游戏 UI。

**仍有歧义**

- 原文“一般最低为 11 级，最高为 15 及”中的等级范围和异常值处理。
- 5.1 的“因子等级总数”究竟是 `sigilLevel`、主词条等级、副词条等级，还是某种组合。
- V+ 的精确定义、固定双技能/特殊因子/合成因子的纳入条件。

### 1. 库存自动读取

**明确规则**

- 优先直接传入并读取存档文件。
- 只有存档路线不可行时才采用 CV + 自动滚动。
- 自动读取是硬需求；大库存下手工逐件录入不是可接受主线。

**隐含约束**

- 存档读取应严格只读，避免修改源文件；游戏保存并发需要稳定快照或明确失败。
- 读取结果应可诊断：实例数量、过滤原因、未知 hash、解析器/数据版本和源内容 hash 均需保留。
- CV 若启用，必须限制窗口、DPI、语言、滚动去重和低置信复核。

**可验收条件**

- 研究方案第 12.1 节十项存档闸门全部通过，尤其源文件零写入、数量一致、30 件抽查 100% 一致、重复实例不合并、并发保存不产生半快照。
- 至少两份不同玩家、由目标游戏版本重新保存的存档通过验证。
- 存档路线明确失败时存在启动 CV 设计/实施的可执行判据，而不是永久搁置。

**仍有歧义**

- “不可行”的产品判据：一次版本不兼容、连续样本失败、无法在时限内修复，还是法律/许可原因。
- 当前方案提出的“两轮失败”和未来版本“10 个工作日”阈值均是新增策略，不是原始确认值。

### 2. 根据库存求配装并输出方案

**明确规则**

- 输入为已有库存和用户手动指定的目标技能多重集。
- 一件因子的两个词条分别贡献一次出现；同一物品实例不能重复使用。
- 至多使用游戏可用的 12 个因子位置。
- 输出可用库存能够形成的方案；超过 10 个时只显示前 10 个。
- 展示需要按有序主副组合聚合，例如 `追击&伤害上限*2 + 伤害上限&追击`。

**隐含约束**

- “前 10”必须由完整、稳定的比较器定义，不能依赖求解器搜索顺序。
- 实例级求解与聚合展示要分离；聚合不能丢失库存数量和展开定位能力。
- 必须说明何为“不同方案”：不同实例、不同等级组合、不同主副组合，哪些参与去重。

**可验收条件**

- 示例目标 3 追击 + 3 伤害上限可由三件双命中因子满足，并正确聚合。
- 相同展示组合的多个实例不会被错误复用；展开可定位实际 slot ID。
- 小规模库存的前 K 与穷举 oracle 完全一致。

**仍有歧义**

- “所有能满足方案”与后续允许部分满足的关系；合理解释是输出所有满足必出约束的候选并按覆盖度排序。
- 不足 12 槽是否天然优先、是否允许补入无关高等级因子，原始文本没有规定。
- 结果去重究竟按技能组合、等级签名还是实例组合。

### 3. 多余技能、屏蔽词条、目标顺序和必出前缀

**明确规则**

- 目标数可少于所选因子产生的总词条数，额外词条仍属于方案的一部分。
- 屏蔽词条越多，方案在同等覆盖条件下越靠后；命中屏蔽词条需要标红。
- 目标列表有顺序，越靠前越重要。
- 前 X 条可设为必出；任何必出目标未满足时，该方案不能输出。

**隐含约束**

- 目标是有序 multiset；重复技能的库存数量应先分配给该技能更靠前的目标位置。
- 必出前缀也按多重集计数，不能只验证技能种类是否出现。
- 标红不能只依赖颜色，需附文字/图标以满足可访问性。

**可验收条件**

- 目标 `[A,B,A,C]`、供给 `A,A,C` 的覆盖向量固定为 `[1,0,1,1]`。
- 前三项 `[A,B,A]` 必出时，需要两次 A 和一次 B；不足则返回“没有满足全部必出技能的方案”。
- 同样满足数时，无屏蔽方案排在有屏蔽方案之前；满足更多目标的有屏蔽方案仍排在满足更少目标的无屏蔽方案之前。
- 结果卡片能定位每个屏蔽命中。

**仍有歧义**

- “屏蔽技能越多”按出现次数还是不同技能种类数；研究方案选择出现次数，但尚未得到原始确认。
- 一个技能能否同时存在于目标和屏蔽列表；研究方案选择禁止冲突。
- 同覆盖数时，是先比较屏蔽次数还是先比较目标位置。5.4 支持“先屏蔽”，但研究方案仍把它列为待确认。

### 4. 目标选择、分享字符串和方案保存

**明确规则**

- 提供 24 个带搜索能力的技能选择位，允许重复，至少选择 1 项；否则分析按钮禁用。
- 支持字符串导入为有序技能列表，也支持把当前有序列表导出为字符串。
- 当前方案可命名并保存在应用内；库存更新后可重新分析。

**隐含约束**

- 分享格式必须带 schema/version，避免技能改名或未来版本导致静默误读。
- 保存对象需要独立的 profile ID、名称、版本、创建/更新时间和完整请求内容，而不应只保存匿名 `BuildRequest`。
- 导入必须限制长度、数量和未知 ID；损坏输入不能使应用崩溃。

**可验收条件**

- 1..24 项、重复项、顺序、必出 X、屏蔽列表在编码—解码后完全一致。
- 0 项时按钮不可用，25 项或非法必出 X 被拒绝。
- 命名方案可新增、列出、加载、改名/覆盖确认、删除，并在新库存快照上重新分析。

**仍有歧义**

- 原始“字符串”是否只要求目标列表，还是也应携带必出、屏蔽和槽位设置；研究方案选择后者。
- 同名方案的冲突策略、删除/重命名行为。
- `maxSlots` 是否应该成为用户可分享、可配置字段；原始需求只陈述游戏有 12 个槽。

### 5.1 完整满足时的排序

**明确规则**

- 所有目标均满足时，因子等级总和越高越靠前。
- 等级也完全一致时随机排序。

**隐含约束**

- 随机只作为前述业务键完全相同后的最终 tie-break。
- 为可调试和测试，可把一次随机结果绑定到 seed；显式重新分析/重新随机可产生新 seed。

**可验收条件**

- 两个完整满足、等级总和不同的方案，较高者必须优先。
- 所有已确认业务键相同时，同一 seed 顺序可复现；新 seed 可改变顺序。

**仍有歧义**

- 等级采用哪个字段。
- 原始需求没有授权“使用更少槽位”排在等级之前。
- 随机是否要求均匀分布，还是只要求不可固定偏向某一方案。

### 5.2 部分满足但满足必出时的排序

**明确规则**

- 先比较满足目标总条数，更多者优先。
- 满足条数相同时，按目标位置从前到后比较覆盖向量；第一个仅由一方满足的位置决定胜者。
- 覆盖向量完全一致时，回到 5.1 的等级总和与随机 tie-break。

**隐含约束**

- 重复目标的覆盖向量必须采用确定的“靠前位置先满足”规则。
- 5.4 插入同满足数内的屏蔽比较层级，但不能让较少覆盖反超较多覆盖。

**可验收条件**

- 目标 A/B/C 且 A 必出时，覆盖 A+B 的方案排在覆盖 A+C 之前。
- 覆盖向量相同但等级不同，按已确认的等级字段降序。

**仍有歧义**

- 5.4 的屏蔽比较应插在目标位置之前还是之后。
- 同覆盖向量时是否允许新增槽位成本；原始文本直接指向 5.1，没有该层级。

### 5.3 必出失败

**明确规则**

- 未满足全部必出目标时，不输出任何方案，并提示没有满足的方案。

**可验收条件**

- 必出前缀不可行时结果集合为空，返回稳定、可本地化的业务错误/状态和缺口诊断。

**仍有歧义**

- 是否只给统一提示，还是显示每项最大可用量；研究方案增加了缺口诊断，属于兼容增强。

### 5.4 屏蔽词条相对排序

**明确规则**

- 同满足目标条数时，正常方案排在带屏蔽词条的方案之前。
- 带屏蔽词条但满足更多目标的方案，仍排在满足更少目标的正常方案之前。

**可验收条件**

- `20 条 + 屏蔽` 必须排在 `19 条 + 无屏蔽` 之前。
- 同为 20 条时，无屏蔽排在有屏蔽之前。

**仍有歧义**

- 两个都有屏蔽时按命中次数、种类数还是仅二值比较。
- 屏蔽次数与目标位置的先后层级。

### 6. 需求记录、第一性原理分析和实现方案

**明确规则**

- 原始诉求必须独立落盘并保持原意。
- 需要从第一性原理补充遗漏项并给出实施方案。

**可验收条件**

- 原文文件存在，研究报告能区分原始要求、研究事实、建议补充和待确认决策。
- 任何改变排序结果的建议在实现前获得正式确认，不能以“合理默认”悄悄固化。

**仍有歧义**

- 原始诉求要求研究/方案，并未直接授权实现；仓库当前已建立骨架。`README.md:3,23` 已如实标明骨架和下一阶段边界，因此本审阅不把骨架存在本身视为越界。

### 参考项目与许可约束

**明确规则**

- 可研究指定及相似项目的设计思路，但不能因游戏不同而直接搬入其功能。

**隐含约束与验收**

- 无明确许可证的项目只能作为互操作事实和交叉验证线索，不能复制源码或整包数据。
- 发布前应形成第三方许可证清单，并保留数据来源与置信度。

## 需求追踪矩阵

| 原始编号/规格 | 研究方案证据 | 架构/代码骨架证据 | 状态 | 说明 |
|---|---|---|---|---|
| 0.a Windows 桌面工具 | 方案 `9.1`（`437-448`） | `README.md:7`；`GBFRTool.App.csproj:3-6` | 已覆盖 | .NET 10 + WPF 与 Windows 单平台一致。 |
| 0.b 仅 V+ 双技能、主副有序 | 方案 `3.2-3.3`（`59-61,76-84,107`） | `SigilInstance.cs:5-15`；`ParsedSave.cs:9-18` | 部分覆盖 | 模型保留顺序和三个等级；V+ 判定规则尚未实现。 |
| 0.c 完全重复实例不能合并 | 方案 `3.3,7.5,12.1` | `SigilInstance.cs:6-8`；`WireSigilInstance` 含 `InstanceId` | 已覆盖 | 实例 ID 与展示聚合被分离。 |
| 0.d 技能分类与目录 | 方案 `3.2,6.5` | 架构提到 Catalog（`software-architecture.md:10,152`）但无项目/端口 | 部分覆盖 | 研究已确认分类；Catalog 所有权缺位。 |
| 1.a 存档优先、严格只读 | 方案 `4-6,12.1` | ADR-0002；`IReadOnlySaveParser.cs`；Worker/Client 项目边界 | 尚未进入实现 | Worker 明确是 Phase A 占位，不是缺陷。 |
| 1.b 存档失败后 CV 自动滚动 | 方案第 10 节 | `IInventorySource.cs:6-13`；`software-architecture.md:85,92` | 部分覆盖 | 端口可替换，但触发阈值是新增策略且 CV 未实现。 |
| 2.a 有序重复目标、多重集覆盖 | 方案 `3.3-3.4,7.2` | `BuildRequest.cs:5-12`；`BuildResult.cs:3-11` | 部分覆盖 | 数据形状已有，覆盖/求解规则尚未实现。 |
| 2.b 最多 12 槽 | 方案 `7.2` | `BuildRequest.cs:9` | 部分覆盖 | `MaxSlots` 无 1..12 不变量，且被扩展成可分享设置。 |
| 2.c 前 10 与聚合表达式 | 方案 `7.4-7.5,8.4` | `BuildRequest.cs:11`；`BuildResult.cs:10` | 部分覆盖 | `ResultLimit` 无上限，Top-K 与展示尚未实现。 |
| 3.a 多余词条与屏蔽标红 | 方案 `3.5,8.4` | `BlockedSkillIds`/`BlockedOccurrences` 已建模 | 尚未进入实现 | UI 和求解 adapter 尚未实现。 |
| 3.b 有序优先级 | 方案 `3.4,7.3` | `OrderedTargets`、`CoverageByTargetPosition` | 部分覆盖 | 合同支持，比较器未实现且层级未冻结。 |
| 3.c 前 X 必出 | 方案 `7.2,8.2` | `BuildRequest.cs:7` | 部分覆盖 | 无范围验证；不可行诊断尚未建模。 |
| 4.a 24 个搜索下拉、1..24、重复 | 方案 `8.2` | WPF 仅架构占位 | 尚未进入实现 | 符合 Phase C 分期。 |
| 4.b 有序字符串导入/导出 | 方案 `8.3,12.4` | 仅错误前缀 `share.*`，无 Share 模块/合同 | 尚未进入实现 | 方案覆盖，架构边界尚需补充。 |
| 4.c 命名并保存方案、库存更新后重跑 | 方案 `8.2,9.3` | `IBuildProfileRepository.cs:6-10` | 部分覆盖 | 当前接口只能列匿名 `BuildRequest`，不能保存/命名。 |
| 5.1 完整满足后等级优先、同级随机 | 方案 `7.3,11.6` | ADR-0004；`LevelSum`、`RunSeed` | 有冲突 | 新增槽位层级插在等级之前，且等级字段未确认。 |
| 5.2 覆盖数→目标位置→等级→随机 | 方案 `7.3` | `testing-strategy.md:21` | 有冲突 | 方案插入屏蔽和槽位；屏蔽有 5.4 依据，槽位无原始授权。 |
| 5.3 必出失败无方案并提示 | 方案 `7.2` | 用例/错误模型可承载，但无专用结果 | 部分覆盖 | 求解实现尚未进入；建议用 typed outcome 表示业务不可行。 |
| 5.4 覆盖数优先于屏蔽、同覆盖下屏蔽后置 | 方案 `7.3,12.2` | `BlockedOccurrences` 和测试策略 | 部分覆盖 | 基本一致；计数口径及其与目标位置先后仍待确认。 |
| 6.a 原始诉求独立落盘 | `original_requirements.md` | README 指向架构，研究文档保留原文链接 | 已覆盖 | 原文未被改写。 |
| 6.b 第一性原理分析与实施计划 | 整份研究方案 | 架构文档、ADR 和可编译骨架 | 已覆盖 | 但需修复本报告列出的合同/语义问题。 |
| 参考项目不照搬、许可审查 | 方案 `5.2,11.9` | ADR-0003、只读与隐私边界 | 已覆盖 | 未许可项目被明确限制为研究线索。 |

## 六个角度的总体审阅

| 角度 | 评价 | 主要证据与风险 |
|---|---|---|
| 正确性 | 基础模型方向正确，但排序规格未冻结 | 有序 multiset、实例身份、主副顺序、oracle 都正确；槽位优先改变原始排序，最终随机 Top-K 尚无可实现证明。 |
| 低耦合 | 整体较强 | Domain/Application/Infrastructure 和 Worker 边界清晰；但 Catalog 映射没有明确归属，分享模块也只存在于方案文本。 |
| 可维护性 | 文档和 ADR 较好，若干接口过早定型 | 依赖白名单、版本化 IPC、migration 原则合理；Build Profile 与分析返回合同不足，后续必然破坏性修改。 |
| 可调试性 | 设计优秀，代码合同尚未承接 | correlation ID、快照 hash、request hash、seed、诊断包设计完整；现有结果返回值和字符串 Diagnostics 会丢失关键结构。 |
| 过度设计 | 总体克制，少量未确认扩展 | 独立 Worker 对外部二进制解析是合理隔离，拒绝插件 SDK 也克制；可配置 `MaxSlots`、任意 `ResultLimit`、未确认的槽位目标属于额外产品语义。 |
| 版本/安全风险 | 原则正确，部署供应链与目录边界需补齐 | 只读快照、hash 复核、本地诊断、无遥测、无写回都很好；Catalog 版本归属、Worker 配套发布/完整性、第三方包锁定与许可证清单尚未定义。 |

## 审阅发现（按严重度）

### P0

未发现会立即造成源存档写坏、数据泄露或使当前骨架无法继续研究的 P0 问题。

### P1-1：新增“少用槽位优先”已改变原始等级排序，并污染剪枝前提

**证据**

- 原始 5.1 明确规定完整满足后先按等级总和，等级一致才随机：`docs/original_requirements.md:20`。
- 原始 5.2 规定覆盖向量完全一致后“同 5.1”：`docs/original_requirements.md:22`。
- 研究方案把 `usedSlots` 插在等级之前：`docs/GBFR_factor_build_tool_research_and_implementation_plan.md:330-340`。
- 方案又以该新增规则为前提，提前删除既不命中目标也不涉及屏蔽的因子组：同文件 `302`。
- `findings.md:10` 和 `docs/architecture/testing-strategy.md:21` 已把该顺序写入决定/测试口径，但研究方案 `689-697` 又承认仍需正式确认。

**影响**

两个覆盖与屏蔽完全相同的方案中，3 槽低等级方案会反超 4 槽高等级方案，直接违反原始 5.1/5.2 的字面排序。若用户不接受新增规则，`7.1` 的剪枝也不成立，因为一个无关高等级因子会提高原始等级总和。

**建议修正**

在独立的“排序规格/ADR”中给出反例并取得确认。未确认前，应以原始比较器为准：覆盖数 → 5.4 确认层级 → 目标位置 → 等级总和 → 随机；不要依据槽位成本剪枝。若接受少槽优先，明确它是需求变更而非“形式化原文”，同步修改原始需求派生规格、测试和产品文案。

### P1-2：Catalog 映射职责缺位，未知 trait 无法按方案端到端保真

**证据**

- 研究方案要求未知 trait 保存为 `Unknown(0x...)` 并把快照标为 partial：`docs/GBFR_factor_build_tool_research_and_implementation_plan.md:269-271`。
- 研究方案模块图包含 `GBFRTool.Catalog`：同文件 `450-460`；软件架构也声称版本变化限制在 Catalog，并要求未知 hash 原样保留：`docs/architecture/software-architecture.md:9-10,146-153`。
- 实际 solution 和项目职责表均没有 Catalog 项目/端口：`GBFRTool.slnx:2-15`、`docs/architecture/software-architecture.md:55-68`。
- Core 的 `ParsedSigil` 保留原始主副 trait hash：`src/GBFRTool.SaveReader.Core/Model/ParsedSave.cs:9-18`；但 IPC 的 `WireSigilInstance` 只发送 `PrimarySkillId`/`SecondarySkillId`，不发送原始 trait hash：`src/GBFRTool.Contracts/SaveReader/WorkerMessages.cs:23-33`。
- Domain 的 `InventorySnapshot` 仅有 `IReadOnlyList<string> Diagnostics`，没有 completeness/partial 状态或结构化未知项：`src/GBFRTool.Domain/Inventory/InventorySnapshot.cs:3-10`。

**影响**

当前边界无法回答“谁把 hash 映射成稳定 Skill ID”“使用哪个 catalog”“映射失败时如何保留原值”。若 Worker 映射，缺少 Catalog 依赖；若 Client 映射，IPC 已经丢了原始 hash。字符串诊断也不足以阻止 UI 把 partial 快照宣称为完整结果。

**建议修正**

二选一并写入 ADR：

1. 推荐让 Worker/Core 只输出原始 hash + 等级 + flags，Client 侧通过版本化 Catalog adapter 映射为 Domain；或
2. 新增纯 `GBFRTool.Catalog` 项目供 Worker 使用，并在响应中同时保留 raw hash、resolved Skill ID、catalog version 和 resolution status。

无论选择哪条，都应给 `InventorySnapshot` 增加结构化 `CompletenessStatus`、`InventoryDiagnostic` 和 unknown trait 表示，禁止只靠自由文本。

### P1-3：分析返回合同无法满足架构承诺的可重放性

**证据**

- 架构要求结果引用 snapshot ID、request hash 和 run seed：`docs/architecture/software-architecture.md:146-153`。
- ADR-0004 还要求比较器版本：`docs/architecture/adr/0004-deterministic-solver-results.md:10-12`；调试文档把 request hash/run seed 定义为核心关联标识：`docs/architecture/debugging-and-observability.md:14-20`。
- `IBuildSolver` 只返回 `Outcome<IReadOnlyList<BuildResult>>`：`src/GBFRTool.Application/Abstractions/IBuildSolver.cs:7-13`。
- `AnalyzeBuildUseCase` 也只把结果列表直接返回：`src/GBFRTool.Application/UseCases/AnalyzeBuildUseCase.cs:12-30`。
- `BuildResult` 没有 snapshot ID、request hash、run seed 或 comparator version：`src/GBFRTool.Domain/Builds/BuildResult.cs:3-11`。

**影响**

UI、持久化和诊断包无法仅凭用例返回值记录一次分析的完整身份；后续只能依赖隐藏上下文或重新计算，容易出现“展示的结果与记录的 seed/快照不一致”。

**建议修正**

在 Application 层定义 `BuildAnalysis`/`AnalyzeBuildResponse` 信封，包含 `SnapshotId`、规范化请求、`RequestHash`、`RunSeed`、`ComparatorVersion`、solver status（OPTIMAL/FEASIBLE/超时）和结果列表。`IBuildSolver` 可返回 solver-specific outcome，但用例最终必须组装并返回完整信封。

### P1-4：最终随机键的 Top-10 算法没有可实现的严格定义

**证据**

- 方案称可把层级乘权重放入 `int64`，再逐次加 no-good cut 得到保证正确的前 10：`docs/GBFR_factor_build_tool_research_and_implementation_plan.md:346-352`。
- 最终 tie-break 又定义为 `runSeed + canonicalBuildSignature` 的稳定伪随机键：同文件 `350`；ADR-0004 `12` 同样采用该定义。

**影响**

canonical signature 是整套选择向量的函数。其 hash/伪随机值通常不能表示为 CP-SAT 的线性目标，也不能简单乘权重塞入既有 `int64` 标量。若先求出任意 10 个同分解再在其中随机，会漏掉真实随机全序下应进前 10 的候选；若枚举全部同分解，规模可能不可接受。因此当前文本不足以支撑“保证正确的前 10”承诺。

**建议修正**

把最终 tie-break 改成可由模型严格优化的、种子化总序，例如：按 seed 对压缩组生成一个确定排列，再对计数向量做逐变量词典序优化；或定义有界、无歧义的种子化线性权重并明确碰撞后的 canonical 次级序。然后用穷举 oracle 验证完整 Top-K。若坚持整套 signature hash 排序，则必须给出完整同分候选的可行枚举策略和超时时的可信度降级，不能继续声称无条件保证 Top-10。

### P1-5：三项排序决策尚待签字，却已进入“发布门槛”表述

**证据**

- 研究方案明确列出待确认的三项：屏蔽/目标位置先后、少槽优先、等级字段：`docs/GBFR_factor_build_tool_research_and_implementation_plan.md:689-697`。
- 同一方案前文已经把具体比较器写成推荐完整顺序：`330-344`。
- 测试策略要求逐级验证“满足数、屏蔽次数、目标位置、槽位、等级和 seed”：`docs/architecture/testing-strategy.md:15-21`。

**影响**

开发者会把尚未确认的产品选择当成稳定架构约束；一旦测试、数据库结果缓存和分享字符串依赖该顺序，后续更改会造成大范围返工并改变用户前 10。

**建议修正**

增加状态为 Proposed 的排序 ADR/规范，在签字前把测试文字改为“按已冻结 comparator version 验证”。签字后记录明确版本，例如 `GBFR-RANK-1`，并给出至少以下金样例：屏蔽 vs 目标位置、3 槽低等级 vs 4 槽高等级、三个等级字段分离、不同 seed 的最终同分解。

### P2-1：Build Profile 仓储合同无法完成“命名并保存”

**证据**

- 原始需求要求取名并存储：`docs/original_requirements.md:16`。
- 方案要求保存名称、目标、必出、屏蔽、槽位和 schema，并给出带 ID/name/timestamps 的表：`docs/GBFR_factor_build_tool_research_and_implementation_plan.md:378-386,466-484`。
- `IBuildProfileRepository` 只有 `ListAsync`，返回匿名 `BuildRequest`：`src/GBFRTool.Application/Abstractions/IBuildProfileRepository.cs:6-10`。

**影响**

该接口不能新增、读取单项、改名、更新或删除，也没有 profile 身份、名称和版本；若按现状实现 SQLite adapter，Phase C 必须破坏性重做端口。

**建议修正**

先定义独立 `BuildProfile` 聚合（ID、Name、SchemaVersion、BuildRequest、CreatedAt、UpdatedAt），再把仓储端口补为 Get/List/Save/Delete，并明确同名冲突策略。

### P2-2：BuildRequest 是无约束 record，允许生成违反原始边界或资源限制的请求

**证据**

- 原始要求目标数 1..24、结果最多 10、游戏槽位为 12：`docs/original_requirements.md:12,14,16`。
- `BuildRequest` 暴露任意 `OrderedTargets`、`MandatoryPrefixLength`、`MaxSlots`、`ResultLimit`，没有验证：`src/GBFRTool.Domain/Builds/BuildRequest.cs:5-12`。
- `AnalyzeBuildUseCase` 不验证，直接调用 solver：`src/GBFRTool.Application/UseCases/AnalyzeBuildUseCase.cs:12-30`。

**影响**

空目标、25 个目标、负必出、13+ 槽、超大 ResultLimit、目标与屏蔽重叠均可穿过 Application 边界。即使 UI 做校验，字符串导入、测试或未来调用方仍可绕过，造成语义错误或求解资源滥用。

**建议修正**

增加集中、可测试的请求规范化/验证器或受控 factory；默认硬边界为目标 1..24、必出 0..目标数、maxSlots 1..12、resultLimit 1..10，并按最终产品决定是否完全固定 12/10。目标与屏蔽冲突应在 Application/Domain 再验证一次，不能只依赖 UI。

### P2-3：Worker 的配套发布、定位与完整性尚未进入架构合同

**证据**

- Runtime 依赖 App 启动独立 Worker：`docs/architecture/software-architecture.md:94-123`。
- App 只引用 Client/Solver/Persistence，不引用或复制 Worker 输出：`src/GBFRTool.App/GBFRTool.App.csproj:9-15`。
- Client 项目也只引用 Application/Contracts/Domain：`src/GBFRTool.Infrastructure.SaveReader.Client/GBFRTool.Infrastructure.SaveReader.Client.csproj:6-10`。
- 发布方案只笼统写 self-contained zip：`docs/GBFR_factor_build_tool_research_and_implementation_plan.md:435-448,649-656`。

**影响**

单独 `dotnet publish` App 不会自然保证携带协议匹配的 Worker。若运行时从不受控路径寻找同名 EXE，还会形成版本漂移或本地替换风险。

**建议修正**

定义统一 publish orchestration：固定把 Worker 发布到应用私有子目录，生成版本/哈希 manifest，Client 只从该目录解析并在握手前验证；安装/升级必须原子替换 App、Contracts 和 Worker。将该检查加入发行门槛。

### P2-4：架构守卫没有完全执行文档宣称的核心依赖策略

**证据**

- 架构目标称 Application 只依赖 Domain，Domain/Contracts 不依赖第三方包：`docs/architecture/software-architecture.md:7-10,69-77`。
- 守卫只检查 ProjectReference 白名单，并且 PackageReference 仅禁止 Domain/Contracts：`tests/GBFRTool.ArchitectureTests/Program.cs:66-83`。
- 守卫不会检测 Application 的任意第三方 PackageReference，也不检查项目引用缺失、重复职责或命名空间依赖。

**影响**

文档中的“Application 只依赖 Domain”若意指全部编译依赖，当前测试会漏报 Application 直接加入 OR-Tools/SQLite 等包。架构守卫的承诺范围大于实际覆盖范围。

**建议修正**

明确该规则是“仅项目引用”还是“全部依赖”。若是后者，给 Application 增加 PackageReference 禁止/允许清单，并在测试输出中区分项目依赖和包依赖。无需现在引入复杂架构测试框架。

### P2-5：IPC 缺少显式消息判别字段，协议演进容易依赖反序列化猜测

**证据**

- 协议约定 stdout 是多种 NDJSON 消息：Hello、成功响应、失败响应，见 `docs/architecture/save-reader-ipc.md:5-20,44-48`。
- `WorkerMessages.cs` 的 record 均无 `messageType`/envelope：`src/GBFRTool.Contracts/SaveReader/WorkerMessages.cs:3-46`。

**影响**

首条消息可以按时序当作 Hello，但随后成功/失败只能通过字段形状或尝试反序列化区分；新增可选字段时容易出现歧义，也不利于清晰拒绝未知消息。

**建议修正**

增加统一 envelope：`messageType`、`protocolVersion`、`correlationId`、`payload`；限制消息长度并拒绝未知 type。该调整应在协议 v1 真实实现前完成。

### P3-1：错误模型把展示文本与稳定错误码绑在 Application 合同中

**证据**

- 架构称展示文本由主进程按错误码本地化：`docs/architecture/save-reader-ipc.md:44-48`。
- `ApplicationError` 强制包含 `Message`：`src/GBFRTool.Application/Common/ApplicationError.cs:3-6`；用例直接生成英文消息：`ImportInventoryUseCase.cs:30-33`、`AnalyzeBuildUseCase.cs:24-27`。

**影响**

若 UI 直接展示 Message，会绕过本地化并可能把 adapter 的敏感异常文本带到界面/日志。当前仅是骨架，风险较低。

**建议修正**

把面向用户的文本由 UI 按 code 本地化；ApplicationError 保留安全的 developer detail 和结构化 metadata，明确其不得含完整路径、身份信息或原始异常文本。

### P3-2：SkillId 只有非空校验，稳定 ID 的规范化规则未固化

**证据**

- 分享、持久化和 catalog 升级依赖稳定 Skill ID：`docs/GBFR_factor_build_tool_research_and_implementation_plan.md:388-406,545-547`。
- `SkillId` 只拒绝空白，未限制大小写、长度、字符集或首尾空格：`src/GBFRTool.Domain/Skills/SkillId.cs:3-13`。

**影响**

`SKILL_A`、`skill_a`、` SKILL_A ` 可成为不同键，可能破坏屏蔽集合、分享串和数据库唯一性。

**建议修正**

在 Catalog 方案确定后冻结稳定 ID grammar 和 StringComparer；在构造时规范化或拒绝非 canonical 输入，并加入 round-trip/golden tests。

## 不应误报为缺陷的架构阶段事项

- `Infrastructure.*` 仅含 `AssemblyMarker`：`README.md:3,23` 明确当前是架构骨架，真实 adapter 分别属于 Phase A/B/C。
- Worker 目前只支持 `--self-test`：`src/GBFRTool.SaveReader.Worker/Program.cs:8-23` 与 README 明确一致。
- WPF 只有占位主窗体：24 个下拉、库存页、结果页被明确安排在 Phase C；现在缺失属于“尚未进入实现”。
- SQLite、OR-Tools、GBFRDataTools 还没有 PackageReference：当前阶段刻意保持可编译、低依赖骨架，不构成“技术选型没有落实”的缺陷。
- 架构测试暂时是控制台守卫而非 xUnit：`docs/architecture/testing-strategy.md:45-53` 已明确后续引入正式测试框架。

## 建议的方案修订清单

1. 新增一份可签字、带版本号的排序规格/ADR，逐项冻结：覆盖数、屏蔽口径、屏蔽与目标位置先后、槽位、等级字段、seed tie-break。
2. 在排序未确认前，撤销基于“少用槽位优先”的预过滤结论；保留它作为可选提案及独立测试反例。
3. 重写 `7.4` 的 Top-K 说明，给出 CP-SAT 可表达的种子化最终总序、逐级优化流程和 no-good cut 的精确定义。
4. 明确结果等价关系：实例方案、等级签名方案、仅技能展示方案三者如何去重；Top-10 以哪一层为单位。
5. 为 Catalog 增加明确项目/端口或把 raw hash 完整留在 IPC，保证 raw hash、resolution status、catalog version 端到端可追溯。
6. 给库存快照增加 typed completeness/diagnostic 模型；未知项不再只存在于字符串日志。
7. 用 `BuildAnalysis` 信封替代裸 `BuildResult[]`，携带 snapshot/request/comparator/seed/solver status。
8. 给 `BuildRequest` 增加集中验证与规范化；固定或限制 24 目标、12 槽、10 结果和目标/屏蔽冲突。
9. 新增 `BuildProfile` 聚合并完善仓储操作，再实现 SQLite schema，避免 Phase C 破坏性返工。
10. 给分享格式明确边界归属、CRC 的用途（仅检错，不是安全认证）、输入大小和未来版本策略。
11. 在 IPC v1 实现前加入消息 envelope/discriminator，并定义 Worker 私有发布目录、版本和哈希 manifest。
12. 扩充架构守卫，使其实际约束与文档一致；保留当前轻量实现即可。
13. 在 Phase A 继续执行研究方案的十项只读闸门，不因本报告的求解器问题延误存档字段验证。

## 进入下一阶段前的阻断项

### 进入 Phase A（真实存档 PoC）前

- **阻断**：确定 Catalog 映射发生在 Worker 还是 Client，并保证 IPC 不丢原始主副 trait hash。
- **阻断**：定义 typed partial/unknown 结果，避免 PoC 只能输出自由文本、无法判定十项闸门。
- **阻断**：明确 Worker 与测试快照的严格只读打开、hash 复核和敏感诊断边界；现有文档已基本覆盖，实现时必须按此验收。

### 进入 Phase B（求解内核）前

- **阻断**：正式确认并版本化完整排序比较器，尤其少槽优先、屏蔽层级和等级字段。
- **阻断**：给出可由 CP-SAT 严格实现的 seeded tie-break 与 Top-K 算法；在 oracle 中验证完整顺序。
- **阻断**：定义结果去重单位和 canonical signature，不能等求解器写完后再决定。
- **阻断**：建立 BuildRequest 不变量和输入限制。
- **阻断**：用分析结果信封承载 snapshot ID、request hash、comparator version、run seed 和 solver status。

### 进入 Phase C（Windows MVP）前

- **阻断**：完善 Build Profile 聚合/仓储合同和同名策略。
- **阻断**：确定分享字符串是否包含必出、屏蔽和 `maxSlots`，并冻结 schema v1。
- **阻断**：定义 App + Worker 的统一发布、定位、版本/完整性校验和原子升级流程。

修复以上阻断项后，当前端口与适配器方向可以保留，无需推倒重来。核心工作是把尚属“建议”的产品语义从已接受的架构约束中剥离出来，并让 Catalog、未知项和重放元数据真正贯穿合同。

---

## 增量审阅：基础属性主词条目标（2026-07-22）

> 本节审阅用户随后确认的新规则：目标区由 `24-X` 个普通目标和 `X` 个基础属性主词条目标组成；普通目标全部必选，是唯一的用户偏好硬约束；基础属性目标是第二优先级软目标；启用替代时只能使用一个可多选、有序的替代池，替代池按勾选先后紧凑重排；精确匹配优先于替代，替代必须明确标注；基础属性目标内部按替代池顺序比较。
> 本节是时序上的增量结论。`findings.md:80-84` 已确认少槽、屏蔽计数/层级、`sigilLevel` 和方案等价规则，因此本报告前文对这些项目的“待确认”结论应视为历史审阅状态；但它们仍需正式写回版本化规格。`findings.md:88-93` 的早期“任意 Basic Stats 主词条数量”描述已不足以表达本次确认的精确目标与有序替代语义，应由本节规则取代。

### 增量执行摘要

新规则的产品意图清楚：普通目标从“可部分满足”改为全部必出，基础属性主词条偏好承担普通目标之后的最高软排序层；基础属性目标不应使原本满足普通目标的方案被硬过滤；用户还需要知道某个目标是精确命中还是由哪个替代技能命中。

当前领域模型和方案无法直接承载该规则。`BuildRequest` 只有同质的 `OrderedTargets + MandatoryPrefixLength + BlockedSkillIds`（`src/GBFRTool.Domain/Builds/BuildRequest.cs:5-12`），不能表达两种目标、仅主词条匹配、每个基础目标的精确技能、是否允许替代，以及一个有序替代池。`BuildResult` 只有布尔覆盖向量和聚合计数（`src/GBFRTool.Domain/Builds/BuildResult.cs:3-11`），不能解释精确/替代/未命中及替代池排名。

在进入求解实现前还有两个会改变结果的阻断歧义：

1. 一个主词条实例能否同时满足一个普通目标和一个基础属性目标。若 `24-X + X` 表示 24 个词条位置的划分，则必须禁止双计数；若基础属性目标只是“所选因子的附加属性”，则可以双计数。两种解释会产生不同可行集。
2. “精确优先于替代”是先最大化精确数，还是先最大化基础属性总完成数、同完成数再最大化精确数。例如“1 个精确、总计 1 个命中”和“0 个精确、总计 3 个替代命中”谁优先，当前文字不能唯一决定。

除这两个决策外，建议把基础属性内部质量定义为可解释的匹配向量，并用容量匹配而非逐目标贪心。典型反例是基础目标 `[A,B]`、替代池 `[B]`、库存只有一个主词条 B：B 应优先精确满足目标 B，不能先被目标 A 当作替代消耗。

### 已确认规则的形式化拆分

#### 普通目标

- 普通目标数量为 `24-X`，每一项是稳定 `SkillId`，允许重复。
- 每个普通目标出现都必须由库存中一个技能出现满足；重复 N 次需要 N 份容量。
- 普通目标全部满足是唯一的**用户偏好硬约束**；任意一项缺失时不输出方案。
- “唯一硬约束”不应取消物理/安全不变量：库存实例不可重复使用、最多 12 个因子、角色限制和数据有效性仍是模型约束，而不是可被软化的偏好。
- 因普通目标全部满足，其旧有“满足普通目标条数”和普通目标覆盖向量在可行方案之间恒定，不再构成排序键。

#### 基础属性主词条目标

- 基础属性目标数量为 `X`，是软目标；未命中或只命中一部分时仍输出方案，并显示缺口。
- 每个基础属性目标需要表达一个期望的精确 `SkillId`，且只检查所选因子的**主词条**；同名副词条不能算作基础属性主词条命中。
- 精确技能及替代池成员都应由版本化 Catalog 证明 `category == BasicStats` 且 `canPrimary == true`；UI 不得按中文名或位置推断。
- 每件所选因子只有一个主词条，因此在基础目标内部最多提供一份主词条容量；同一主词条实例不能满足两个基础属性目标。
- 若基础目标允许重复，重复 N 次需要 N 个可分配的主词条实例。

#### 替代池

- 替代池是有序列表，不是 set；顺序由用户勾选先后决定。
- 取消勾选后，后续元素的排名立即紧凑前移；重新勾选的元素追加到当前列表末尾。
- 搜索、过滤、Catalog 显示排序和界面重绘不得改变已勾选顺序。
- 替代池顺序必须进入保存方案、分享字符串、request hash 和诊断包，否则同一表面请求可能得到不同排序。
- 替代只能来自池内值；未列入池的 Basic Stats 技能即使类别合格，也不能替代。
- 精确命中不是替代命中，不受该技能在替代池中的位置影响。
- 结果必须逐项标记 `Exact`、`Substitute(poolRank, actualSkillId)` 或 `Unmatched`，不能只显示一个总数。

### 必须补充确认的语义

#### A. 24 是固定目标数还是界面上限

新表述使用 `24-X + X`，字面上表示每个请求始终有 24 个目标。原始要求则是“最多选择 24 个，最少一个”，允许空下拉位：`docs/original_requirements.md:16`；研究方案也允许 24 个槽中存在空位：`docs/GBFR_factor_build_tool_research_and_implementation_plan.md:378-383`。

需要明确以下哪一种取代旧规则：

- 固定 24 项：用户必须配置全部 `24-X` 普通目标；或
- 总目标数 `N <= 24`：应写成 `N-X` 普通目标 + `X` 基础目标。

该决策影响 UI 可用性、请求验证和最小可行槽位数，不能只在界面层猜测。

#### B. X 的范围

基础属性目标只能由所选因子的主词条提供，而最多选 12 件因子。因此若每个基础目标需要独立主词条容量，合理边界是 `0 <= X <= 12`，同时还需满足 `X <= N <= 24`。允许 `X > 12` 会创建永远无法完全达到的软目标；虽然仍可求解，但会误导用户。

建议 UI 和 Domain 均限制 `X <= MaxSlots`。若产品刻意允许设置不可完全达到的软目标，必须展示“理论上限 12”而不是把它当普通缺口。

#### C. 普通目标与基础目标是否共享同一技能容量

需要用一个最小样例签字：普通目标含 B，基础目标 A 允许用 B 替代，库存只有一件 `B&X` 且 B 为主词条。这一个 B 能否同时满足普通 B 和基础 A？

- **不允许双计数**：符合“24 个目标位置被两类目标划分”的解释；该 B 只能分配给一个目标，需要统一的 token-to-target 容量匹配。
- **允许双计数**：符合“基础主词条只是所选方案的附加配额”的解释；普通覆盖和基础偏好使用两套容量统计。

推荐不允许双计数，因为 `24-X + X` 更像对 24 个技能位置的明确分区，也能避免一个词条同时完成两个目标导致完成度虚高。但这是会改变可行集的产品决策，必须由用户确认，不能只凭推荐实施。

#### D. 基础属性内部排序键

“基础属性目标是第二优先级”“精确匹配优先于替代”“替代参考池顺序”仍不足以唯一决定聚合比较器。至少有两种合理定义：

1. **质量优先**：`ExactCount DESC → PoolRank1Count DESC → PoolRank2Count DESC → ... → UnmatchedCount ASC`。一个精确命中可压过多个替代命中。
2. **完成数优先**：`BasicMatchedCount DESC → ExactCount DESC → PoolRank1Count DESC → ...`。更多替代完成可压过更少的精确完成。

必须用“1 精确/1 总命中 vs 0 精确/3 总命中”确认。若用户强调“精确匹配优先于替代”的绝对层级，采用定义 1；若“基础属性目标尽量多完成”更重要，采用定义 2。

还需决定 X 个基础目标本身是否有顺序：

- 若基础目标有序，则先比较目标 1 的 `Exact > Pool1 > Pool2 > ... > Unmatched`，再比较目标 2；
- 若基础目标无序，则应比较上述质量直方图，并由匹配算法选择全局最优分配。

仅说“参考替代池顺序”不能替代这项定义。

#### E. 替代池是全局还是逐目标

当前措辞更像一个请求级全局池，但需写明：

- 所有基础目标共享同一 ordered pool，还是每个基础目标有自己的池；
- 替代开关是全局还是逐目标；
- 池中的一个技能种类可以替代多个目标，但每次仍需不同库存实例容量；
- 精确目标技能能否同时出现在替代池，基础目标之间的精确技能能否互为替代。

推荐首版使用一个请求级全局池和一个全局“允许替代”开关；池内 SkillId 唯一；精确目标技能不重复显示在池中。若允许精确技能互相替代，必须通过全局匹配保证精确边优先。

### 对领域模型的影响

现有 `MandatoryPrefixLength` 可以勉强把前 `24-X` 个普通目标标成必出，但会把基础属性目标错误地继续表示为普通 `SkillId`，也无法表达“只匹配主词条”和替代质量。建议不要在旧 `OrderedTargets` 上叠加并行数组或特殊 SkillId 哨兵。

建议的请求形状：

```text
BuildRequest
  requiredTargets: OrderedMultiset<SkillId>       // 普通目标，全部硬约束
  basicPrimaryPreferences: list<BasicPrimaryTarget>
  substitution:
    enabled: bool
    orderedPool: list<SkillId>                    // 唯一、有序
  blockedSkillIds: set<SkillId>
  maxSlots: 1..12
  resultLimit: 1..10
  characterId?
  runSeed

BasicPrimaryTarget
  targetId / position
  exactSkillId
```

若基础目标本身确认无序，`position` 只用于 UI/解释，不参与排序；若有序，它必须进入 request hash 和 comparator。

建议的结果形状：

```text
BasicPrimaryMatch
  targetId / position
  status: Exact | Substitute | Unmatched
  requestedSkillId
  actualSkillId?
  substitutePoolRank?
  sourceInstanceId?

BuildResult
  ...
  basicPrimaryMatches: list<BasicPrimaryMatch>
  basicExactCount
  basicMatchedCount
  substituteRankHistogram
  basicMissingCount
```

不要只新增 `BasicStatsPrimaryCount`：它无法区分期望 A 得到 A、期望 A 得到池首 B、期望 A 得到池末 C，也无法生成用户要求的替代标记。

Catalog 至少需要为每个 Skill 提供稳定 ID、category、`canPrimary`、版本和未知状态。该需求进一步提高了前文 P1-2（Catalog 边界缺位）的优先级。

### 对求解与排序键的影响

在不考虑待确认分支时，比较器外层应改为：

1. 普通目标全部满足，否则候选不可行。
2. 比较已冻结的基础属性匹配质量向量。
3. 屏蔽出现次数更少。
4. 使用槽位更少。
5. `sigilLevel` 总和更高。
6. 按已冻结的 seeded deterministic tie-break。

旧比较器中的“普通目标满足总条数”和“普通目标位置覆盖向量”不应继续参与可行方案排序，因为普通目标现在全是硬约束，所有可行方案对应值完全相同。保留这些无效层级会增加解释噪声，也容易让开发者误以为普通目标仍可部分满足。

若禁止普通/基础双计数，推荐把每件已选因子的两个技能建模为独立 token，其中 primary token 标记 `IsPrimary=true`。建立目标分配变量：

```text
ordinaryAssign[token, ordinaryTarget]
basicExactAssign[primaryToken, basicTarget]
basicSubstituteAssign[primaryToken, basicTarget, poolRank]
```

并强制每个 token 总分配量 `<= 1`、每个普通目标 `== 1`、每个基础目标 `<= 1`。若允许双计数，则普通分配和基础分配使用两套容量，但基础内部仍需每个 primary token `<= 1`。

不能用“按基础目标顺序逐个找第一个可用技能”的贪心算法。目标、精确边和共享替代池会形成竞争，必须使用最大权匹配/流或直接纳入 CP-SAT。求解器的目标权重必须严格实现已确认的质量向量，不能用未经证明的经验分数。

### 对 UI、保存和分享的影响

- 目标编辑器应明确区分“普通目标（必出）”和“基础属性主词条目标（软）”，不要只用颜色区分。
- X 改变时要明确哪些目标位转换类型；若减少 X，基础目标如何回到普通目标，是否保留原选值，需要确定、可撤销的规则。
- 每个基础目标显示精确期望 Skill；替代开关关闭时隐藏或禁用替代池但不应悄悄清空用户选择。
- 替代池组件必须同时显示勾选序号。搜索结果的字典顺序与“已选顺序”分开展示。
- 取消池中第 2 项时，第 3、4 项应变成第 2、3 项；重新勾选原第 2 项时应追加到末尾。拖拽重排是否支持需明确；若不支持，用户只能通过取消/重选改变优先级。
- 若 exact skill 已在 pool 中、pool 出现重复、技能非 Basic Stats、`canPrimary=false` 或 Catalog 未知，UI 应阻止保存并解释。
- 结果中每个基础目标显示“精确”“替代：技能名（池序 #N）”或“未满足”，并关联到具体因子主词条；不得把副词条涂成命中。
- Build Profile、分享 payload、request hash、诊断包都需新增基础目标列表、替代 enabled 和 ordered pool；schema 版本必须提升，旧方案加载时不得臆造 X。

### 重复技能与容量匹配边界

以下规则需要写入规格而非只留给求解器实现：

- 普通目标 `[A,A]` 需要两个 A token；一件 `A&A` 可提供两个，但一件 `A&B` 只提供一个。
- 基础目标 `[A,A]` 需要两件主词条 A 的因子才能双精确；同一因子的副词条 A 不增加基础容量。
- 基础目标 `[A,B]`、池 `[B]`、只有一个主 B 时，应把 B 留给精确目标 B，而不是先替代 A。
- 池中一个技能种类可被多次使用，但必须有同等数量的不同 primary token；“池可多选”描述候选种类，不代表无限库存。
- 一个主词条的技能同时出现在多个替代边上时，只能分配一次。
- 物理内容相同的两个因子仍提供两份独立容量；方案身份仍按 `findings.md:84` 的有序技能组合 multiset 去重，实例回填选择等级评分最高组合。
- 未知 category 或 unknown primary skill 不能被静默当作 Basic Stats 替代；快照 partial 时结果需降低可信度或阻止完整声明。

### 增量测试矩阵

| 场景 | 期望 |
|---|---|
| 任一普通目标缺失 | 无方案；不以基础属性高分补偿普通硬约束 |
| 普通目标全部满足、基础目标 0/X | 仍输出，并逐项显示 X 个缺口 |
| 精确 A 与副词条 A | 只有主词条 A 能产生 Exact |
| 基础目标 `[A,A]`，仅一件主 A | 最多命中一个，另一项 Unmatched |
| 基础目标 `[A,B]`，池 `[B]`，仅一件主 B | B 分给目标 B 做 Exact；不得贪心替代 A |
| 基础目标 A，池 `[B,C]` | 主 B 的替代质量高于主 C |
| 池 `[B,C]` 改为 `[C,B]` | 可行集不变；基础内部排序按新池序改变 |
| 取消 B 后重选 | 池从 `[B,C]` 变为 `[C,B]`，序号紧凑且 round-trip 保持 |
| 搜索/过滤/重开页面 | 已勾选池顺序不变 |
| 一个主 B 可替代两个基础目标 | 只能命中其中一个；两个主 B 才能命中两个 |
| 普通 B 与基础 A（池含 B）共享一个主 B | 按“双计数”最终决策得到唯一、固定结果 |
| `1 Exact/1 Matched` vs `0 Exact/3 Substitute` | 按基础质量最终决策得到唯一、固定顺序 |
| pool 含非 BasicStats、不可做主词条或 unknown skill | 请求校验失败，不进入 solver |
| X=0 | 行为退化为全部普通目标硬约束；无基础排序键 |
| X=MaxSlots | 最多每件因子贡献一个基础主词条匹配 |
| X>MaxSlots 或 X>N | 按冻结规则拒绝，或明确展示理论不可达；不得静默截断 |
| 保存/分享 round-trip | X、两类目标、替代开关、池顺序和重复目标完全保持 |
| 相同请求与 seed | 基础匹配分配、标注和最终 Top-10 完全可复现 |

### 增量审阅发现

#### P1-A：新规则尚无可表达的领域合同

`BuildRequest.cs:5-12` 把所有目标表示成同一种 `SkillId`，`BuildResult.cs:3-11` 只给布尔覆盖。它们不能表达基础目标只看主词条、精确技能、有序替代池和匹配类型。继续在 `MandatoryPrefixLength` 上打补丁会产生并行数组和哨兵值，降低正确性与可维护性。

**修正**：引入明确的 `RequiredTarget`、`BasicPrimaryTarget`、`SubstitutionPolicy` 和 `BasicPrimaryMatch`，替换同质目标合同；同步更新 profile/share/request hash/诊断 schema。

#### P1-B：普通目标与基础目标是否共享容量未定义

`24-X + X` 暗示目标位置分区，而早期 `findings.md:88-93` 把基础条件描述成所选因子的附加 quota。两种模型对同一个主词条能否双计数给出相反结果。

**修正**：用“普通 B + 基础 A/替代 B + 仅一个主 B”样例确认。推荐禁止双计数，并采用统一 token 容量匹配。

#### P1-C：基础软目标的全序仍不完整

“第二优先级、精确优于替代、池顺序”没有说明总完成数和精确数谁先，也没有说明基础目标本身是否有序。没有完整全序就无法声称前 10 正确，也无法构造稳定排序解释。

**修正**：在排序 ADR 中选择“质量优先”或“完成数优先”，明确按目标向量还是质量直方图比较，并用冲突样例签字。

#### P1-D：共享替代池要求全局容量匹配，不能逐项贪心

目标 `[A,B]`、池 `[B]`、单一主 B 会让朴素顺序贪心得到 A=替代、B=未命中，违反精确优先。重复目标和池共享进一步放大该问题。

**修正**：使用最大权二分匹配/流或 CP-SAT assignment variables；目标权重严格对应冻结的基础质量向量，并由穷举 oracle 验证。

#### P2-A：替代池不能复用 set 型建模

现有 `BlockedSkillIds` 合理使用 set，但替代池顺序直接参与排名，必须是 ordered list。取消/重选、保存、分享、hash 和页面重建都可能意外按 Catalog 名称重排。

**修正**：以不可变 ordered unique list 建模；把勾选时间顺序作为唯一来源，所有 round-trip 测试验证顺序。

#### P2-B：X 与固定 24 的关系仍与原始“1..24”目标数冲突

原始需求和研究 UI 允许少于 24 个目标，新规则字面要求 `24-X + X == 24`。若不澄清，UI、导入格式和请求验证会出现不同解释。

**修正**：确认固定 24，或统一改写为 `N-X + X`、`1 <= N <= 24`；基础主词条容量同时要求 `X <= MaxSlots`。

#### P2-C：Catalog 需要同时保证类别与主词条资格

仅知道 SkillId/中文名不足以构造替代池。基础属性目标和池成员必须由版本化数据证明 Basic Stats 且可做主词条；unknown skill 的处理也必须结构化。

**修正**：把 `category`、`canPrimary`、catalog version 和 resolution status 加入前文 Catalog 边界与验证测试。该问题不是 UI 下拉过滤细节，而是领域有效性约束。

#### P2-D：旧排序字段应从新可行方案比较中移除或明确恒等

普通目标现在全部硬满足，旧的 `MatchedTargetCount` 和 `CoverageByTargetPosition` 在可行方案间恒等。若仍把它们放进解释和 comparator，容易制造“普通目标仍可部分满足”的错误印象。

**修正**：新 comparator version 明确删除这两级；BuildResult 可保留普通目标到实例的解释映射，但不再把普通覆盖数作为软排名分数。

### 增量方案修订与阻断项

在 Phase B 前新增以下阻断项：

1. 确认目标总数是固定 24 还是 `N <= 24`，并冻结 `X <= min(N, MaxSlots)`。
2. 确认普通目标与基础目标是否共享技能 token 容量；推荐禁止双计数。
3. 确认基础质量全序：总命中数与精确命中数的先后、基础目标是否有序。
4. 确认替代池是请求级全局池、替代开关作用域、池内唯一性及 exact skill 与 pool 重叠规则。
5. 用两类目标和 typed match 重构 BuildRequest/BuildResult，不以 `MandatoryPrefixLength` 或特殊 SkillId 兼容新语义。
6. 把基础匹配作为 assignment 问题纳入 CP-SAT/oracle，覆盖精确边保护、重复目标、共享替代和容量竞争。
7. 升级 Build Profile、分享字符串、request hash、诊断包和 comparator version；旧 schema 不得静默迁移为 X>0。
8. UI 实现 ordered pool 的紧凑重排和显式序号，并让结果逐项标记 Exact/Substitute/Unmatched。

完成上述确认后，推荐的稳定外层排序为：**普通目标全部满足（硬约束）→ 已冻结的基础属性匹配质量 → 屏蔽出现次数 → 使用槽位数 → `sigilLevel` 总和 → seeded deterministic tie-break**。这个顺序保留用户已确认的既有排序决定，同时让新基础属性偏好处于唯一硬约束之后的最高软优先级。

---

## 增量审阅：Forbidden / SoftBlocked 双层屏蔽（2026-07-22）

> 本节审阅随后确认的双层屏蔽规则：`Forbidden` 中任一技能在所选因子的主词条或副词条出现即硬淘汰；`SoftBlocked` 不影响可行性，按实际出现次数维持原排序；普通目标、基础属性目标、有序替代池、Forbidden、SoftBlocked 五域互斥；两个屏蔽池自身无序；UI 使用两个独立的、完全跟随游戏筛选分类的多选面板，被其他域占用的技能保留在原分类位置、置灰并显示具体原因。
> 本节以当前新增的 `GBFR-RANK-2`、ADR-0007、屏蔽池 UI 文档及领域骨架为证据，不把求解器/UI adapter 尚未实现本身列为缺陷。

### 增量执行摘要

双层屏蔽的求解语义总体正确，比较器外层已经闭合：Forbidden 是候选可行性条件，不是一个可比较分数；任何命中都必须在进入 Top-K 前淘汰。SoftBlocked 保持“先比较普通目标完成情况、同等覆盖时出现次数更少者优先”，`X&X` 计 2 次。`GBFR-RANK-2` 再以槽位、`sigilLevel`、seeded linear key 和 canonical signature 收尾，能够形成逻辑方案的总序。证据见 `docs/architecture/ranking-specification.md:54-78,80-90` 和 `docs/architecture/adr/0007-hard-and-soft-skill-blocks.md:10-26`。

当前的主要缺口不在“硬屏蔽应排第几”，而在请求编辑与演进边界：

1. 五域互斥仅写成文档不变量，现有 `BuildRequest`/`SkillBlockPolicy` 都是无验证 record；尚无唯一的规范化请求类型、冲突错误结构或 canonical serializer。
2. “关闭主词条优先/关闭替代时保留替代池草稿”与“五域始终互斥、其他控件置灰”组合后可能产生不可达状态：草稿占用技能，但用户无法操作已禁用的池来释放它。
3. 旧配置冲突修复页若把冲突双方都按“被另一域占用”禁用，用户也无法保留任一侧；所有者控件和无效旧值必须始终允许删除。
4. UI 分类声称完全由 Catalog/游戏筛选器驱动，但领域仍用封闭 `SkillCategory` enum 表示分类；游戏新增、拆分或重排筛选类别时不能只更新 Catalog。
5. 同一逻辑方案可能存在多个同分目标分配见证。比较器对方案有总序，但输出的“哪个基础目标被替代/缺失”尚缺确定性见证规则，可能随求解搜索顺序变化。

### 已确认的双层屏蔽规格

#### Forbidden：硬约束

- `ForbiddenSkillIds` 是无序、无重复的 Skill ID 集合。
- 任一候选因子的主词条或副词条命中 Forbidden，该因子不可用于任何方案；命中一次和命中两次都不是“更差”，而是同样不可行。
- Forbidden 与必选普通目标共同构成可行性层。二者没有排序先后；只有同时满足“必选覆盖充足、Forbidden 命中为零”的候选才能进入软目标比较。
- 因此可在建模前删除所有命中 Forbidden 的实例；但缺口诊断必须能够说明“原库存有目标技能，但所有可用载体均因 Forbidden 被排除”，不能误报成原库存完全不存在。
- Forbidden 技能绝不能出现在结果卡的已选因子中；全不可行时只在空结果诊断中说明其影响。

#### SoftBlocked：排序惩罚

- `SoftBlockedSkillIds` 是另一个无序、无重复集合，与 Forbidden 不重叠。
- SoftBlocked 不删除实例，也不能导致无方案。
- 计数对象是最终所选因子的全部实际主、副词条，不限于被分配去满足目标的 token；未参与目标匹配的额外词条仍计入。
- 按出现次数计数：一件 `X&X` 且 X 在 SoftBlocked 中时贡献 2；两件分别含 X 同样贡献 2。
- 在 `GBFR-RANK-2` 中，普通可选目标满足总数高于 SoftBlocked 惩罚；同满足数时，SoftBlocked 次数越少越优先，之后才比较普通目标位置覆盖向量。证据为 `docs/architecture/ranking-specification.md:70-78`。

#### 五域互斥

对每一个规范化 Skill ID，以下五个域至多占用一个：

1. 普通目标域；
2. 基础属性主词条目标域；
3. 有序替代池；
4. Forbidden；
5. SoftBlocked。

普通目标域内部允许同一 Skill ID 重复，基础属性目标是否重复已由 `GBFR-RANK-2` 允许；两个屏蔽集合内部和彼此之间不允许重复。互斥判断按“不同域的 distinct Skill ID 交集为空”进行，不能把普通目标的第二次 A 误判为跨域冲突。

#### 屏蔽池无序性的规范化结果

- UI 点击顺序不进入业务语义。
- Profile/分享 payload/诊断中的两个集合应按 canonical Skill ID comparer 排序后序列化。
- request hash 只能基于规范化序列；`{A,B}` 与 `{B,A}` 必须产生同一 hash、缓存键和 Top-10。
- 规范化只能重排无序集合，不能重排普通目标、基础目标或替代池；后三者的顺序仍有业务意义。

### 比较器全序核查

`GBFR-RANK-2` 的正确外层语义应写成“先筛选、后排序”，而不是把 Forbidden 当成可优化数值：

```text
Feasible(solution) :=
  mandatory normal multiset fully covered
  AND every selected primary/secondary skill NOT IN Forbidden

Rank(feasible solution) :=
  basic filled count DESC
  -> basic exact coverage vector DESC
  -> substitution-pool usage vector DESC
  -> optional normal matched count DESC
  -> SoftBlocked occurrence count ASC
  -> optional normal coverage vector DESC
  -> used slots ASC
  -> sigilLevel sum DESC
  -> seeded linear key
  -> canonical signature ASC
```

当前 `ranking-specification.md:64-78` 与该结构一致。尤其正确之处包括：

- Forbidden 不会被更多基础/普通目标抵消；
- SoftBlocked 不会压过多满足一个普通目标的方案；
- `canonical signature` 是最后稳定兜底，解决 seeded coefficient 碰撞；
- 两个屏蔽集合的点击顺序不进入比较器。

仍需补齐的是**同一逻辑方案的最佳且确定的匹配见证**。方案身份只看有序词条对数量：`ranking-specification.md:80-90`。例如基础目标 `[A,B]`、替代池 `[C]`、逻辑方案只有一个主 C 时，把 C 替代 A 或替代 B 可能产生相同的已填充数、精确向量和替代使用向量，但结果中的 Missing 位置不同。若没有见证兜底，`PrimaryTargetMatches` 可能随 CP-SAT 搜索顺序变化，违反 `testing-strategy.md:17` 的完全确定性目标。

建议区分：

- **方案排序键**：保持现有 11 层，不因纯解释差异制造两个逻辑方案；
- **匹配见证 canonicalization**：在方案排序完成后，对同分 assignment 选择固定见证，例如“优先填充较早基础目标 → 按逻辑因子类型 signature → 最后按实例稳定 ID”，仅用于稳定解释与实例定位。

### 请求规范化和验证边界

当前代码已经分出双集合：`src/GBFRTool.Domain/Builds/SkillBlockPolicy.cs:5-7`，但 `BuildRequest` 和相关 policy 仍是公开 record，任何调用方都可构造跨域冲突或顺序不规范的集合：`src/GBFRTool.Domain/Builds/BuildRequest.cs:5-14`、`BasicPrimaryTargetPolicy.cs:5-11`。`AnalyzeBuildUseCase` 也尚未加载 Catalog 或调用集中验证器，直接把原始请求交给 solver：`src/GBFRTool.Application/UseCases/AnalyzeBuildUseCase.cs:7-30`。

建议建立单一 `NormalizeAndValidateBuildRequest` Application 服务，输出不可变 `NormalizedBuildRequest`，步骤顺序固定为：

1. 以请求中的 `CatalogVersion` 加载准确 Catalog；版本缺失或不可用时失败，不回退当前版本。
2. 规范化每个 Skill ID 的字符形式，并验证存在性。
3. 验证基础目标/替代池的 `BasicStats && CanBePrimary`。
4. 保留普通目标、基础目标、替代池的原顺序；验证替代池内部唯一。
5. 将 Forbidden/SoftBlocked 转成使用明确 comparer 的 immutable set。
6. 对五域的 distinct ID 做 10 组两两交集检查，返回全部冲突，而不是只报第一个。
7. 按 canonical Skill ID 顺序生成两个屏蔽数组，仅用于持久化、分享、诊断和 request hash。
8. 明确处理关闭开关时的 inactive draft 字段，再生成 canonical payload。
9. 将 comparator version 与 config schema version 分别记录；二者不能混作一个版本号。

规范化结果应满足幂等性：`Normalize(Normalize(x)) == Normalize(x)`；对两个屏蔽池的任意插入排列结果相同；对替代池的不同排列结果不同。

建议使用 typed validation issue，而非自由文本，例如：

```text
CrossDomainSkillConflict
  skillId
  occupancies[]:
    domain
    positions[]?
    substitutionRank?

CatalogSkillUnavailable
InvalidBlockPoolMember
InactiveDraftReservationConflict
```

这使 UI 能准确显示“已在普通目标第 3、7 项选择”，也使旧配置修复页复用同一规则。

### 禁用状态与可达性核查

`block-pool-ui.md:30-49` 正确要求中央冲突规则服务、原位可见和具体原因，但“不可选”必须区分**不能新增**与**不能移除**：

- 技能在 Forbidden 中已选时，Forbidden 自己的卡片必须保持可操作，以便取消；它只在其他四域不可新增。
- 同理，SoftBlocked 的所有者卡片必须允许取消，“清空”必须始终可用。
- 普通目标重复使用 A 时，屏蔽面板显示 A 被普通目标多个位置占用；移除一个 A 后，只要仍有其他 A，禁用状态不能提前解除。
- 旧配置若 A 同时在 Forbidden 和 SoftBlocked，两个旧值都不能因彼此占用而一起禁用。修复模式应允许删除任一侧，或提供明确的“保留此处并从其他域移除”动作。

当前还有一个开关死锁风险：`ranking-specification.md:42` 和 `109-112` 规定关闭主词条优先/替代时，替代池保留但不参与求解，且控件禁用；五域互斥又可能让这些 inactive pool 值继续占用 Skill ID。若仍占用，用户无法在普通/屏蔽域选择这些技能，也无法直接从被禁用的池删除。

需要二选一冻结：

1. **inactive draft 不占用（推荐）**：关闭相关开关后，草稿保留但不进入规范化请求、互斥占用和 request hash；重开时重新验证冲突，冲突草稿进入修复态。
2. **inactive draft 继续占用**：池控件虽不参与求解，但必须仍允许删除/清空，且其他域明确显示“被未启用的替代池草稿占用”。

不能采用“继续占用 + 整个池 IsEnabled=false”的组合。

WPF 的直接 `IsEnabled=false` 还会使控件通常无法键盘聚焦，和 `block-pool-ui.md:34-39` 的“键盘聚焦时辅助技术读取原因”发生实现冲突。建议使用可聚焦的只读卡片/包装元素、`AutomationProperties.HelpText` 和 `ToolTipService.ShowOnDisabled=true`，或保持控件启用但让 command 返回解释；视觉置灰不等于从可访问性树移除。

### 旧配置迁移核查

ADR-0007 已给出最重要的安全默认：旧单一屏蔽列表全部迁移到 SoftBlocked，不得自动升级为 Forbidden：`docs/architecture/adr/0007-hard-and-soft-skill-blocks.md:21-27`。这能保持旧配置的宽松可行集，避免升级后突然无方案。

但仍需一份可测试的迁移矩阵：

| 旧值 | 新值 | 处理 |
|---|---|---|
| 旧 `blockedSkillIds=[A,B]` | `SoftBlocked={A,B}`, `Forbidden={}` | 自动、无损、记录 schema migration |
| 旧列表顺序 `[B,A]` | canonical SoftBlocked `[A,B]` | hash 与 `[A,B]` 一致 |
| 旧 blocked 与普通/基础/替代冲突 | 原值全部保留在 migration draft | 禁止保存/分析，显示全部占用位置，由用户选择 |
| 旧 Skill ID 在新 Catalog 缺失 | orphaned selection | 不静默删除；从修复摘要中移除/映射，不能进入普通面板 |
| 旧技能被重分类 | 保留 Skill ID，重新验证各域资格 | 基础/替代不再合法时要求修复 |
| 已是新 schema | 不重复迁移 | migration 幂等 |
| 旧分享串 | 先按旧 schema 解码，再迁移 | 不把解析失败当空集合 |

还需区分：

- **config schema version**：字段从单 blocked 拆为 Forbidden/SoftBlocked；
- **comparator version**：结果从 `GBFR-RANK-1` 进入 `GBFR-RANK-2`；
- **CatalogVersion**：分类和技能有效性。

加载旧 profile 可以自动生成新 schema 草稿，但旧缓存/历史结果不能仅改标签后宣称由 RANK-2 产生。重新分析时应显示“排序规则已升级”，生成新的 request hash 和结果记录。

### 分类数据边界核查

UI 文档正确规定分类 ID、游戏顺序和本地化名称来自 Catalog，面板不维护私有分类表：`docs/architecture/block-pool-ui.md:24-28`。两个屏蔽池应展示所有可能出现在主或副词条的可识别技能，而不是只展示 `CanBePrimary`；基础属性下拉/替代池才需要 `BasicStats && CanBePrimary`。

现有 Catalog 骨架仍有一处边界冲突：

- `SkillCategory` 是封闭 enum，硬编码 `BasicStats/Attack/Defense/Support/Special/CharacterSpecific`：`src/GBFRTool.Domain/Skills/SkillCategory.cs:3-12`。
- `SkillCategoryDefinition` 也以该 enum 为分类 ID：`src/GBFRTool.Domain/Skills/SkillDefinition.cs:18-21`。
- 文档却承诺游戏分类变化只更新 Catalog，并完全跟随游戏筛选器：`ranking-specification.md:14-16,48-52,113-115`、`block-pool-ui.md:24-28`。

如果游戏新增筛选类别、把角色专属拆分，或出现仅用于显示分组的类别，封闭 enum 需要发布代码才能识别，无法“只更新 Catalog”。建议分离：

```text
SkillDefinition.SemanticCategory   // 可保留已知 enum，供 BasicStats 业务判断
SkillDefinition.FilterCategoryId   // 开放、稳定的 Catalog 字符串/值对象
Catalog.OrderedFilterCategories    // ID、显示顺序、本地化名
```

Catalog 加载时验证：分类 ID 唯一、DisplayOrder 唯一或有明确次序兜底、每个可选择技能恰属一个可见游戏筛选分类、本地化缺失有稳定 fallback、技能引用的分类存在。Unknown 技能继续进入诊断，但旧配置中的 unknown/orphan 必须在修复区可见，不能因为不进普通面板而变得无法删除。

另外，`docs/architecture/software-architecture.md:148` 仍称唯一规范是 `GBFR-RANK-1`，与当前 `GBFR-RANK-2` 和 ADR-0007 冲突；应改为 RANK-2 或只链接“当前版本化排序规范”，避免下次升级再次出现陈旧编号。

### 增量测试遗漏清单

现有 `testing-strategy.md:15-27` 和 `ranking-specification.md:119-135` 已覆盖主/副 Forbidden、SoftBlocked 次数、五域互斥、池顺序无关和基础匹配。还应补充以下边界：

#### 求解/比较器

- Forbidden 在主词条、副词条、`X&X` 两侧命中均硬淘汰；命中数不参与排序。
- 高基础/普通完成度但含 Forbidden 的方案必须完全消失，不能以任何软分反超。
- 必选 A 只存在于 `A&Forbidden` 时，返回 hard infeasible，并区分“库存有 A，但载体均被 Forbidden 排除”。
- SoftBlocked 对未分配的额外词条仍计数；改变 token assignment 不改变同一逻辑方案的 SoftBlocked 次数。
- SoftBlocked `X&X=2`、两件各含 X=2、主副各一次=2。
- Forbidden/SoftBlocked 均为空时，RANK-2 与对应 RANK-1 业务键顺序回归一致。
- 同一逻辑方案存在多个同分基础 assignment 时，输出的 Missing/Substituted 位置和实例见证稳定。
- 预过滤 Forbidden 后的 CP-SAT Top-K 与“不预过滤、显式 x=0 约束”的穷举 oracle 完全一致。

#### 规范化/互斥

- 五域 10 组两两组合全部覆盖，并测试 A→B、B→A 两种编辑顺序。
- 普通域内部 `[A,A]` 合法；普通 `[A,A]` 与 SoftBlocked `{A}` 只报一项 Skill 冲突，但原因列出两个位置。
- 两个屏蔽池以所有排列构造时 canonical payload/hash 相同；替代池换序时 hash 必须不同。
- 规范化幂等；切换 UI 语言、区域排序规则或 Catalog 显示名不改变 hash。
- inactive 替代池按最终选择的“占用/不占用”规则测试 request hash 和可选状态。
- malformed API/share 请求跨域冲突必须在 Application 边界失败，不能只依赖 UI。

#### UI 可达性

- 已选项在所属域始终能取消，其他域只能查看原因、不能新增。
- `清空 Forbidden`、`清空 SoftBlocked` 释放的状态实时传播，不影响另一池。
- 普通目标重复 A 时，逐个删除直到最后一个才释放 A。
- 旧配置 A 同时占多个域时，用户能够从冲突态移除任一侧，不发生双方均 disabled。
- 关闭替代/主词条优先后，inactive pool 不会形成无法清除的占用。
- 搜索命中的禁用项仍显示；清空搜索后回到同一游戏分类位置。
- 鼠标、键盘和屏幕阅读器都能获取具体禁用原因；验证 WPF disabled tooltip/focus 的实际行为。
- Catalog 中 orphaned/unknown 的旧选项在修复区可见且可移除。

#### 迁移与 Catalog

- 旧单 blocked 精确迁移到 SoftBlocked，Forbidden 为空；迁移两次结果不变。
- 旧 profile、旧分享串、旧诊断/缓存分别按其 schema 处理，不能共用“字段不存在即空”的模糊逻辑。
- 迁移冲突不静默删值；用户修复后才生成新 schema 和 request hash。
- Catalog 重分类导致基础/替代失效时进入修复态；普通/屏蔽成员仍按新分类在正确面板位置显示。
- Catalog 分类新增、删除、重排、本地化缺失、重复 ID/顺序和技能引用不存在分类均有验证。

### 增量审阅发现（按严重度）

#### P1-E：inactive 替代池可能造成互斥占用死锁

`ranking-specification.md:42,109-112` 要求关闭主词条优先时禁用但保留替代池；`ranking-specification.md:50` 又要求五域互斥。若保留值继续占用，其他域无法选择；若池整体 disabled，用户也无法移除占用。

**修正**：推荐 inactive draft 不进入规范化请求和互斥占用；重启开关时再验证。若产品要求继续占用，必须保留删除/清空能力，不能整个控件禁用。

#### P1-F：旧冲突配置的双方置灰会使修复路径不可达

`block-pool-ui.md:49` 要求保留全部冲突值并等待用户选择，但若中央规则对每一方都返回“被另一域占用所以不可选”，两侧都无法操作。

**修正**：冲突态区分 `CanAdd=false` 与 `CanRemove=true`；所有者和 legacy invalid selection 始终可删除，并提供“保留此域、移除其他占用”的原子动作。

#### P1-G：封闭 SkillCategory 与“分类完全由游戏/Catalog 驱动”冲突

`SkillCategory.cs:3-12` 和 `SkillDefinition.cs:18-21` 把筛选分类限制为编译期 enum，而 UI 文档要求新增/变更类别只跟随版本化 Catalog。

**修正**：分离业务语义类别与开放的游戏筛选分类 ID；屏蔽面板按后者分组，BasicStats 判断按前者进行。

#### P1-H：同一逻辑方案的匹配解释尚无确定性兜底

RANK-2 对逻辑方案有 canonical signature 总序，但多个同分 assignment 可以产生不同的替代/缺失位置。`BuildResult.PrimaryTargetMatches` 会暴露该差异，现有 comparator 没有选择固定见证。

**修正**：定义不改变方案排名的 assignment canonicalization，并在 CP-SAT/oracle 中验证完整解释相同。

#### P2-E：请求规范化目前只有文字约束，没有 Application 边界

`SkillBlockPolicy` 和 `BuildRequest` 可构造任意冲突集合，`AnalyzeBuildUseCase` 不加载 Catalog 或验证。未来 UI 以外的分享导入可绕过五域互斥和分类资格。

**修正**：新增集中 `NormalizeAndValidateBuildRequest`，输出 typed issues 和 canonical request；UI、导入、profile、solver 共用。

#### P2-F：旧配置迁移只规定默认归属，未定义完整版本/冲突矩阵

ADR-0007 正确规定旧 blocked → SoftBlocked，但尚未定义跨域冲突、orphan skill、Catalog 重分类、旧缓存和 migration 幂等。

**修正**：按本节迁移矩阵补充 config/comparator/catalog 三版本策略及契约测试。

#### P2-G：禁用控件的无障碍要求与常规 WPF IsEnabled=false 冲突

UI 文档同时要求“不可选”和“键盘聚焦读取原因”。直接禁用 WPF 控件通常无法获得键盘焦点，tooltip 也可能不显示。

**修正**：规定可访问实现模式并做 Windows UI 自动化测试，不只做颜色/截图验收。

#### P3-C：总体架构文档仍引用旧比较器版本

`docs/architecture/software-architecture.md:148` 仍写 `GBFR-RANK-1`，而 `ranking-specification.md:1-5` 和 ADR-0007 已提升为 RANK-2。

**修正**：同步为 RANK-2，或避免在总体文档硬编码当前编号。

### 本次增量结论与新增阻断项

Forbidden/SoftBlocked 的核心排序设计可以接受，无需调整 `GBFR-RANK-2` 中 SoftBlocked 的层级。进入 UI/请求持久化实现前新增以下阻断项：

1. 冻结 inactive 替代池是否占用互斥域，并保证用户始终可以释放占用。
2. 定义五域中央冲突服务的 `CanAdd/CanRemove` 状态机和 typed reason；覆盖旧配置多域冲突。
3. 建立 Catalog-aware 的集中请求规范化与 canonical serialization；屏蔽集合排序、其他三域保序。
4. 补齐旧 blocked → SoftBlocked 的完整 migration matrix，分别版本化配置、比较器与 Catalog。
5. 分离开放的游戏筛选分类 ID 与 BasicStats 等业务语义分类，避免 UI 分类被封闭 enum 锁死。
6. 为同一逻辑方案定义确定的最佳匹配见证，保证结果解释和诊断可重放。
7. 增加 Forbidden 预过滤等价性、五域 10 组互斥、inactive/legacy UI 可达性和 WPF 无障碍测试。

完成这些项目后，稳定语义应为：**必选普通目标满足且 Forbidden 零命中（可行性）→ 基础属性匹配质量 → 其他普通目标完成度 → SoftBlocked 出现次数 → 普通目标位置 → 槽位 → `sigilLevel` → seeded key → canonical signature**。两个屏蔽池只在 canonical serialization 中排序，用户点击先后绝不影响结果。
