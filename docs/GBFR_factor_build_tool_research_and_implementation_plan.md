# GBFR 因子配装方案计算工具：需求研究与实现方案

> 研究时间：2026-07-22 | 所属领域：Windows 桌面工具 / 组合优化 / 游戏存档只读解析 | 研究对象类型：产品与技术方案

## 一、一句话结论

这个工具应该做成一款**严格只读 GBFR 存档、自动建立 V+ 因子实例库存、再用可证明排序正确的整数约束求解器返回前 10 套方案的 Windows 本地应用**。现有源码已经证明核心存档结构和因子关联可读；但当前 Ver. 2.0.2 的生产兼容性仍必须由两份真实存档通过 PoC 闸门确认。PoC 通过后采用存档路线，CV 不进入首版，只保留为闸门明确失败后的灾备方案。

## 二、执行摘要

用户最初提出两条库存采集路线：先研究存档，存档不可读时再做 CV 自动滚动。研究结果把这个分叉基本关闭了。

GBFR 的 Windows 存档不是一个只能靠截图绕开的黑盒。`Nenkai/GBFRDataTools` 提供 MIT 许可的 `GBFRDataTools.SaveFile`，公开实现了存档容器的 FlatBuffers 反序列化与 XXHash64 校验；未发现加密或压缩步骤。截至 2026 年 7 月该仓库仍有更新。[GBFRDataTools](https://github.com/Nenkai/GBFRDataTools) 的 save-unit 文档列出了 GemManager 的库存单元，包含因子 ID、因子等级、装备状态与标记等字段。[Save Unit IDs](https://nenkai.github.io/relink-modding/resources/re/save_units/)

更直接的证据来自仍在维护的 [BitterG/GBFR-PE-Patch-Tool](https://github.com/BitterG/GBFR-PE-Patch-Tool)。它已经能从 `SaveData#.dat` 枚举现有因子，并读取每个实例的因子等级、主词条哈希与等级、副词条哈希与等级。字段之间的连接规则也已经通过现存与生成存档验证。这个项目没有发现明确的开源许可证，因此不能复制它的实现；但它足以证明技术可行性，并给出可以独立验证的互操作事实。

由此得到五个核心决定：

1. 先做 2.0.2 存档只读 PoC；十项闸门全部通过后，首版只实现存档采集，不投入 CV。
2. 推荐 `.NET 10 LTS + WPF`，因为 Windows 是唯一目标平台，现有 MIT 存档库是 C#，后续如需窗口采集也能直接接 Win32。
3. 库存中的每件因子必须作为独立实例保存；展示时再按“主词条、副词条、等级”等签名聚合。
4. 求解器需要处理最多 12 个槽位、重复目标、硬约束和词典序排序。这是一个有界多重集优化问题。推荐用 Google OR-Tools CP-SAT，并用小规模穷举程序作为正确性 oracle。
5. 原始排序规则遗漏了“槽位成本”。如果两个方案满足情况相同，使用更少因子的方案必须优先，否则单纯最大化等级总和会鼓励塞入无关因子。该补充需要在开发前被正式写入规格。

本轮只交付研究和实现方案，不创建应用代码。用户的原始措辞已独立保存在 [`docs/original_requirements.md`](original_requirements.md)，后续规格修订不会覆盖它。

## 三、从第一性原理重建问题

### 3.1 用户要完成的工作

产品需要解决的问题是：

> 在一个可能包含数千个、允许完全重复、每件带两个有顺序技能和若干等级字段的实体库存中，选择不超过 12 个实体，使一个有序、可重复的目标技能列表尽可能被覆盖；必出前缀必须全部覆盖；在覆盖数不变时依次避开屏蔽技能、优先满足更靠前的目标、节省槽位、提高等级，并只展示排名最高的 10 个不同方案。

这个定义把产品拆成四条必须同时正确的链：

- **采集正确**：存档里的每件有效 V+ 因子都被读到，不能把两个相同因子合并丢失数量。
- **语义正确**：`A&B` 与 `B&A` 不相同；同一技能出现三次就是需求数量 3，不是“包含该技能”。
- **优化正确**：结果必须真的是既定比较器下的前 10 名，不是贪心算法碰巧找到的 10 个。
- **解释正确**：用户能看出每个目标由哪件因子满足、哪些条目命中屏蔽列表、为什么方案 1 排在方案 2 前面。

这四条任一失败，工具都可能给出看似合理但不能信任的答案。首版应优先实现结果可追溯性，动画和主题可以后置。

### 3.2 领域事实与术语修正

公开资料和现有数据项目把通用技能类别分为：

| 类别 | 推荐中文名 | 说明 |
|---|---|---|
| Basic / Basic Stats | 基础 / 基础属性 | 攻击力、体力、暴击率、昏厥等 |
| Attack | 攻击 | 伤害、伤害上限等攻击向技能 |
| Defense | 防御 | 生存、抗性等技能 |
| Support | 辅助 | 冷却、药水、奥义循环等辅助技能 |
| Special | 特殊 | 不适合归入以上类别的特殊效果 |
| Character-Specific | 角色专属 | 只对指定角色有意义的词条 |

所以原始需求中记忆不确定的“主属性”建议改为“基础属性”。“主词条”描述的是一个因子中技能的位置，“基础属性”描述的是技能类别，两者不能混用。

一般规则是 III+、IV+、V+ 具有第二词条，同技能可以由多个来源叠加，但实际效果受技能最大等级约束。[Sigils guide](https://gamefaqs.gamespot.com/ps5/308486-granblue-fantasy-relink/faqs/82470/sigils) 本工具首版按用户要求只计算“出现次数”，不计算伤害和等级收益；不过数据库必须保留最大等级和三个实测等级字段，避免未来扩展时破坏数据。

游戏 1.3 引入因子合成后，结果的两个词条可从输入两件因子的四个技能中产生。[Sigil Synthesis](https://nenkai.github.io/relink-modding/resources/re/mechanics/gem_mix/) 因而库存中实际存在的组合比早期掉落池更自由。2026 年 Ver. 2.0.2 的 Master Traits 会按第一词条决定的类别计算收益，主副顺序因此具有构筑语义。求解器应以存档中的实际组合为准，旧版本掉落规则不得过滤已有因子。

### 3.3 正式数据模型

建议把核心模型放在不依赖 WPF、SQLite、FlatBuffers 的纯领域项目中。

```text
Skill
  id                  稳定内部 ID，例如 SKILL_020_00
  hash                存档中的 uint32 哈希
  zhName / enName     显示名称
  category            Basic/Attack/Defense/Support/Special/Character
  maxLevel
  characterId?        角色专属时填写

SigilInstance
  instanceId          本次导入内稳定 ID
  sourceSlotId        存档 GemUnitID，用于追溯
  sigilIdHash
  sigilLevel
  primarySkillId
  primaryLevel          // 存档原始元数据，不作为普通单枚因子的技能贡献等级展示
  secondarySkillId
  secondaryLevel        // 存档原始元数据，不作为普通单枚因子的技能贡献等级展示
  flags
  wornBy?
  locked
  sourceSnapshotId

BuildRequest
  orderedNormalTargets   有序列表，允许重复
  mandatoryPrefixLength  0..normalTargetCount
  basicPrimaryPolicy     有序目标、优先开关、有序替代池
  forbiddenSkillIds      无序集合，命中即淘汰
  softBlockedSkillIds    无序集合，仅降低排序
  maxSlots               默认 12
  catalogVersion
  characterId?           仅在角色专属技能参与时需要

BuildResult
  selectedInstances
  normalCoverageByTargetPosition
  primaryTargetMatches   Exact / Substituted / Missing
  matchedNormalTargetCount
  softBlockedOccurrences
  usedSlots
  levelSum
  rankingExplanation
```

`orderedTargets` 必须是 list/multiset，不能转换成 set。库存也不能只保存“组合 → 数量”而丢失实例；求解前可以按签名压缩，结果回填时再选择具体实例。

### 3.4 目标位置如何被满足

若目标为 `[A, B, A, C]`，方案提供两个 A、零个 B、一个 C，则满足向量应为 `[1, 0, 1, 1]`。对于重复技能，已有数量依次分配给该技能在目标列表中最靠前的尚未满足位置。这样既尊重目标顺序，也避免“同一条 A 同时满足两个位置”。

当“前 3 条必出”时，mandatory multiset 是 `{A:2, B:1}`。硬约束要求两条 A 和一条 B；只检查是否出现过 A、B 会漏掉第二条 A。

### 3.5 绝对屏蔽与软屏蔽

绝对屏蔽用于刀上舞等具有不可接受副作用的技能。所选任一因子的主、副词条命中一次，整个候选立即淘汰；它与必选技能共同组成硬约束层。

软屏蔽沿用原“携带越多越靠后”的规则，并按**出现次数**而不是技能种类数计数。一件 `X&X` 若 X 被软屏蔽，计数为 2；两件分别含 X 的因子也计数为 2。结果卡片把命中的具体技能标红，并显示“软屏蔽命中 2 条”。

普通目标、基础属性目标、主词条替代池、绝对屏蔽和软屏蔽五个选择域互斥。UI 在用户尝试产生冲突时禁用对应技能并解释占用来源，而不是在求解器里猜测优先级。

## 四、纵向分析：为什么今天应优先存档直读

### 4.1 第一阶段：游戏发布后的截图与手工时代

GBFR 的因子库存上限很高，V+ 又存在大量随机组合。早期玩家管理库存主要依赖游戏内筛选、锁定和肉眼记录。这种方式能解决“我有没有某个技能”，却不适合回答“我拥有的两两组合能否在 12 个槽里覆盖 20 个有优先级的目标”。

如果只有十几件装备，手工输入是合理的容错入口；当库存上千时，手工输入本身就是产品失败。用户这次明确拒绝手工路线，是由数据规模决定的，不是体验偏好。

### 4.2 第二阶段：同类游戏用 CV 打通库存采集

原神工具生态较早形成了“采集器 → 标准 JSON → 优化器”的分工。莫娜占卜铺负责计算，YAS、Amenoma 等独立工具负责在游戏界面自动滚动、截图和识别，再输出 JSON。[莫娜占卜铺](https://github.com/wormtql/genshin_artifact)、[YAS](https://github.com/wormtql/yas)、[Amenoma](https://github.com/daydreaming666/Amenoma)

这条路线证明了大库存自动采集在产品层面可成立，也留下了重要经验：采集器与求解器应通过稳定中间模型解耦。但是，CV 的每一个便利都绑定着分辨率、语言、字体、UI 动画、滚动重复、窗口遮挡和 OCR 置信度。只要游戏更新 UI，维护成本就会出现。

`ok-oldking/ok-wuthering-waves` 展示了更完整的 Windows 游戏自动化基础设施：窗口识别、截图、OCR、输入模拟与任务编排。[OK-Wuthering-Waves](https://github.com/ok-oldking/ok-wuthering-waves) 它适合学习基础设施的边界处理，却不说明 GBFR 也应该直接走 CV。不同游戏是否有可读本地库存，决定了路线优先级。

### 4.3 第三阶段：GBFR 存档容器被公开理解

`GBFRDataTools.SaveFile` 将存档解析公开成独立 C# 库。`SaveGameFile.FromFile` 读取文件头中的两个数据块偏移和长度，以 FlatBuffers 解析 typed tables，并处理 XXHash64 校验。Nenkai 的文档把 GemManager 描述为约 5100 个循环条目，列出 2701、2702、2703、2704、2706、2707、1701、1702 等单元。[SaveFile source](https://github.com/Nenkai/GBFRDataTools/tree/master/GBFRDataTools.SaveFile)

这一步解决的是“文件能不能结构化打开”，但还没有单独证明“主副词条如何连接到每件因子”。

### 4.4 第四阶段：因子实例关联被现有工具验证

当前的 GBFR-PE-Patch-Tool 已经实现因子查看与生成。它公开的实现显示：

| 含义 | IDType / 规则 |
|---|---|
| 因子槽起点 | `GemUnitID >= 30000` |
| 因子 ID 哈希 | IDType 2703 |
| 因子等级 | IDType 2704 |
| 装备角色 | IDType 2706 |
| 因子 flags | IDType 2707 |
| trait 哈希 | IDType 1701 |
| trait 等级 | IDType 1702 |
| 第 n 个因子的主 trait UnitID | `120000000 + (GemUnitID - 30000) * 100` |
| 副 trait UnitID | 主 trait UnitID + 1 |

项目的 `GetExistingSigils()` 已按这个关系返回因子名、因子等级、主词条名/等级和副词条名/等级。其 trait 数据说明写明 1701/1702 已被现存和生成存档验证。[sigil_store.go](https://github.com/BitterG/GBFR-PE-Patch-Tool/blob/master/sigil_store.go)、[sigil_gen.go](https://github.com/BitterG/GBFR-PE-Patch-Tool/blob/master/sigil_gen.go)

到这里，存档路线已经越过“理论可行”。对 1.3.x 核心解析和实例关联的置信度约为 95%；对 Ver. 2.0.2 沿用同一核心布局的当前置信度约为 80%。后者是有根据的工程判断，不是已完成的实机验证：公开因子工具的关键实现早于 2.0.2，Nenkai 在线因子 ID 页也仍标注 1.3.x。剩下的工作必须用当前真实存档完成差分测试，确认空槽、锁定、装备中、特殊因子、未知哈希和保存并发。

| 判断 | 当前置信度 | 发布含义 |
|---|---:|---|
| 存档容器可只读解析 | 约 95% | 已有 MIT schema、解析器和哈希实现互证 |
| 重复因子可按实例枚举 | 约 95% | `UnitID` 独立存在，不能按内容去重 |
| 主副词条及各自等级可恢复 | 约 95% | `1701/1702` 与配对公式有直接代码证据 |
| Ver. 2.0.2 沿用核心布局 | 约 80% | 必须通过两份 2.0.2 实际存档再进入产品开发 |

### 4.5 历史如何塑造当前方案

2026 年已有公开实现覆盖存档容器、GemManager 单元和 trait 关联。CV 会丢掉这些结构化字段，并增加 OCR 误差和 UI 适配成本，因此不适合作为首版输入源。

推荐路线是：**先做纯只读存档 PoC；闸门通过后正式实现存档解析。只有连续两轮 2.0.2 真实样本都无法稳定恢复核心因子、且无法从当前表或上游研究定位字段时，才启动 CV 灾备。**

## 五、横向分析：三条采集路线和参考项目

### 5.1 采集路线比较

| 维度 | 存档只读 | CV + 自动滚动 | 手工录入 |
|---|---:|---:|---:|
| 当前技术可行性 | 高，已有实例级源码证据 | 中，需重新适配 GBFR UI | 低，规模不现实 |
| 数据准确性 | 高，直接读取哈希和等级 | 依赖 OCR 与去重 | 依赖人，错误难发现 |
| 读取速度 | 预计秒级 | 数分钟级 | 数小时级 |
| 游戏语言依赖 | 名称映射可独立处理 | 强依赖语言和字体 | 强依赖显示名称 |
| 分辨率/DPI 依赖 | 无 | 强 | 无 |
| 游戏更新风险 | 存档 schema/ID 变化 | UI、字体、布局、动画变化 | 低 |
| 运行时风险 | 只读文件，最低 | 需要截图和输入模拟 | 最低 |
| 可诊断性 | 高，可保存 hash/未知项 | 中，需要保留截图 | 低 |
| 首版建议 | **采用** | 不开发，仅留接口 | 不作为产品路线 |

“存档直读”仍须坚持只读。GBFR 社区存在存档损坏与备份恢复案例；本工具没有任何写入需求，不应提供“顺便改存档”的能力，也不应复用第三方库中自动修复校验并写回的代码路径。

### 5.2 参考项目：可借鉴与不可照搬

#### choeki/gbfr-relink-sim

该项目是 Vite + React + TypeScript 的本地配装模拟器，提供 12 个因子槽、主副词条独立等级、技能汇总、本地保存和图片导出。[gbfr-relink-sim](https://github.com/choeki/gbfr-relink-sim)

最有价值的是数据结构：trait 有 `id/hash/maxLevel/canPrimary/canSecondary/category`，sigil 有主 trait、是否为 plus、允许等级和 secondary pool。当前 seed 标注来源时间为 2026-07-16，含五类 category 和新版本数据。

不能照搬的部分有两点。它模拟“玩家手工搭一套”，不从实际库存求解；它的仓库没有发现 LICENSE 文件，公开可读不等于允许复制。可以借鉴字段设计并交叉核验数据，不能直接拷贝源码或整包 seed。

#### 莫娜占卜铺与扫描器生态

最值得借鉴的是“采集与求解解耦”。库存快照应是一个版本化领域对象；无论将来来自存档还是 CV，后续求解器都只消费 `InventorySnapshot`。这会让 CV 灾备成为 adapter，而不是第二套应用。

不能照搬的是原神的伤害模型、圣遗物五部位限制和 GOOD/Mona JSON 字段。GBFR 的关键约束是双技能有序因子、最多 12 槽和重复技能出现次数，问题结构完全不同。

#### ok-oldking/ok-wuthering-waves

可借鉴窗口句柄确认、客户区坐标、DPI、截图、OCR 置信度、自动化任务取消和错误截图留存。不能引入它的战斗、刷取、角色控制等功能，也不应让本工具获得不必要的管理员权限或进程写权限。

#### GBFRDataTools 与 GBFR-PE-Patch-Tool

前者 MIT，可作为实现依赖或源码参考；后者提供强证据但无明确许可证，只用于研究和独立验证。最终产品的解析层应在自己的测试样本上证明行为，不把未授权代码复制进仓库。

## 六、存档读取实施规格

### 6.0 格式边界

公开实现显示，存档主体是带文件头、两个 FlatBuffers 数据块和 XXHash64 完整性校验的二进制容器；没有发现解密或解压流程。因此读取器不需要密钥、进程注入、DLL 注入或内存扫描。校验哈希不是加密：首版只验证它，不包含任何重算后写回源文件的路径。

### 6.1 输入与发现

应用启动后扫描：

```text
%LocalAppData%\GBFR\Saved\SaveGames\SaveData1.dat
%LocalAppData%\GBFR\Saved\SaveGames\SaveData2.dat
%LocalAppData%\GBFR\Saved\SaveGames\SaveData3.dat
```

同时提供“浏览存档文件”，满足用户直接传入文件的原始需求。自动发现时显示槽号、玩家名/游玩时间（能可靠解析时）、修改时间、文件大小和备份标记，不替用户猜选哪一个。

### 6.2 严格只读快照

推荐流程：

1. 以允许游戏共享读取的模式打开源文件。
2. 复制到应用缓存目录，记录源路径、大小、修改时间和 SHA-256。
3. 复制后再次读取源文件元数据；若大小或修改时间改变，最多重试 2 次。
4. 只解析缓存快照，永不把文件句柄以写模式打开。
5. 不修改校验、不恢复备份、不替换原文件。

源文件连续变化表示游戏可能正在保存。应用应提示“请返回标题或关闭游戏后重试”，避免解析前后不一致的 FlatBuffer 快照。

### 6.3 解析与连接

解析器输出 typed unit index：

```text
Dictionary<(IdType, UnitId), SaveUnit>
```

遍历 2703 的非空 Gem 单元，对每个实例计算主副 trait UnitID，再从 1701/1702 读取哈希与等级。2704 作为因子等级，2706/2707 保留为装备和锁定元数据。空哈希、无第二 trait、非 V+ 因子按明确原因过滤并计数。

导入摘要必须包含：

- 扫描到的 Gem 单元总数；
- 非空因子数；
- V+ 双词条实例数；
- 被过滤的单词条/非 V+ 数；
- 未识别因子哈希数；
- 未识别 trait 哈希数；
- 重复实例数；
- 快照 SHA-256 与 parser schema 版本。

### 6.4 未知哈希策略

不能静默丢弃未知 trait。将其保存为 `Unknown(0x12345678)` 并把快照标记为 partial。若未知项只出现在用户未选择的额外技能位置，允许用户确认后继续分析；若未知项导致无法判断一件因子是否为双词条或目标映射，阻止“结果完整”声明。

### 6.5 数据目录

首版只需要技能 ID、哈希、中文名、英文名、类别和角色限制，不需要游戏图标或美术资产。数据包应有：

- `catalogSchemaVersion`；
- `gameDataVersion`；
- 每条数据的来源与置信度；
- hash 唯一性检查；
- 中文别名，便于搜索；
- 未知项上报时需要的诊断信息。

从第三方项目引入数据前先确认许可证。若许可不清晰，独立从公开 ID 表和用户本机游戏表生成，不把第三方仓库的 JSON 直接复制进发行包。

## 七、求解与排序的正式方案

### 7.1 为什么不能暴力组合

库存若有 1000 件，直接枚举任意 12 件已经远超可接受范围；5000 件上限更不可能。即使只看 V+，不同实例和重复数量仍会使 `C(n,k)` 爆炸。

先按以下签名压缩实例：

```text
(primarySkillId, secondarySkillId,
 sigilLevel, primaryLevel, secondaryLevel,
 characterRestriction, flagsRelevantToSelection)
```

每个签名保留 `count` 和实例 ID 列表，求解变量 `x_g` 表示选该组多少件，范围 `0..min(count, 12)`。主副顺序在签名中不能交换。

任何两个技能都既不命中目标、也不涉及屏蔽诊断的组，在“槽位越少越好”的规则下必不可能改善结果，可以在建模前排除。

### 7.2 CP-SAT 模型

为每个压缩组建立整数变量 `x_g`。

```text
0 <= x_g <= min(inventoryCount_g, 12)
sum(x_g) <= 12
```

某技能 s 的已选出现数：

```text
available_s = sum_g(x_g * occurrences(g, s))
covered_s = min(required_s, available_s)
```

前 X 个必出目标形成每技能的 `mandatoryCount_s`，添加：

```text
available_s >= mandatoryCount_s
```

若模型不可行，输出“没有满足全部必出技能的方案”，同时给出缺口诊断，例如“追击需要 3，库存最多可同时提供 2”。

### 7.3 推荐的完整比较器

原始 5.1-5.4 可形式化为以下层级，并补上槽位成本：

1. 必出前缀全部满足且绝对屏蔽出现次数为 0，否则淘汰。
2. 开启主词条优先时，基础属性主词条目标完成数量更多者优先。
3. 完成数相同时，按基础属性目标顺序比较精确匹配向量。
4. 仍相同时，按有序替代池比较实际替代技能数量向量。
5. 其他目标满足总条数更多者优先。
6. 目标数相同时，软屏蔽技能出现次数更少者优先。
7. 仍相同时，按其他目标位置比较满足向量。
8. 仍相同时，使用因子更少者优先。
9. 仍相同时，因子 `sigilLevel` 总和更高者优先。
10. 完全相同时，以本次分析的稳定随机种子打散。
11. canonical signature 作为最终稳定兜底。

第 5 条是需求补充。没有它时，只要额外塞入一件高等级无关因子能增加等级总和，12 槽方案就会压过 3 槽的精确方案，和“3 追击 + 3 伤害上限至少需要 3 个因子”的直觉冲突。

绝对屏蔽不是排序扣分，而是可行性条件。软屏蔽仍保持“普通目标完成数相同后先比较软屏蔽次数，再比较目标位置”的既有语义。

等级字段建议使用 `sigilLevel` 求和。主、副 trait level 在详情展示，不参与首版排序。若实测发现合成因子的 `sigilLevel` 与两个 trait level 可长期分离，再增加明确的排序模式，不能把三个值混加。

### 7.4 标量目标与 Top-K

24 位满足向量可以转为整数：位置 1 使用最高位，位置 24 使用最低位。把每一级乘以严格大于后续级最大总范围的系数，即可在 int64 内构造无碰撞的词典序目标。

求出第一名后，对该压缩计数向量加入 no-good cut，再求下一名，直到得到 10 个不同展示方案或模型不可行。每次求解都要继承同一排序目标。随机只作为最后一级，由 `runSeed + canonicalBuildSignature` 生成稳定伪随机键；同一 seed 可复现，换一次分析可以重新打散。

输出的是“比较器下保证正确的前 10 个”，不需要先枚举所有可行组合。

### 7.5 结果去重和实例回填

两个结果只有在以下展示计数完全一致时才合并：

```text
primarySkillId & secondarySkillId -> quantity
```

`A&B * 2 + B&A` 与 `A&B + B&A * 2` 是不同方案。完全相同的三个库存实例可以聚合成 `*3`，展开后列出各自 slot ID 和等级。

### 7.6 小规模 oracle

另写一个只供测试使用的穷举求解器，限制库存不超过 16、槽位不超过 6。随机生成数千组小实例，比较 CP-SAT 与穷举的前 K 排名。这比只写几个手工单测更容易抓出重复目标、词典序和屏蔽层级错误。

## 八、产品功能规格

### 8.1 页面一：库存

- 自动发现三个存档槽，也允许浏览文件。
- 显示最后导入时间、快照 hash、解析器版本和导入摘要。
- 显示 V+ 实例总数、不同主副组合数、未知项数。
- 提供搜索和只读检查，便于用户确认“游戏里有的因子是否读到了”。
- 一键重新读取；存档变化后不修改用户已保存方案。

### 8.2 页面二：目标方案

- 固定提供 24 个可搜索下拉位，空位允许存在；至少一项非空时“开始分析”才可点击。
- 支持中文名、英文名、别名和拼音首字母搜索。
- 目标顺序可用拖动或上下按钮调整；重复技能合法。
- “前 X 条必出”，X 范围 0..当前目标数。
- 绝对屏蔽和软屏蔽使用两个独立的分类多选面板；类别、顺序和名称与游戏内技能筛选器一致。
- 每个分类内以自动换行的紧凑选项平铺技能，不使用下拉框，也不让每个技能占一整行。
- 某技能被其他选择域占用后，在原位置置灰、加锁并标明原因；冲突时阻止保存和分析。
- 保存方案时记录名称、普通/基础属性目标、必出 X、有序替代池、两个无序屏蔽集合、槽位上限、Catalog 和 schema 版本，不复制库存。
- 库存更新后可直接对保存方案重新分析。

### 8.3 字符串导入导出

推荐格式：

```text
GBFRB1.<base64url(canonical-CBOR-payload)>.<CRC32>
```

payload 包含：

```text
schemaVersion
orderedNormalSkillIds
mandatoryPrefixLength
basicPrimaryPolicy
forbiddenSkillIds
softBlockedSkillIds
maxSlots
```

内部使用稳定 skill ID，不使用易变中文名。导入前限制总字符串长度，例如 8 KiB；验证前缀、版本、CRC、目标数量和技能 ID。遇到未来版本时提示升级，不能把未知字段静默解释成当前语义。

### 8.4 页面三：结果

每个结果卡片显示：

- 排名与“完整满足 / 部分满足”；
- `已满足 20/24`；
- 必出状态；
- 软屏蔽命中数；
- 使用槽位数；
- 因子等级总和；
- 聚合表达式，如 `追击&伤害上限 * 2 + 伤害上限&追击`；
- 未满足目标，按原目标顺序列出；
- 排序说明：“与第 2 名满足数相同，但少 1 个软屏蔽词条”；
- 展开后显示具体实例 slot ID、三组等级、锁定和当前装备角色。

含软屏蔽技能的因子整行浅红，具体技能使用深红文本和“软屏蔽”标签，避免仅靠颜色传达状态。绝对屏蔽不会出现在结果卡；若它使所有方案不可行，空结果页给出诊断。

### 8.5 取消、超时和结果可信度

分析应可取消。正常库存目标是 2 秒内出结果；5000 件极端库存要求 10 秒内返回或显示进度。若求解器只得到 FEASIBLE 而未证明 OPTIMAL，界面必须写“当前最佳，尚未证明为前 10 最优”，不能伪装成确定排名。

## 九、推荐架构

### 9.1 技术栈

截至 2026-07-22，.NET 10 是 active LTS，支持至 2028-11-14；.NET 8 将于 2026-11-10 结束支持。[.NET support policy](https://dotnet.microsoft.com/en-us/platform/support/policy)

推荐：

| 层 | 选择 |
|---|---|
| Runtime | .NET 10 LTS, win-x64 |
| UI | WPF + MVVM + CommunityToolkit.Mvvm |
| 存档解析 | 自有 read-only adapter，底层参考/依赖 MIT 的 GBFRDataTools.SaveFile |
| 求解 | Google.OrTools CP-SAT NuGet |
| 本地数据 | Microsoft.Data.Sqlite |
| 日志 | Microsoft.Extensions.Logging + 本地滚动文件 |
| 测试 | xUnit + FluentAssertions + FsCheck/自建随机 oracle |
| 发布 | self-contained win-x64；先 zip，稳定后再考虑 MSIX/安装器 |

微软支持 WPF 桌面部署和 .NET self-contained/single-file 发布。OR-Tools 与 SQLite 带有原生依赖，首版应发布 self-contained 文件夹 zip；单 EXE 可在依赖验证稳定后再评估。[WPF deployment](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/app-development/deploying-a-wpf-application-wpf)、[single-file deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/single-file/overview)

### 9.2 模块边界

```text
GBFRTool.App                 WPF 组合根、页面、ViewModel
GBFRTool.Domain              Skill、SigilInstance、Request、Result、比较器
GBFRTool.SaveReader          文件发现、快照、FlatBuffer adapter、版本诊断
GBFRTool.Catalog             hash/ID/名称/类别映射与版本
GBFRTool.Solver              压缩、CP-SAT、Top-K、解释生成
GBFRTool.Persistence         SQLite migration、方案与库存快照
GBFRTool.Share               GBFRB1 编解码与校验
GBFRTool.CvFallback          首版不实现，只保留接口与设计文档
GBFRTool.Tests               单测、样本存档、oracle、性能基准
```

UI 不接触 save unit ID，求解器不接触 SQLite，存档解析器不认识“必出”。这种隔离让游戏版本变化只改 adapter/catalog，不污染排序逻辑。

### 9.3 SQLite 表

建议最小表：

```text
inventory_snapshot(id, source_path_hash, source_sha256, imported_at,
                   parser_version, game_data_version, status, diagnostics_json)

sigil_instance(id, snapshot_id, source_slot_id, sigil_hash, sigil_level,
               primary_skill_id, primary_level,
               secondary_skill_id, secondary_level,
               flags, worn_by, locked)

build_profile(id, name, schema_version, mandatory_prefix,
              max_slots, created_at, updated_at)

build_target(profile_id, position, skill_id)
build_blocked_skill(profile_id, skill_id)
```

库存刷新应新建 snapshot 并原子切换 current 指针，不在旧快照上逐行修改。这样结果可以追溯到当时库存，也能安全回滚一次错误解析。

## 十、CV 灾备设计：只在存档闸门失败后启动

虽然当前结论不需要 CV 首版，仍给出可执行预案。

### 10.1 触发条件

满足任一条件才启动 CV 开发：

- 新游戏版本导致生产存档无法反序列化，且 10 个工作日内无法修复；
- 存档迁移到平台加密/云端，无法在本地取得合法只读副本；
- trait 关联不再持久化，必须运行游戏才能观察完整库存。

“有一个未知哈希”不构成触发条件，优先更新 catalog。

### 10.2 CV 流程

1. 检测 GBFR 窗口和客户区尺寸，确认前台且无遮挡。
2. 引导用户进入因子列表、切到固定排序和详情布局。
3. 对一屏可见卡片做布局检测，不用全屏自由 OCR。
4. 对主词条、副词条、等级分别裁剪识别；名称用有限词表纠错。
5. 给每条记录生成视觉指纹，处理滚动重叠和去重。
6. 小步滚动，检测列表是否真实移动；连续两次底部指纹相同即结束。
7. 低置信记录保留截图并进入复核队列；不能静默猜测。
8. 输出同一个 `InventorySnapshot`，求解器无需改变。

要覆盖 100%、125%、150%、175%、200% DPI，至少 1920×1080、2560×1440、3840×2160，以及简中/英文两种语言。自动化只向确认过的 GBFR 前台窗口发送滚动，Esc 可立即终止。

### 10.3 为什么不直接复用 old-king

可以参考它对 OCR、截图和输入模拟的工程处理，但不复制其完整任务系统。GBFR 库存采集只需要一个受限状态机：定位页面、读取一屏、滚动、去重、结束。把战斗自动化框架带进来会扩大权限、依赖和维护面，与当前目标无关。

## 十一、被原始需求遗漏但会影响正确性的事项

### 11.1 槽位成本

必须新增“同等满足下使用更少因子优先”，或明确所有结果固定使用 12 槽。推荐前者，因为原始示例把 3 个双技能因子视为 3+3 的自然答案。

### 11.2 已装备因子

存档会标记因子当前装备给谁。默认应认为可以拆下并用于当前新配装，因为工具求的是单角色方案；同时在结果中标注“当前由某角色装备”。若用户希望不动其他角色，应增加“排除已装备因子”开关。这是库存可用性，不是额外玩法功能。

### 11.3 角色专属技能

若目标列表允许选择角色专属技能，应用必须知道目标角色，否则可能给出无效方案。最小策略是：通用目标无需选角色；首次加入角色专属技能时要求选择对应角色，并过滤不匹配实例。

### 11.4 锁定状态

锁定因子仍然可以装备，不能从求解库存排除；锁定只用于结果提示和实例定位。

### 11.5 V+ 判定

不能只用显示名称是否含 `V+`。合成与特殊因子可能产生例外。建议以“存在两个有效 trait + 对应 sigil 定义/flags”联合判断，并把例外纳入回归样本。

### 11.6 方案的“随机排序”可复现性

完全随机会让用户刷新后找不到上一套方案，也让测试不稳定。使用每次分析生成的 seed 打散；结果详情可复制 seed。同一库存、请求、seed 得到相同顺序。

### 11.7 数据版本与游戏更新

保存方案只保存稳定 skill ID。catalog 升级后若某 ID 更名，方案仍可加载；若 ID 删除，显示“未知/已移除技能”并阻止静默替换。

### 11.8 隐私和诊断

存档包含 Steam ID 等用户信息。日志不得记录完整存档、Steam ID、玩家名或绝对用户名路径。导出诊断包需用户主动操作，只包含 schema 版本、未知哈希、计数和已脱敏路径。

### 11.9 服务协议与发布文案

Steam 上的 GBFR 服务协议限制逆向、未经授权的数据操作以及会影响服务的外部工具，并保留暂停或删除账号等处置权。[GBFR Terms of Service Agreement](https://store.steampowered.com/eula/881020_eula_0) 本工具的“本地只读、不注入、不写回、不联网操作游戏服务”边界使技术风险显著低于存档修改器，但没有找到官方针对只读配装导入工具的豁免。因此：

- 不宣传“官方允许”“绝对安全”或“零封号风险”；
- 首屏注明非官方、与 Cygames 无关联，仅在本机读取用户选择的文件；
- 不加入写回、签名修复、物品生成、Steam ID 修改、跨账号迁移或隐藏调试入口；
- 若将来加入 CV，也只对用户确认的前台 GBFR 窗口做受限滚动，不扩展为游戏自动化。

这不是法律意见；公开或商业分发前仍应做独立的许可与服务协议审查。

### 11.10 不应进入首版的内容

- 伤害计算；
- 自动修改或写回存档；
- 内存读写、DLL 注入；
- 自动装备；
- 战斗自动化；
- 因子获取建议；
- 祝福石、武器、召唤石联合优化。

这些都不是当前“依据已持有 V+ 因子满足目标技能”的必要组成。

## 十二、验收标准与测试矩阵

### 12.1 存档验收

在开始完整 UI 前，至少使用 2 份不同玩家、由 Ver. 2.0.2 正常载入并重新保存的 Windows/Steam 存档；最好再加 1 份 1.3.2 回归样本。样本不提交 Git、不上传公共服务。以下十项必须全部通过：

1. **零写入**：导入前后源文件 SHA-256、长度、创建时间和修改时间完全一致。
2. **结构**：头版本、两个块范围、FlatBuffers 和当前 XXHash64 校验均合法。
3. **数量**：所有已占用因子数与游戏 UI 一致，双技能过滤数可核对。
4. **内容**：每份至少抽查 30 个双技能因子，主副技能、顺序和三个等级字段 100% 一致。
5. **重复件**：技能与等级完全相同的两个实例仍解析为数量 2，且实例键不同。
6. **差分**：获得或出售一个已知因子并重新保存，快照差异只落在对应实例与游戏自然更新字段。
7. **装备/锁定**：实例仍被枚举，状态与 UI 一致。
8. **未知字典**：目标范围内双技能均映射到稳定 ID；名称缺失时保留哈希，不丢实例。
9. **并发保存**：源文件变化时重试或明确失败，不返回半快照。
10. **健壮性**：截断文件、随机文件、旧备份和 `SystemData.dat` 不崩溃、不被误报为成功。

同时覆盖空库存或低库存、接近上限、合成同类别、`A&A`、角色专属、固定双技能和单技能因子。普通 SSD 上发现、复制、校验和解析目标小于 2 秒；准确性优先于性能。

### 12.2 求解器关键样例

| 场景 | 期望 |
|---|---|
| 目标 `A,A,A`，库存只提供 2 个 A | 无必出时满足 2；必出 X=3 时无方案 |
| 库存有两个完全相同实例 | 可同时选 2，展示 `*2` |
| `A&B` 与 `B&A` | 作为不同签名和不同展示方案 |
| 任一主/副词条命中绝对屏蔽 | 该候选不输出 |
| 同满足数，一方含 1 个软屏蔽技能 | 无软屏蔽者优先 |
| 同满足数，方案 1 满足 B，方案 2 满足 C，目标 A/B/C | 方案 1 优先 |
| 完整满足但需要 4 槽，对手 3 槽也完整满足 | 3 槽优先（新增规则） |
| 满足 20 条且有软屏蔽 vs 满足 19 条无软屏蔽 | 20 条优先，符合 5.4 |
| 所有业务键一致 | 使用 seed 打散且可复现 |
| 小规模随机实例 | CP-SAT 前 K 与穷举 oracle 完全一致 |

### 12.3 性能指标

- 1000 件库存、24 目标、12 槽：P95 < 2 秒。
- 5000 件库存极端样本：P95 < 10 秒。
- UI 分析期间保持响应，取消动作 < 200 ms 生效。
- 库存页面使用虚拟化，不因数千行卡死。
- 内存峰值目标 < 500 MiB。

### 12.4 分享与持久化

- 编码后解码保持目标顺序、重复项、必出 X、有序替代池和两个屏蔽集合。
- 两个屏蔽池勾选顺序不同但成员相同时，规范化编码和 request hash 相同。
- 单字符损坏能由 CRC 检出。
- 未知 schema 不崩溃、不静默降级。
- 同名方案允许提示覆盖或自动加后缀，不无声覆盖。
- 数据库 migration 可从每个历史 schema 升级并保留方案。

## 十三、分期路线与工作量

### Phase A：存档读取 PoC（3-5 个工作日）

Phase A 先验证存档格式和字段关联，不开发 UI。

- 建立 .NET 10 solution 与纯领域模型。
- 只读解析 SaveData#，输出 JSON 诊断。
- 读取 2703/2704/1701/1702 并关联主副 trait。
- 对至少 2 份不同玩家的 Ver. 2.0.2 真实存档做 UI 抽样和差分比对。
- 记录所有未知 hash 和特殊实例。

**过闸标准：** 第 12.1 节十项全部通过，双词条 V+ 实例召回率与主副顺序准确率 100%，源文件 hash 不变。若只是新增字段或未知哈希，继续修 adapter/catalog；只有连续两轮真实样本都无法稳定恢复核心因子，且无法定位字段时才转 CV。

### Phase B：求解内核（4-7 个工作日）

- 实现请求验证、库存压缩和正式比较器。
- 建立 CP-SAT Top-K。
- 建立小规模穷举 oracle 与属性测试。
- 做 1000/5000 件基准。
- 输出机器可读解释。

**过闸标准：** 随机小样本与 oracle 全一致，极端样本达到性能指标。

### Phase C：Windows MVP（7-12 个工作日）

- WPF 三页流程：库存、目标、结果。
- 24 个可搜索目标位、必出 X、屏蔽列表。
- 结果标红、聚合、展开实例和排序解释。
- SQLite 保存方案和库存快照。
- GBFRB1 分享字符串。
- self-contained win-x64 zip。

### Phase D：稳健性与发行（5-8 个工作日）

- 多存档、多语言名称、未知 hash 和数据库 migration。
- 崩溃日志脱敏、诊断包、取消/超时。
- 安装与升级验证、用户文档、许可证清单。
- 回归 v2.0.x 游戏补丁。

单人熟悉 .NET/WPF 的情况下，首个可靠公开版约 4-6 周。这个估算不包含 CV；CV 若被真实触发，另计 2-4 周并持续承担 UI 更新维护。

## 十四、横纵交汇洞察与未来剧本

### 14.1 历史形成的工程优势

社区项目已经公开了存档容器、typed units，以及因子与 trait 的实例关联。本项目可以从严格只读的集成和验证开始，无需重新逆向外层格式或先做 OCR。

项目差异化来自只读安全边界、符合用户语义的多重集求解，以及每个排序结果的可解释证据。

### 14.2 主要风险的历史根源

现有社区工具大多以修改、生成或模拟为目标。修改工具容忍写回、内存扫描和版本特定常量；模拟器容忍用户自己输入；OCR 工具容忍少量人工复核。本项目要做的是自动给出可执行配装，所以必须从这些项目借证据和结构，却不能继承它们的风险边界。

另一个风险来自游戏仍在演进。2026 年 Master Traits 让主词条类别价值上升，说明“主副顺序只是名称差异”的旧假设会过期。因此数据模型必须保存原始顺序和类别，规则解释必须版本化。

### 14.3 三个未来剧本

**最可能剧本：存档字段稳定，catalog 小幅更新。** 应用每次新游戏版本只更新技能映射和少量特殊因子，解析器长期不变。产品价值集中在保存方案、重新分析和求解正确性。

**最危险剧本：游戏更新改变 save unit 关联。** 应用检测 schema/header/hash 异常后拒绝给出“完整库存”，保留旧快照，并在 adapter 修复前明确降级。若字段仍在，只需更新映射；若字段消失，才启动 CV。

**最乐观剧本：形成稳定的只读库存中间格式。** 其他 GBFR 工具可以消费同一个脱敏库存 JSON，本项目仍只做自己的因子方案求解。这个方向不要求增加伤害计算或游戏自动化，只是把采集边界做得足够清楚。

## 十五、开发前仍需正式确认的三条规格

研究已经不需要再确认技术路线，但实现前应让产品负责人对以下规则签字：

1. 同满足数时，排序是否确定为“屏蔽数 → 目标位置”，还是“目标位置 → 屏蔽数”？本报告按原 5.4 采用前者。
2. 是否接受新增“使用因子更少优先”？本报告强烈建议接受。
3. 等级总和是否只使用 `sigilLevel`？本报告建议是，主副 trait level 只展示。

这三条不影响存档读取，却会改变前 10 名的确定结果，不能在编码中自行摇摆。

## 十六、最终建议

启动实施时按这个顺序：

1. 建立严格只读的 Ver. 2.0.2 存档解析 PoC，并用两份不同玩家的真实存档通过十项闸门；
2. 冻结比较器和三个待确认规则；
3. 完成 CP-SAT + 穷举 oracle；
4. 再做 WPF UI、SQLite 和分享字符串；
5. 不启动 CV，除非存档字段在未来版本真实消失。

这条路径既满足“自动读取是硬需求”，也避免了不必要的屏幕自动化维护。更重要的是，它让每一个结果都能回答三个问题：这件因子确实存在吗、它满足了哪个目标、它为什么排在这里。

## 十七、信息来源

以下来源均于 2026-07-22 访问。关键技术判断优先依据项目源码与官方文档；社区资料只用于说明玩家流程和风险，不单独作为二进制结构结论。

1. Nenkai, GBFRDataTools：https://github.com/Nenkai/GBFRDataTools
2. Nenkai, GBFRDataTools.SaveFile：https://github.com/Nenkai/GBFRDataTools/tree/master/GBFRDataTools.SaveFile
3. Nenkai, Save Unit IDs：https://nenkai.github.io/relink-modding/resources/re/save_units/
4. Nenkai, Sigil/Gem IDs：https://nenkai.github.io/relink-modding/resources/sigil_gem_ids/
5. Nenkai, Table Database：https://nenkai.github.io/relink-modding/tables/table_database/
6. Nenkai, Sigil Synthesis Grand Success：https://nenkai.github.io/relink-modding/resources/re/mechanics/gem_mix/
7. BitterG, GBFR-PE-Patch-Tool：https://github.com/BitterG/GBFR-PE-Patch-Tool
8. BitterG, sigil_store.go：https://github.com/BitterG/GBFR-PE-Patch-Tool/blob/master/sigil_store.go
9. BitterG, sigil_gen.go：https://github.com/BitterG/GBFR-PE-Patch-Tool/blob/master/sigil_gen.go
10. choeki, gbfr-relink-sim：https://github.com/choeki/gbfr-relink-sim
11. wormtql, 莫娜占卜铺：https://github.com/wormtql/genshin_artifact
12. wormtql, YAS：https://github.com/wormtql/yas
13. daydreaming666, Amenoma：https://github.com/daydreaming666/Amenoma
14. ok-oldking, ok-wuthering-waves：https://github.com/ok-oldking/ok-wuthering-waves
15. Microsoft, .NET Support Policy：https://dotnet.microsoft.com/en-us/platform/support/policy
16. Microsoft, WPF deployment：https://learn.microsoft.com/en-us/dotnet/desktop/wpf/app-development/deploying-a-wpf-application-wpf
17. Microsoft, Single-file deployment：https://learn.microsoft.com/en-us/dotnet/core/deploying/single-file/overview
18. Microsoft, Microsoft.Data.Sqlite：https://learn.microsoft.com/en-us/dotnet/standard/data/sqlite/
19. Microsoft, Windows.Graphics.Capture：https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/screen-capture
20. Google, OR-Tools for .NET：https://developers.google.com/optimization/install/dotnet/
21. Google, CP-SAT Solver：https://developers.google.com/optimization/cp/cp_solver
22. GameFAQs, Sigils guide：https://gamefaqs.gamespot.com/ps5/308486-granblue-fantasy-relink/faqs/82470/sigils
23. Cygames, Ver. 2.0.2 Update Information：https://relink-ragnarok.granbluefantasy.com/en/updates/381/
24. Steam / Cygames, GBFR Terms of Service Agreement：https://store.steampowered.com/eula/881020_eula_0
25. SteamDB, GBFR Cloud Saves：https://steamdb.info/app/881020/ufs/
26. Granblue Fantasy Relink Wiki, Sigils：https://relink.gbf.wiki/Sigils
27. Psycho-Marcus, WuWa Inventory Kamera：https://github.com/Psycho-Marcus/WuWa_Inventory_Kamera

## 十八、方法论说明

本报告使用横纵分析法：纵向追踪 GBFR 因子采集从手工、CV 到存档结构化解析的演进，横向比较当前可选采集路线和参考工具，再把两条轴交汇为产品边界、求解模型与分期实现判断。

## 十九、实施后的产品补充设计（2026-07-23）

初版研究完成后，产品改用 Electron，并通过真实 Ver. 2.0.2 存档验证了只读解析和纯 Web Worker 求解。本节记录随后确定的交互和多角色配装规则；与前文冲突时，以本节和已接受 ADR 为准。

### 19.1 目标与结果

每个目标区都有“清空”。“可接受的替代主词条”只在用户允许补位后显示。界面文本直接说明动作和后果，不显示 token、canonical signature、硬屏蔽等实现术语。

分析完成后页面滚动到结果。右侧固定导航可回到目标或结果。前十名使用同一组标签切换，一次只显示一套配装。每枚因子独立显示主词条、副词条、因子等级和库存实例；结果有替代主词条、缺少指定主词条或带有需避开技能时，在标签和结果顶部同时提示，不能只改颜色。

### 19.2 本地缓存

方案使用稳定 ID，名称可修改。目标草稿自动保存；结果只在求解成功或确定无解后更新。缓存记录目标指纹、库存指纹、其他方案已占用实例集合、随机种子、排序版本和计算时间。目标、库存或占用变化时保留旧结果，但禁止直接确认，直到重新计算。

### 19.3 多角色因子占用

确认配装占用具体实例，不占用整个技能组合。实例身份由存档中的 `gemUnitId`、库存槽位和有序主副词条共同确定。同词条、同等级的其他因子仍可分配给其他角色。

两个已确认方案发生实例冲突时，后一次确认失败并列出旧方案。未确认的缓存不阻止确认，但若缓存结果用到了刚被占用的实例，就标记为需要重算。库存更新后不自动用相同词条替换缺失实例。

### 19.4 求解触发边界

只有“开始分析”和“重新计算”启动求解器。切换方案、编辑目标、读取存档、确认或取消确认都只改变状态。运行中的请求保存 `runId` 和输入指纹；返回时输入已经变化，则丢弃结果。完整设计见 [ADR-0010](architecture/adr/0010-cache-reservations-and-analysis-state.md)。

### 19.5 目标分组、技能图标和已确认配装

目标编辑区分为“想要的技能”和“需要避开的技能”两组。前者包含必须满足、指定基础主词条、可接受的替代主词条和可选目标；后者包含不能出现与尽量避开。分组只是界面层级，不改变求解字段和排序规则。

技能图标通过独立资源适配器按技能 ID 映射，技能池、目标标签、结果卡共用同一组件。当前固定数据源只有 97 个普通技能能关联到 49 个实际使用的 PNG 文件；角色技能的上游映射多数是角色头像，不作为技能图标使用，其余项显示一致的类别占位图标。上游仓库没有开源许可证，当前图片只用于本地验证；公开发行前必须取得再分发许可，或者切换为用户自行导入的图标包。

“已确认配装”是独立的只读浏览入口，进入、切换和关闭都不会触发求解。确认记录保存唯一显示名、来源方案 ID、确认时名称、目标快照、结果快照、实例键、库存指纹和确认时间。重名按首个可用后缀分配，例如 `方案`、`方案 -1`、`方案 -2`。
