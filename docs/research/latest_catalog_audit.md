# GBFR Ver. 2.0.2 技能与因子目录审计

> 审计日期：2026-07-22（Asia/Shanghai）
> 适用版本：Windows / Steam，《Granblue Fantasy: Relink - Endless Ragnarok》Ver. 2.0.2
> 审计范围：因子技能分类、当前后追加技能、第三方目录完整度、中文显示名与再分发边界
> 结论用途：决定第一版“存档读取 → 因子配装求解”允许进入正式目录的数据；不用于解释完整战斗公式。

## 执行结论

1. 截至本次审计，官方当前版本基线是 **Ver. 2.0.2（2026-07-08）**。该版本加入了新因子、因子/祝福石筛选条件，以及 Beatrix、Eustace、Gallanza、Maglielle、Fraux、Fediel 六名角色。[官方简体中文更新说明](https://relink-ragnarok.granbluefantasy.com/chs/updates/381/)；[官方英文更新说明](https://relink-ragnarok.granbluefantasy.com/en/updates/381/)
2. 游戏原生因子分类只有五类，顺序固定为 **Basic Stats → Attack → Defense → Support → Special**。`Character-Specific`、`Weapon-Exclusive`、`normal`、`special_sigil` 等是来源或第三方数据分组，不是第六种原生因子分类。[Relink Wiki: Sigils](https://relink.gbf.wiki/Sigils)；[Relink Wiki: Traits](https://relink.gbf.wiki/Traits)
3. 中文 UI 可先使用 **基础能力、攻击、防御、辅助、特殊**。其中英文名、顺序和五类结构已由 2.0.2 游戏画面及当前 Wiki 交叉确认；本轮没有取得 2.0.2 简体中文资源表逐字校验“基础能力”，所以代码必须以 `basic/attack/defense/support/special` 为稳定键，中文仅作可替换显示文案。不要把 `Basic Stats` 翻成“主属性”，以免和“主词条”混淆。
4. 当前公共 Wiki 是最完整的人工核验基线，但它不是可无条件打包的数据库；页面内容采用 **CC BY-NC-SA 3.0**。直接复制整表、效果描述或图片会带来署名、非商业和相同方式共享义务。[Wiki 页面许可声明](https://relink.gbf.wiki/Traits)；[CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/)
5. `choeki/gbfr-relink-sim` 当前种子已经覆盖许多 2.0.2 通用词条和六名新角色名，但仍有确定错误和缺口：它把 **Super Ultimate Perfect Dodge（超终极精准闪避）误标为 Defense，当前 Wiki 将其归为 Attack**；六名新角色的 22 个专属 Trait 只有不完整的 `HASH_*` 骨架，尚无闭合的因子物品定义；部分特殊因子只有 Wiki 占位或完全缺失。因此只能作为线索和交叉检查，不能直接成为生产目录。
6. `choeki/gbfr-relink-sim` 与 `BitterG/GBFR-PE-Patch-Tool` 均未提供许可证。不得直接复制其代码、JSON、中文翻译和图片到本项目。`Nenkai/GBFRDataTools` 使用 MIT 许可证，可以作为**开发期提取器**使用并保留许可声明；MIT 只覆盖工具代码，不会自动授权再分发从游戏中提取的文本、表格或美术资源。

## 证据优先级与版本基线

本审计按以下顺序处理冲突：

1. **游戏本体 / 官方更新说明**：决定版本、系统是否存在和可见 UI 行为。
2. **当前 Relink Wiki**：用于核验公开技能名、五类归属、最大等级和装备来源；遇到内部 hash 时不能单独作为真值。
3. **由本地合法游戏副本独立提取的数据表**：用于建立存档 hash、物品 ID 与 Trait ID 映射；每个版本都应重新生成并做差异审计。
4. **第三方项目及社区清单**：只作发现线索和交叉验证；除非许可证、版本和字段来源都明确，否则不进入正式目录。

官方 2.0.2 更新说明只声明“加入新因子”等系统变化，并没有列出完整的因子和 Trait 数据库。因此“官方最新版”不等于“存在可下载的官方目录”。本项目仍需要独立提取与人工核验两条链路。

建议目录清单固定记录：

```text
gameVersion = "2.0.2"
catalogRevision = <本项目自增版本>
builtAt = <UTC timestamp>
sources[] = { url, revisionOrCommit, accessedAt, fieldsUsed, license, confidence }
```

发现未知 hash 时，读取器应保留原始记录并标为 `unknown`，不能静默丢弃，也不能把它猜成名称相似的既有 Trait。

## 原生五类与显示顺序

当前 [Sigils](https://relink.gbf.wiki/Sigils) 页面明确说明主 Trait 决定因子类别和外观；[Traits](https://relink.gbf.wiki/Traits) 页面按五类列出当前 Trait。原生顺序如下：

| 顺序 | 稳定键 | 英文原名 | 第一版中文显示 | 已核验的基础成员/示例 | 说明 |
|---:|---|---|---|---|---|
| 1 | `basic` | Basic Stats | 基础能力 | Attack Power、Health、Critical Hit Rate、Stun Power | 只有四个基础成员；“主词条”是位置概念，不是本类名称 |
| 2 | `attack` | Attack | 攻击 | Damage Cap、Supplementary DMG、Berserker Echo、Spartan Echo、Super Ultimate Perfect Dodge、Celestial 系列、Fatebreaker | 当前新增/后追加条目最多，也是第三方误分类风险最高的一类 |
| 3 | `defense` | Defense | 防御 | Aegis、Guts、Potion Hoarder 等 | 不应接收 Super Ultimate Perfect Dodge |
| 4 | `support` | Support | 辅助 | Quick Cooldown、Cascade、Divergence 等 | `Divergence` 属于本类 |
| 5 | `special` | Special | 特殊 | War Elemental、Flight over Fight、Immortal Shell、In a Pinch、Sumo Force 等 | 多数带固定、来源或升级例外，不能凭普通 V+ 规则推导 |

以下字段必须分开保存：

```text
trait.category       // 上述五类之一
sigil.primaryTrait   // 决定该因子的原生类别
sigil.family         // normal / character / opus / special 等物品来源分组
trait.sourceKinds    // sigil / weapon / wrightstone / summon
trait.characterIds   // 角色限制；非空不意味着出现了第六种类别
```

当前 Wiki 的 Traits 页面还单独列出 `Weapon-Exclusive`。这是“只来自武器”的装备来源范围，不是因子分类，默认必须从因子目标选择器排除。

## 当前必须覆盖的后追加 Trait

下表以“当前配装目录容易漏掉或误分”为筛选标准，不把它误称为“全部都是 2.0.2 新增”。Berserker Echo、Spartan Echo、Super Ultimate Perfect Dodge 等来自更早更新，但在当前目录中必须存在。

| 英文稳定名 | 第一版可用中文名 | 原生分类 | 当前可确认状态 | 数据处理要求 |
|---|---|---|---|---|
| Berserker | 穷寇心 | Attack | `traitHash=0x70395731`；普通 `Berserker V+` 物品 hash `0x83E5006E` | 与 Berserker Echo 分开，绝不能把二者都显示为“狂战士” |
| Berserker Echo | 狂战士 | Attack | `traitHash=0xEE85CD1F`；`Berserker Echo+` 物品 hash `0x332E9B30` | 当前 Wiki 描述为达到攻击力阈值后提供独立追击；固定作为不同 Trait 计数 |
| Spartan Echo | 斯巴达 | Attack | `traitHash=0x3D8153A1`；`Spartan Echo+` 物品 hash `0x938DB625` | 不归为 Defense |
| Super Ultimate Perfect Dodge | 超终极精准闪避 | **Attack** | `traitHash=0x51C115D2`；物品 hash `0xBBE831B2`；当前 Wiki 的 Traits 与 `Module:Inventory` 均归 Attack | 覆盖 `choeki` 种子中的 `defense` 错误，并添加回归测试 |
| Celestial Nyx | 天星之练 | Attack | 当前 Wiki 有条目；第三方种子有 hash | 中文为第三方非官方译名，发布前从简中资源表逐字核验 |
| Celestial Lumen | 天星之煌 | Attack | 同上 | 同上 |
| Celestial Terra | 天星之界 | Attack | 同上 | 同上 |
| Celestial Ventus | 天星之止息 | Attack | 同上 | 同上 |
| Celestial Incendo | 天星之焰 | Attack | 同上 | 同上 |
| Celestial Aqua | 天星之雪 | Attack | 同上 | 同上 |
| Fatebreaker | 浪迹天涯 | Attack | 当前 Wiki 有条目；第三方种子同时存在真实 hash 条目和 `WIKI_*` 重复占位 | 中文先标 `provisional`；去重时按 hash，不按英文名硬合并 |
| Divergence | 分歧 | Support | 当前 Wiki 有条目；第三方种子有 hash | 中文先标 `provisional` |
| Immortal Shell | 暂用英文名 | Special | 当前 Wiki 有条目；第三方种子只有无 hash 的 `WIKI_IMMORTAL_SHELL` 和推测性物品占位 | 未从本地表取得可靠 ID/hash 前，不进入正式可选目录 |
| In a Pinch | 暂用英文名 | Special | 当前 Wiki 有条目；`choeki` 当前种子缺失 | 同上；不能因种子缺失而判定存档中的相关因子非法 |
| Sumo Force | 暂用英文名 | Special | 当前 Wiki 有条目；第三方种子只有无 hash 的 `WIKI_SUMO_FORCE`，无闭合因子物品 | 同上 |

中文名的状态应当机器可读：

```text
nameZh.status = verified_game_string | community_provisional | fallback_english
nameZh.source = <game table / source URL / null>
```

不要让非官方中文名参与去重、存档识别或数据库外键。稳定身份应优先采用游戏 Trait ID；没有 ID 时采用核验后的 uint32 hash，并保留版本范围。

### “狂战士”命名冲突

这是当前最容易造成真实数据损坏的本地化问题：

- 英文 `Berserker` 对应第三方简中名 **穷寇心**，Trait hash `0x70395731`。
- 英文 `Berserker Echo` 对应第三方简中名 **狂战士**，Trait hash `0xEE85CD1F`。

社区 1.3 因子清单也把 `狂战士+`、`斯巴达+`、`超终极精准闪避+` 分别对应到 `0x332E9B30`、`0x938DB625`、`0xBBE831B2`，可作为中文显示的交叉证据，但不是官方本地化授权来源。[社区 1.3 因子清单](https://www.bilibili.com/opus/939545446286622741)

## 第三方目录完整度审计

### `choeki/gbfr-relink-sim`

- 仓库：[choeki/gbfr-relink-sim](https://github.com/choeki/gbfr-relink-sim)
- 审计 commit：[`6aba7fc633e870de65f26c01462cdbe1dd6b6baa`](https://github.com/choeki/gbfr-relink-sim/commit/6aba7fc633e870de65f26c01462cdbe1dd6b6baa)
- 数据文件：[该 commit 的 `src/data/seed.json`](https://github.com/choeki/gbfr-relink-sim/blob/6aba7fc633e870de65f26c01462cdbe1dd6b6baa/src/data/seed.json)

本次统计：

| 项目 | 数量/状态 | 审计解释 |
|---|---:|---|
| Traits | 212 | 其中 97 个 `category=null`，不能直接驱动分类 UI |
| Sigils | 189 | 第三方 `category` 是物品族分组，不等于原生五类 |
| Characters | 29 | 包含 Gran/Djeeta 分列及 2.0.2 六名新增角色 |
| Weapons | 126 | 与因子目标目录应隔离 |
| Summons | 151 | 与因子目标目录应隔离 |
| 已标五类的 Trait | Basic 4 / Attack 51 / Defense 29 / Support 10 / Special 21 | 仍包含至少一项已确认误分类，数量完整不代表字段正确 |

其 `meta.source` 声称数据从 `GBFR.PE.Patch.Tool embedded data` 提取于 2026-07-16，并明确写着“中文名为非官方译名”。目前可确认的缺口：

- **确定误分类**：`Super Ultimate Perfect Dodge` 被写成 `defense`，而当前 Wiki Traits 与 Wiki `Module:Inventory` 都将它放在 Attack；模块物品图和筛选标签也是 Attack。[Relink Wiki: Module:Inventory](https://relink.gbf.wiki/Module%3AInventory)
- **六名新角色专属目录未闭合**：Beatrix 3、Eustace 4、Fraux 3、Fediel 4、Gallanza 4、Maglielle 4，共 22 个 Trait 主要以 `HASH_*` 形式存在，常见 `category` 留空、`canPrimary=false`、`canSecondary=false`，没有对应的完整角色专属因子物品定义。
- **特殊条目缺失/占位**：Auto Potion 有 Trait 但无可靠因子物品定义；Immortal Shell、Sumo Force 只有无 hash 的 Wiki 占位；In a Pinch 缺失。
- **重复记录**：Fatebreaker 同时存在有 hash 的真实条目和无 hash 的 `WIKI_FATEBREAKER`。
- **效果覆盖不足**：项目自己的 `missing-trait-effects.md` 仍记录大量缺失描述，其中大部分是角色专属。名称或 hash 存在不等于效果、来源和资格规则完整。
- **副词条规则仍是草稿**：上游 TODO 明确要求以后从真实 `gem` 表和 `SkillTypeLotIdForRandom2ndSkill` 等 lot 表补全，当前 GUI 规则不能当作游戏真值。
- **无许可证**：根目录没有 `LICENSE` / `COPYING`；公开仓库不等于允许复制和再分发。

结论：可借鉴它把 Trait、Sigil 实例和装备来源分离的建模思路；实际数据只作测试 oracle 之一，不应 vendor 进仓库。

### `BitterG/GBFR-PE-Patch-Tool`

- 仓库：[BitterG/GBFR-PE-Patch-Tool](https://github.com/BitterG/GBFR-PE-Patch-Tool)
- 审计 commit：[`b6ff3c76e102a2183d5ebd595f4329f2e79cc7da`](https://github.com/BitterG/GBFR-PE-Patch-Tool/commit/b6ff3c76e102a2183d5ebd595f4329f2e79cc7da)

当前数据约有 166 个 Trait 和 187 个因子。仓库自己的说明把 `traits.json` 称为 draft，把 `sigils.json` 称为 reduced catalog，把 `secondary-trait-rules.json` 称为不完整规则库；TODO 还要求从真实 gem 表补分类、等级和副词条池。因此它不是完整权威目录，也不能因为被另一项目写在 `meta.source` 中就升级为权威来源。

该仓库同样没有 `LICENSE` / `COPYING`。本项目可以用它定位需要独立验证的表和字段，但不能复制代码或数据。

### `Nenkai/GBFRDataTools`

- 仓库：[Nenkai/GBFRDataTools](https://github.com/Nenkai/GBFRDataTools)
- 审计 commit：[`92064d46062fd0649f972470492278f1f5577884`](https://github.com/Nenkai/GBFRDataTools/commit/92064d46062fd0649f972470492278f1f5577884)
- 许可证：[MIT（审计 commit）](https://github.com/Nenkai/GBFRDataTools/blob/92064d46062fd0649f972470492278f1f5577884/LICENSE.txt)

这是 archive / `.tbl` / SQLite 等格式的通用提取与转换工具，不是开箱即用的 2.0.2 因子目录。README 的已知路径说明仍以 2.0.0 为主，所以必须用实际 2.0.2 安装内容验证路径和 schema。

推荐使用方式：在开发或用户本机上，用 MIT 工具从合法安装副本独立提取 `gem`、Trait 状态和本地化映射，再由本项目的转换器生成最小事实目录。复用工具代码要保留 MIT copyright 和 license notice。不要把“MIT 工具”误解为“它读出的 Cygames 文本、图标、整张表也变成 MIT”。

## 当前数据缺口与发布阻断项

| 优先级 | 缺口 | 对第一版的影响 | 关闭条件 |
|---|---|---|---|
| P0 | 2.0.2 `gem` / Trait / 简中本地化表尚未由本项目独立提取 | 无法保证所有存档 hash 都能识别 | 从合法 2.0.2 安装副本生成带版本与来源的 hash 映射，并与存档样本回归 |
| P0 | 六名新角色专属 Trait 与因子物品关系不完整 | 新角色库存可能显示未知，目标选择器会漏项 | 每个可装备因子都有物品 hash、主/副 Trait、等级范围、角色限制和来源证据 |
| P0 | Super Ultimate Perfect Dodge 第三方分类错误 | 分类筛选与按类别计数会产生错误结果 | 在本项目目录强制为 Attack，并以 Wiki + 游戏表/画面建立回归 fixture |
| P1 | Immortal Shell、In a Pinch、Sumo Force、Auto Potion 等特殊条目不闭合 | 读取能保留原始记录，但无法稳定显示或选择 | 取得真实 ID/hash、等级范围、主副资格和简中名称 |
| P1 | 普通 V+ 完整副词条池和合成后例外未从 lot 表闭合 | 如果以后做合成规划器会给出不可能结果 | 从真实 lot 表生成版本化允许/禁止集合；当前库存求解器只相信存档中的真实实例 |
| P1 | 中文名大批来自非官方翻译 | 可能同名合并、误导用户 | 从简中 string table 建立 `verified_game_string` 映射；未核验者显式标记或回退英文 |
| P2 | 当前 Wiki 的效果描述与第三方缺失效果不一致 | 第一版按出现次数求解不受影响 | 做效果计算器前逐项用游戏表/实测校验，不能复制 Wiki 长描述 |

第一版可以在 P1 未完全关闭时发布，但必须满足两个降级原则：

- 存档中未知的因子仍显示原始 hash、等级和槽位，用户可导出诊断包；它不参与错误的名称匹配。
- 目标选择器只展示通过目录准入的 Trait。不要为了“看起来完整”把 `WIKI_*`、无 hash 占位或 weapon-only Trait 混进列表。

## 许可与可再分发边界

| 来源 | 当前许可/权利状态 | 可以做 | 默认不要做 |
|---|---|---|---|
| Cygames 官方网页与游戏本体 | 未提供开放数据/素材许可证 | 引用更新事实与链接；从用户合法安装中在本机解析必要 ID | 打包官方图标、截图、整段效果文本、原始资源表 |
| Relink Wiki | CC BY-NC-SA 3.0 | 作为人工核验来源；短句转述并链接 | 在计划闭源或商业分发的应用内复制整张表、长描述和图片；除非接受署名、非商业和相同方式共享义务 |
| `choeki/gbfr-relink-sim` | 无许可证 | 研究 schema、比对 hash、发现缺口 | 复制代码、JSON、非官方中文翻译、图片或把仓库快照打包发布 |
| `GBFR-PE-Patch-Tool` | 无许可证 | 定位表名、验证研究假设 | 复制实现或嵌入其 draft 数据 |
| `GBFRDataTools` | MIT | 依许可证复用工具代码，保留版权和许可声明 | 宣称提取结果自动归 MIT；随应用分发游戏资源而不另行审查 |
| 本项目独立整理的最小映射 | 仍需逐字段记录来源 | 保存 `id/hash/category/version` 等必要事实，配合自制 UI 图标与短名称 | 混入无法证明来源的整段描述、社区翻译或游戏美术后再宣称完全自有 |

以上是工程侧风险边界，不构成法律意见。如果工具计划商业分发，发布前仍应进行正式许可审查。

## 建议的正式目录准入规则

### 可以进入默认目标选择器

一个 Trait 至少同时满足：

1. 有稳定的游戏 Trait ID 或经本地 2.0.2 表验证的 uint32 hash；
2. `sourceKinds` 明确包含 `sigil`；
3. 五类归属已由游戏数据/画面与至少一个当前参考源交叉确认；
4. 主/副位置资格未知时不会被 UI 伪装成“任意组合”；
5. 中文未核验不会影响身份判断，且能回退英文稳定名。

### 只能进入诊断目录

- `WIKI_*`、`GAME_*` 等无真实 ID/hash 的占位；
- 只有名称但没有装备来源的 Trait；
- weapon-only、summon-only 条目；
- hash 已见于存档但物品定义、分类或角色限制未闭合的条目；
- 相同英文名出现多个记录且尚未通过 hash/版本去重的条目。

### 回归测试最小集合

```text
Berserker               -> attack, hash 0x70395731, zh “穷寇心”
Berserker Echo          -> attack, hash 0xEE85CD1F, zh “狂战士”
Spartan Echo            -> attack, hash 0x3D8153A1
Super Ultimate Perfect Dodge -> attack, hash 0x51C115D2
Divergence              -> support
Weapon-Exclusive sample -> excluded from sigil picker
unknown save hash       -> preserved, not silently discarded
```

此外应为一个同技能不同实例、同一因子主副顺序相反、角色专属限制、固定组合特殊因子分别建立 fixture。目录更新若改变稳定键、hash、五类归属或可选范围，CI 必须显示逐项 diff 并要求人工确认。

## 推荐落地路线

1. 用 `GBFRDataTools` 或等价的自研只读解析流程，从 2.0.2 本地安装副本导出必要表，不把原始表提交仓库。
2. 生成仅含事实字段的中间 manifest：`traitId/hash/itemHash/category/sourceKind/version/localizationKey`。
3. 对照当前 [Traits](https://relink.gbf.wiki/Traits)、[Sigils](https://relink.gbf.wiki/Sigils) 和 [Module:Inventory](https://relink.gbf.wiki/Module%3AInventory) 查异常；Wiki 仅写入 `sourceEvidence`，不要直接复制描述正文。
4. 从游戏简中 string table 解析显示名，并给每个名称写入验证状态；社区名只作临时 fallback。
5. 将正式目录与诊断目录分开发布。读取存档时以 hash 为入口，求解器以稳定 Trait ID 为入口，UI 以本地化层展示。
6. 每次官方更新都重新提取并生成目录 diff；未知 hash 数量、第三方占位数量和未核验中文名数量应成为发布门禁指标。

## 主要来源

- [Cygames：Ver. 2.0.2 简体中文更新说明](https://relink-ragnarok.granbluefantasy.com/chs/updates/381/)
- [Cygames：Ver. 2.0.2 英文更新说明](https://relink-ragnarok.granbluefantasy.com/en/updates/381/)
- [Relink Wiki：Sigils](https://relink.gbf.wiki/Sigils)
- [Relink Wiki：Traits](https://relink.gbf.wiki/Traits)
- [Relink Wiki：Module:Inventory](https://relink.gbf.wiki/Module%3AInventory)
- [choeki/gbfr-relink-sim](https://github.com/choeki/gbfr-relink-sim)
- [BitterG/GBFR-PE-Patch-Tool](https://github.com/BitterG/GBFR-PE-Patch-Tool)
- [Nenkai/GBFRDataTools](https://github.com/Nenkai/GBFRDataTools)
- [Creative Commons BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/)
