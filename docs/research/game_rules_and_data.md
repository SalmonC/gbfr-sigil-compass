# GBFR 因子、技能与结构化数据核查

> 调研日期：2026-07-22（Asia/Shanghai）
> 适用基线：Windows / Steam，《Granblue Fantasy: Relink - Endless Ragnarok》Ver. 2.0.2
> 目的：为“读取持有因子 → 按目标多重集合求解配装”的数据模型和求解器划清边界
> 说明：中文译名在不同项目和游戏版本之间并不完全一致；本文以英文名和内部 ID 作为稳定标识，中文只作显示。

## 结论摘要

1. 游戏内正式分类是五类：**Basic Stats（基础属性）、Attack（攻击）、Defense（防御）、Support（辅助）、Special（特殊）**。完整角色最多装备 **12 个因子**；一个因子的**主词条决定因子类别和图标**。副词条在效果和数值上与同名主词条相同，但 2.0.2 新增的 Master Traits 会按“因子类别”计数，所以主副顺序已经具有构筑含义，不能把 `A&B` 与 `B&A` 合并成同一方案。[Relink Wiki: Sigils](https://relink.gbf.wiki/Sigils)
2. 普通 V / V+ 的常规等级区间是 **Lv11–15**。V+ 的“+”表示存在第二词条，而不是更高的等级上限；升级把因子词条等级提高到 15。因子合成通常产出 Lv11，Grand Success 产出 Lv15。[Nenkai: Sigil Synthesis Grand Success](https://nenkai.github.io/relink-modding/resources/re/mechanics/gem_mix/)
3. 天然掉落默认不能在同一因子上出现两个同类别词条；社区对基础版掉落池的长期记录还显示副词条类别遵循 `Basic Stats > Attack > Defense > Support > Special` 的方向。但 **Sigil Synthesis（因子合成）会绕过同类别限制**，可以得到 `Damage Cap & Supplementary DMG`、`Damage Cap & Damage Cap`、`Supplementary DMG & Supplementary DMG`。因此这些并非“非法存档”，也不能在求解器中被排除。[Relink Wiki: Sigils](https://relink.gbf.wiki/Sigils)；[GameFAQs: Manipulating Sigils](https://gamefaqs.gamespot.com/ps5/308486-granblue-fantasy-relink/faqs/82470/manipulating-sigils)
4. 相同 Trait 会把等级相加，来自因子、武器、祝福石等来源的同名 Trait 共同受该 Trait 的最大等级限制。用户当前需求是按“出现次数”匹配目标，而不是按有效等级匹配；两者应当在产品中保持两个独立概念。[GameFAQs: Sigils](https://gamefaqs.gamespot.com/ps5/308486-granblue-fantasy-relink/faqs/82470/sigils)
5. 角色专属、Alpha/Beta/Gamma、War Elemental、Stout Heart、Berserker Echo、Spartan Echo、Flight over Fight、新版螃蟹因子和武器专属词条等都有固定组合、角色限制、固定等级或不可合成等例外。**“有两个词条”不等于“可参与因子合成”**。
6. `choeki/gbfr-relink-sim` 很适合借鉴 schema 和内部 ID 映射，但截至指定 commit：数据仍有临时值、未知 hash、2.0.2 新角色专属因子缺口，而且仓库**没有许可证**。不可直接复制代码、JSON、翻译和图片到本项目；应把它当作线索，再从 MIT 许可的 `Nenkai/GBFRDataTools`、游戏表和自行校对的本地化数据重建。[choeki/gbfr-relink-sim](https://github.com/choeki/gbfr-relink-sim)

## 版本基线为什么必须先固定

官方更新页显示 Ver. 2.0.2 于 2026-07-08 上线，伴随《Endless Ragnarok》加入新因子、Master Traits、召唤石等系统。[Cygames: Updates](https://relink-ragnarok.granbluefantasy.com/en/updates/) 这不是只影响技能列表的资料更新：

- Master Traits 包含“每装备一个 Basic Stats 类因子提升伤害上限”等按类别计数的效果；当前资料明确有 `DMG Cap +20% per Basic Stats-type sigil equipped (max sigils: 5)`。[RPG Site: All Character Master Traits](https://www.rpgsite.net/guide/20796-granblue-fantasy-relink-endless-ragnarok-all-characters-master-traits)
- 因子类别由**主词条**决定，社区在 2.0.2 实测中确认副词条的类别不计入这类 Master Trait。因此 `昏厥&伤害上限` 与 `伤害上限&昏厥` 即便两个技能完全相同，也不是可互换的展示别名。[Relink Wiki: Sigils](https://relink.gbf.wiki/Sigils)；[Reddit: current endgame explanation](https://www.reddit.com/r/GranblueFantasyRelink/comments/1uu3wif/the_new_sigils_can_replace_34_damage_cap_slots/)
- 新版加入 Celestial 系列、Fatebreaker、Divergence、Immortal Shell、Sumo Force 等因子/词条，以及一批仅存在于 Weapon Transcendence 的词条。[RPG Site: New Sigils](https://www.rpgsite.net/guide/20836-granblue-fantasy-relink-endless-ragnarok-all-new-sigils-their-trait-effects-how-you-get-them)

建议数据包明确写入：

```text
gameVersion = "2.0.2"
dataSchemaVersion = <本项目自增版本>
dataBuiltAt = <UTC 时间>
sourceManifest = [{ source, revision, accessedAt, confidence }]
```

应用解析存档时若发现未知 `sigilHash` / `traitHash`，应保留原始记录并提示“数据包落后”，不能静默丢弃。

## 已确认的基础规则

### 因子栏位与类别

- 完整强化角色最多有 **12 个因子栏**；栏位来自角色 Mastery 和 Fate Episodes。[Relink Wiki: Sigils](https://relink.gbf.wiki/Sigils)
- 五类为：`basic`、`attack`、`defense`、`support`、`special`。
- 主词条决定因子类别和外观；副词条的效果不因位置改变。
- 但 2.0.2 的类别计数型 Master Traits 看的是因子类别，也就是主词条类别。故主副顺序必须保留。

对本工具的直接影响：

- 默认槽位上限是 12；目标栏最多 24 个“词条出现次数”与用户原需求一致。
- 数据模型不能只保存无序 `{traitA, traitB}`；必须保存 `primaryTrait` 与 `secondaryTrait`。
- 结果可以在“所选实例”层面无序排列，但单个因子内部不可交换主副。

### V、V+、等级和强化

- Rank V 是常规最高稀有等级；常规 V 因子初始 Trait Lv11、最高 Lv15。
- `+` 表示因子有第二个 Trait。V+ 的两个 Trait 都贡献等级。
- 因子可在铁匠处逐级强化；Azurite's Splendor 可直接将 V/V+ 提到该 Rank 的最高等级。
- 合成把两个可合成 V+ 的四个 Trait 放入池中、打乱后取两个。普通成功的新因子 Lv11；Grand Success 为 Lv15；Grand Success 概率由作为材料的四个 Trait 等级总和决定。[Nenkai: Sigil Synthesis Grand Success](https://nenkai.github.io/relink-modding/resources/re/mechanics/gem_mix/)

需要纠正原始描述中的一个措辞：**最低 Lv11、最高 Lv15 适用于普通 Rank V / V+，并非所有特殊因子的统一规则。** 例如 Alpha/Beta/Gamma 的 Trait 总上限是 30、Immortal Shell 是 20、Crabby Resonance/Crabmiration 是 45；某些单档特殊 Trait 固定为 15。这里的“单个因子携带的等级”和“同名 Trait 汇总后的最大等级”也不是同一概念。[Relink Wiki: Traits](https://relink.gbf.wiki/Traits)

### 同名技能叠加与上限

- 多个同名 Trait 的等级会相加；武器等其他来源也会加入同一总等级。
- 最终效果受 Trait 自己的最大等级限制；超过上限的等级没有进一步效果。
- `Sigil Booster` 会给装备中的每个因子 Trait 增加等级，因此“因子物品等级总和”“Trait 原始等级总和”“计入 Booster 后有效等级”和“封顶后有效等级”应是四个不同字段/计算值。
- Alpha/Beta/Gamma 等说明为“与普通 DMG Cap 叠加”的独立 Trait，不应错误合并成普通 Damage Cap 的等级。[Relink Wiki: Traits](https://relink.gbf.wiki/Traits)

本工具第一版的目标语义仍可保持简单：目标 `追击 ×3` 是要求被选 12 个因子的 24 个词条槽中 `Supplementary DMG` 出现至少 3 次。若一个合成因子是 `追击&追击`，它贡献 2 次。这个“多重集合计数”与游戏最终效果是否已经封顶无关。

## 主词条、副词条与合成例外

### 天然掉落规则和合成规则必须分开

天然掉落的普通 V+ 默认不允许两个同类别 Trait。基础版玩家统计还观察到副词条类别按以下方向产生：

```text
Basic Stats → Attack → Defense → Support → Special
```

例如天然掉落想得到 `Damage Cap + Critical Hit Rate` 时，通常应由 `Critical Hit Rate` 做主词条，因为 Basic Stats 排在 Attack 前。这个“类别方向”来自社区样本，不是官方公开表，应标为**中等置信度、仅用于解释天然掉落**。[GameFAQs: Sigil and Wrightstone Info](https://gamefaqs.gamespot.com/boards/308486-granblue-fantasy-relink/80690062)

合成的规则不同：

- 仅接受满足游戏合成资格的 Legendary `+` 因子。
- 结果从材料的四个 Trait 中取两个。
- 可以绕过同类别限制，也可以取两个完全相同的 Trait。
- 因而用户示例 `追击&伤害上限 ×2 + 伤害上限&追击` 是现实可存在的合成结果组合；不应视为作弊因子。
- 含“只有 Lv15 一个档位”的 Trait 的因子不可作为合成材料。Wiki 明列角色专属、War Elemental、Berserker Echo、Spartan Echo 等；社区资料还将 Flight over Fight、Stout Heart 等固定 Lv15 特殊项列为同类例外。[Relink Wiki: Sigil Synthesis](https://relink.gbf.wiki/Sigil_Synthesis)
- Alpha/Beta/Gamma 是固定主词条 + Damage Cap 的特殊 V+，社区实测不能作为普通合成材料；数据模型应为它们设置显式 `synthesisEligible=false`，不要仅凭名字带 `+` 推导资格。

求解器只需要验证“这个实例是否真实存在于存档”，不需要验证它当初是否能天然掉落。掉落/合成合法性只在将来做“合成规划器”时才有用。

### 只能主词条、固定副词条和不存在的“仅副词条”

截至 2.0.2，可确认的模式如下：

| 模式 | 例子 | 求解/数据含义 |
|---|---|---|
| 通用主/副均可 | Damage Cap、Supplementary DMG、Stamina、Aegis、Quick Cooldown 等 | 可在存档两个 Trait 槽中出现；合成可改变顺序 |
| 正常只作主词条/不可成为通用副词条 | Stout Heart、Natural Defenses、War Elemental、Flight over Fight、Berserker Echo、Spartan Echo、Super Ultimate Perfect Dodge、Crabby Resonance、Crabvestment Returns、Dark Amity 等 | 仍可能存在带普通副词条的 `+` 因子，但这些特殊 Trait 本身不进入通用副词条池 |
| 固定第二词条 | Alpha+/Beta+/Gamma+ 固定带 Damage Cap；Awakening+ 固定带该角色的第二专属 Trait；Eternal Crab+ 固定带 Crabmiration | `defaultSecondaryTraitId` / `fixedPair=true`，不可按通用副词条池解释 |
| 武器专属，不能作为因子目标 | Sigil Booster、Catastrophe/Catastrophe Nova、Supernova、各 Weapon Transcendence DMG Cap 词条、Unbound 系列等 | Trait 数据库中要标 `sourceKind=weapon`，默认从因子选择器排除 |
| 仅副词条 | **本轮未找到经验证的通用 Trait** | 不要为此硬编码空规则；保留 capability 字段即可 |

上表中的“正常只作主词条”以当前游戏行为、Wiki 和 `choeki` 数据交叉核对。`choeki` 的当前 `canPrimary/canSecondary` 仍有人工修补和未知项，不能视为权威真值。

## 角色专属、终末与其他特殊因子

### 角色专属因子

- 角色专属 Trait 只能对对应角色生效/装备，必须带 `characterId` 或 `allowedCharacterIds`。
- 基础角色通常有两个早期专属 Trait、一个 Warpath Trait；`Awakening+` 是前两个专属 Trait 的固定二合一，不包含 Warpath。[GameFAQs: Character-Specific Sigils](https://gamefaqs.gamespot.com/ps5/308486-granblue-fantasy-relink/faqs/82470/character-specific-sigils)
- 单一角色专属 `+` 可带一个普通副词条；Awakening+ 的两个专属 Trait 固定。角色专属含固定 Lv15 Trait，不能用于普通因子合成。
- 社区长期记录显示同一角色的 Awakening+ 在获取池中采用 knockout 机制：持有时不再掉第二枚，但单专属 + 普通副词条可以有重复。这个库存生成规则对“读取既有库存并求解”没有约束作用，只用于解释数量，置信度中等。[GameFAQs: duplicate Awakening sigils](https://gamefaqs.gamespot.com/boards/308486-granblue-fantasy-relink/80693483)
- 2.0.2 新增 Beatrix、Eustace、Fraux、Fediel、Gallanza、Maglielle。当前 `choeki` 数据只出现这些角色的名字、头像和一批未解析 `HASH_*` 专属 Trait，尚未形成完整可选专属因子定义，因此不能宣称覆盖完整 2.0.2。

### Alpha / Beta / Gamma（终末/Opus 类）

- Alpha+、Beta+、Gamma+ 的主 Trait 各自最高 Lv30；单个因子通常提供 Lv11–15，需要多枚叠加到 30。
- 三者固定副词条是 Damage Cap。
- 三者的伤害上限效果与普通 Damage Cap Trait 分开叠加。
- 它们不能按普通 V+ 合成规则处理。

### 固定 Lv15 和其他特殊项

固定/单档 Trait 常见例子包括 War Elemental、Stout Heart、Flight over Fight、Untouchable、Berserker Echo、Spartan Echo、Super Ultimate Perfect Dodge。它们可能有 `+` 版本并带第二 Trait，但“自身固定 Lv15”和“第二 Trait 的等级”必须分别保存。

新版 Celestial、Fatebreaker、Divergence 等已能作为因子 Trait；Immortal Shell、Sumo Force、Dark Amity、Eternal Crab+ 则带有特殊升级或固定组合语义。第一版求解器不需要理解效果公式，只要：

- 能从存档 hash 映射成稳定 Trait ID；
- 保留主副位置和各自等级；
- 用 `sourceKind`、`fixedPair`、`characterRestriction`、`synthesisEligible` 等元数据防止 UI 误导。

### 存档技能等级字段的复核（2026-07-23）

用当前用户存档只读解析得到 401 枚因子，其中 302 枚的 `primaryLevel` 或 `secondaryLevel`
与 `sigilLevel` 不同。异常值集中为 20、30、45、65，并分别与对应技能的累计等级上限吻合：
伤害上限为 65，暴君等为 30，追击等为 45。它们不是一枚普通因子实际提供的技能等级。

普通因子的两个词条均按因子自身等级贡献，多个来源装备后再合计。界面因此只显示
`sigilLevel`，不再把存档 IDType 1702 原始值标成“词条等级”。该原始值继续保留在导入契约中，
用于兼容存档结构、实例身份和后续研究，但不参与卡片展示或配装等级排序。

钳蟹的共鸣、钳蟹的报恩和终极钳蟹因子等进度型技能属于例外：其效果等级由收集或任务进度决定。
卡片用“收集进度决定”标记和说明气泡提示，不把因子等级或原始字段冒充为当前生效等级。
在取得 Immortal Shell、Sumo Force 等新版特殊技能的可靠游戏 ID/hash 前，目录仍按
`latest_catalog_audit.md` 的策略保留缺口，不编造映射。

依据：

- [Nenkai：PWR 计算示例](https://nenkai.github.io/relink-modding/resources/re/mechanics/pwr_power/)；
- [Relink Wiki：Traits](https://relink.gbf.wiki/Traits)；
- [Alpha/Beta/Gamma 因子升级说明](https://dotesports.com/granblue-fantasy/news/granblue-fantasy-relink-unlock-new-sigils-1-1-0-update)。

## `choeki/gbfr-relink-sim` 数据审计

### 审计基线

- 仓库：[choeki/gbfr-relink-sim](https://github.com/choeki/gbfr-relink-sim)
- commit：`6aba7fc633e870de65f26c01462cdbe1dd6b6baa`
- commit 时间：2026-07-20T09:09:43Z
- 审计日期：2026-07-22
- 本地只读克隆：`/tmp/gbfr-relink-sim-review`

### 可借鉴的结构

`src/types.ts` 定义了：

- `Trait { id, hash, name, nameZh, maxLevel, canPrimary, canSecondary, category, weaponOnly }`
- `SigilDef { id, hash, category, isPlus, supportsSecondary, allowedLevels, primaryTraitId, secondaryPool, defaultSecondaryTraitId }`
- `SigilEquip { sigilId, level, secondaryTraitId, secondaryLevel }`
- `SIGIL_SLOTS = 12`

`src/data/seed.json` 在该 commit 中包含：

- 212 个 Trait 条目；
- 189 个因子定义，其中 `normal=73`、`support_sigil=11`、`character_sigil=91`、`opus_sigil=3`、`special=10`、`special_sigil=1`；
- 29 个角色显示条目（Gran/Djeeta 分开，因此对应 28 个可玩角色）；
- 两个 secondary pool；
- `meta.source` 声称源自 `GBFR.PE.Patch.Tool embedded data`，抽取日期 2026-07-16，中文名为非官方翻译。

`data-source/sigil-secondary-rules.md` 记录了作者当前理解的固定组合和禁止副词条，`src/rules.ts` 区分因子、祝福石、召唤石、武器各自的 Trait 池。这种“统一 Trait 字典 + 不同装备来源独立资格规则”的结构值得采用。

### 不能直接采用的部分

1. **无许可证。** 仓库根目录没有 `LICENSE` / `COPYING`，GitHub API 的 `license` 为 `null`。公开可读不等于允许复制、修改或分发。只能把结构和问题当研究线索；若要复用内容需取得作者许可。
2. **等级被临时固定为 15。** `seed.json` 中普通 V+ 的 `allowedLevels` 只有 `[15]`，而游戏实际是 Lv11–15。上游草稿 `data-source/json_0x7433a0_sigils-todos.json` 也明确写着 “Temporary data pass: sigil level is fixed to 15 ... final legality still needs gem/lot verification.”
3. **副词条池不是完整的游戏真值。** `data-source/json_0x611863_rules-invalidSecondaryTraitsOnPlusSigils-globalRules-todos.json` 自称 draft，并列出 “Extract complete secondary trait pools ...” 等 TODO。
4. **类别存在缺口。** 212 个 Trait 中 97 个 `category=null`；这部分包含角色专属、未知占位和部分武器/特殊数据，不能直接驱动 UI 分类。
5. **2.0.2 新角色专属数据未闭合。** 新六名角色有若干 `HASH_*` Trait，`canPrimary=false/canSecondary=false`，但没有完整对应的 character sigil 记录。
6. **存在与当前 Wiki 的数值冲突。** 例如 Attack Power、若干抗性 Trait 的最大等级在仓库与当前 Wiki 中不一致。对本项目第一版“按出现次数求解”影响不大，但证明不能把该数据当唯一权威来源。
7. **图片和中文翻译许可另有风险。** `public/icons` 和角色头像是游戏资源衍生物；仓库免责声明不等于获得 Cygames 的再分发许可。建议第一版使用自制类别图标/纯文字，不打包游戏图标。

### 许可建议

| 来源 | 状态 | 建议 |
|---|---|---|
| `choeki/gbfr-relink-sim` | 无许可证 | 不复制代码、JSON、翻译、图片；仅参考设计并独立实现 |
| `BitterG/GBFR-PE-Patch-Tool` | 无许可证 | 可用于验证存档结构线索，不复制实现；如需代码先征得许可 |
| `Nenkai/GBFRDataTools` | MIT，commit `92064d46062fd0649f972470492278f1f5577884`（2026-07-20） | 可复用或移植，保留 MIT copyright / license notice |
| `relink.gbf.wiki` | CC BY-NC-SA（页面底部声明） | 可引用和人工核对；若复制数据库会引入署名、非商业、相同方式共享义务，需谨慎 |
| Cygames 游戏文本/图标 | Cygames 权利内容 | 尽量只保存必要内部 ID 和自行整理的事实；避免分发原始图片、整段文本 |

以上不是法律意见；若计划闭源或商业分发，应做一次专门许可审查。

## 建议的数据模型

### TraitDefinition

```text
TraitDefinition
  id                    // 本项目稳定 ID；优先游戏 SKILL_*，未知项用 hash 命名
  hash                  // 存档中的 uint32 hash
  names                 // zh-Hans / en / ja，可缺省
  category              // basic | attack | defense | support | special | character | weapon | unknown
  maxAggregateLevel
  fixedLevel            // null 或 15 等
  allowedAsPrimary
  allowedAsSecondary
  sourceKinds           // sigil / weapon / wrightstone / summon
  characterIds[]
  introducedIn
  sourceEvidence[]
  confidence
```

### SigilDefinition

```text
SigilDefinition
  id                    // GEEN_* 或稳定替代 ID
  hash
  rank                  // I..V / special
  isPlus
  primaryTraitId
  fixedSecondaryTraitId // null 表示从实例读取；非 null 表示 Alpha+ / Awakening+ 等固定组合
  itemLevelMin
  itemLevelMax
  synthesisEligible
  fixedPair
  characterIds[]
  introducedIn
```

### OwnedSigil（求解器真正消费的输入）

```text
OwnedSigil
  instanceId            // 存档 GemUnitID/槽位 ID；必须唯一
  sigilDefId
  sigilHash
  itemLevel
  primary:   { traitId, traitHash, level }
  secondary: { traitId, traitHash, level } | null
  locked
  equippedByCharacterId | null
  saveSlotId
  raw                    // 未识别字段/值，便于版本升级后重解析
```

必须以 `instanceId` 表示数量。两个技能、等级、主副顺序全部相同的因子仍是两个不同实例，求解时最多各使用一次。为了显示可以在结果输出时再聚合为 `A&B ×2`，但不能在库存层先丢掉重复项。

当前开源存档结构也支持这一建模方向：`GBFR-PE-Patch-Tool` 的只读扫描把每枚因子映射为独立 `GemUnitID`，并分别读取 `GemLevel`、主 Trait hash/level、副 Trait hash/level。即使产品暂时不按等级求目标，也应完整保留这些字段，避免之后迁移数据。

## 对求解器的关键约束

1. 输入集合只保留 `secondary != null` 的双 Trait 因子，符合用户“不考虑单 Trait 垃圾因子”的产品范围；但解析层仍应统计并报告被忽略数量。
2. 每个被选实例消耗一个因子槽，最多选 12 个；每个双 Trait 实例向目标多重集合贡献两个出现次数。
3. 目标匹配以 Trait ID 而不是显示名进行。中文同名、翻译变更和角色专属同名都不能造成误合并。
4. `A&B` 与 `B&A` 的目标覆盖相同，但构筑语义不同；结果显示和最终 tie-break 必须保留主副顺序。
5. 不要按“天然掉落合法组合”过滤实例。合成可以产生同类别、同 Trait 双词条。
6. 角色专属因子若纳入目标，分析前必须选择角色；不符合角色限制的实例排除。若第一版不支持角色选择，应默认排除角色专属 Trait，并在 UI 明说。
7. 用户要求的“因子等级总数”存在歧义。建议产品规格明确采用：
   - 一级排序所说 `因子等级总数` = 所选实例 `itemLevel` 之和；
   - 另行显示 `primary.level + secondary.level`，不要混用；
   - 若存档实际出现主副等级不同，仍按真实字段展示。
8. 游戏效果上限不应影响用户当前“出现次数”目标。将来若加“达到 Trait Lv65”模式，应作为另一种目标类型，而不是修改现有计数语义。
9. 结果的类别统计应按主 Trait 类别计算；这是 2.0.2 Master Trait 构筑中有价值的附加摘要，但本轮不要自动加入用户未要求的优化目标。

## 2.0.2 基础属性目录与按类别计数的 Master Trait

### Basic Stats 的成员

截至 Ver. 2.0.2，`Basic Stats`（基础属性）类只有下列四个可用 Trait。当前 Wiki 的分类表与 2026-07-16 抽取的 `choeki` 数据在**成员、内部 ID 和 hash** 上一致；Nenkai 的游戏文本/ID 表也能交叉验证四个内部 ID 与 hash。`SKILL_002_00` 是未使用的 DEF Trait，不能加入可选目录。[Relink Wiki: Traits](https://relink.gbf.wiki/Traits)；[Nenkai: Trait/Skill IDs](https://nenkai.github.io/relink-modding/resources/trait_skill_ids/)

| Catalog ID | hash | 英文显示名 | 简中显示名/别名 | 类别 | 主/副资格 | 汇总等级上限 |
|---|---:|---|---|---|---|---:|
| `SKILL_000_00` | `0x50079A1C` | Attack Power / ATK | 攻击力 | `basic` | 均可 | **待 2.0.2 游戏表复核**：当前抽取数据为 50，当前 Wiki 为 45 |
| `SKILL_001_00` | `0xF372F096` | Health / HP | 体力 | `basic` | 均可 | 50 |
| `SKILL_003_00` | `0x8D78A19B` | Critical Hit Rate | 暴击率 | `basic` | 均可 | 45 |
| `SKILL_004_00` | `0xCEB700EE` | Stun Power | 昏厥 / 昏厥值 | `basic` | 均可 | 45 |

注意：这里的 `hash` 是 **Trait hash**，不是因子物品 hash。相同主 Trait 在物品表中可以对应多个 Rank、`+` 版本和内部物品 ID；判断类别必须先把存档实例的主 Trait hash 映射到 TraitDefinition，不能靠因子显示名或物品 hash 的前缀猜测。

当前可用于版本化 Catalog 的明确数据为：

```json
{
  "gameVersion": "2.0.2",
  "category": "basic",
  "traits": [
    { "id": "SKILL_000_00", "hash": "0x50079A1C", "nameEn": "Attack Power", "nameZhHans": "攻击力" },
    { "id": "SKILL_001_00", "hash": "0xF372F096", "nameEn": "Health", "nameZhHans": "体力" },
    { "id": "SKILL_003_00", "hash": "0x8D78A19B", "nameEn": "Critical Hit Rate", "nameZhHans": "暴击率" },
    { "id": "SKILL_004_00", "hash": "0xCEB700EE", "nameEn": "Stun Power", "nameZhHans": "昏厥" }
  ],
  "excluded": [
    { "id": "SKILL_002_00", "hash": "0x7279E478", "reason": "unused DEF trait" }
  ]
}
```

四个 Trait 的类别和 ID/hash 可标为高置信度；`SKILL_000_00.maxAggregateLevel` 在两个当前来源间冲突，Catalog 第一版应暂存 `null` 或附 `verificationStatus=conflict`。本工具当前按出现次数求解，这个冲突不影响匹配或类别计数。

### 哪些角色拥有“基础属性因子提高伤害上限”

RPG Site 的 2.0.2 全角色逐项清单显示，**所有角色**都拥有两枚文案相同的可选 Master Trait：一枚位于各角色的 `Insight / Style Rank 3` 池，另一枚位于同一 Insight 风格的 `Style Rank EX` 池。该页面有 28 个构筑章节，因为 Gran 与 Djeeta 合并为 Captain 的同一套构筑；若应用把两种主角外观保存为独立角色，则是 **29 个 character ID 共享 28 套定义**。[RPG Site: All Character Master Traits](https://www.rpgsite.net/guide/20796-granblue-fantasy-relink-endless-ragnarok-all-characters-master-traits)

角色全集为：

```text
Gran/Djeeta, Katalina, Rackam, Io, Eugen, Rosetta, Charlotta,
Ghandagoza, Ferry, Narmaya, Lancelot, Vane, Percival, Siegfried,
Cagliostro, Yodarha, Zeta, Vaseraga, Beatrix, Eustace, Seofon,
Tweyen, Sandalphon, Fraux, Fediel, Id, Gallanza, Maglielle
```

这两个节点不是角色专属公式的不同变体；网页清单中 28 套定义 × 2 个位置共 **56 次**出现完全相同的英文文案。展开 Gran 与 Djeeta 后，Catalog 应生成 29 个角色 ID × 2，即 58 个“角色可用节点”关系，但只需复用两枚全角色节点定义：

```text
DMG Cap +20% per Basic Stats-type sigil equipped (max sigils: 5)
```

### 准确公式、单节点上限与双节点叠加

令 `nBasic` 为当前装备中“因子类别为 Basic Stats”的因子数量：

```text
nBasic = count(equippedSigils where category(primaryTrait) == basic)
perNodeBonus = 20% × min(nBasic, 5)
totalBonus = perNodeBonus × enabledNodeCount
enabledNodeCount ∈ {0, 1, 2}
```

- 每枚已选择的节点单独提供每个基础属性类因子 `DMG Cap +20%`，最多计 5 个；故**单节点上限 +100%**。
- Rank 3 节点和 EX 节点可同时选择，Master Trait 的效果不是 Insight / Essence / Crux 三选一。两枚都启用时为每个基础属性因子合计 `+40%`，5 个时**总上限 +200%**。RPG Site 对 Master Trait 系统的说明明确说各 Style 的已选效果同时、普遍生效，除非 Trait 自身另有互斥说明；近期玩家构筑和实测也一致报告“两枚 +20% 节点叠加”。[RPG Site: Master Trait system explanation](https://www.rpgsite.net/guide/20796-granblue-fantasy-relink-endless-ragnarok-all-characters-master-traits)；[Reddit: two nodes stack](https://www.reddit.com/r/GranblueFantasyRelink/comments/1v2uegc/can_someone_clarify/)
- 这里的 5 是**被计数因子的数量上限**，不是 Trait 等级、因子等级或槽位上限；装备第 6 个基础属性主词条因子不会继续提高此节点的效果。
- 节点本身是池中的可选 Master Trait。是否满足 Style Rank 3 的“选择 6 个以激活 Rank Perk 3”是另一个条件；节点一旦被选择，其自身数值不应错误地等到 Rank Perk 激活才计算。

### 是否只看主词条

结论是：**只看主词条决定出的因子类别；副词条不会让因子额外算作 Basic Stats 类。** 证据链如下：

1. 当前 Wiki 明确写明主 Trait 决定因子的 category 和图标；Master Trait 节点按“equipped sigil 的 category”计数。[Relink Wiki: Sigils](https://relink.gbf.wiki/Sigils)
2. 因而 `Stun Power & DMG Cap` 的物品类别是 `basic`，计 1；`DMG Cap & Stun Power` 的物品类别是 `attack`，计 0。即使一枚合成因子是 `Stun Power & Health`，它仍只是一枚 `basic` 因子，计 1 而不是 2。
3. 2.0.2 玩家直接对换主副词条的构筑说明和测试均报告，必须把 Basic Stats Trait 放在第一个词条；因子装备在 12 个栏位中的上下位置不影响计数。[Reddit: first trait requirement](https://www.reddit.com/r/GranblueFantasyRelink/comments/1uuebvc/updated_infographic_for_endgame_build_optimized/)；[GameFAQs: reversing traits](https://gamefaqs.gamespot.com/boards/621177-granblue-fantasy-relink-endless-ragnarok/81170393)

“主词条决定类别”可标为高置信度事实；“该节点在运行时只读主词条类别”有规则推导和多份直接玩家测试，属于高置信度行为，但本轮没有取得 Cygames 的公式表或反编译函数，仍应在证据字段中注明 `verification=game-ui-and-community-test`，不要伪称官方公开公式源码。

建议 Catalog 把节点建成两个独立定义，而不是把 `+40%` 硬编码成一枚：

```json
[
  {
    "id": "MT_INSIGHT_R3_BASIC_SIGIL_DMG_CAP",
    "gameVersion": "2.0.2",
    "characterScope": "all",
    "style": "insight",
    "rankPool": 3,
    "effect": "dmgCap",
    "countedSigilCategory": "basic",
    "categorySource": "primaryTrait",
    "valuePerSigil": 0.20,
    "maxCountedSigils": 5
  },
  {
    "id": "MT_INSIGHT_EX_BASIC_SIGIL_DMG_CAP",
    "gameVersion": "2.0.2",
    "characterScope": "all",
    "style": "insight",
    "rankPool": "EX",
    "effect": "dmgCap",
    "countedSigilCategory": "basic",
    "categorySource": "primaryTrait",
    "valuePerSigil": 0.20,
    "maxCountedSigils": 5
  }
]
```

上述 `MT_*` 是本项目建议的稳定语义 ID，不是已验证的游戏内部 ID。若第一版不读取 Master Trait 选择状态，结果页最多展示 `basicPrimaryCount` 和“启用 1/2 枚节点时的潜在加成”，不能默认玩家已经点出两枚节点。

## Ver. 2.0.2 原生因子筛选器：五类，不含“角色专属”第六类

### 可直接落地的结论

本轮取得了明确显示 **Version 2.0.2** 的英文实机录像，并逐帧核对了 Gear、Upgrade Sigils 与 Sigil Synthesis 中的筛选弹窗。`Filter > Traits` 页左栏只有下列五项，显示顺序固定为：

| 顺序 | 稳定键建议 | 实机英文 | 简体中文 UI 建议 | 是否进入 `TraitCategory` |
|---:|---|---|---|---|
| 0 | `basic` | Basic Stats | 基础能力 | 是 |
| 1 | `attack` | Attack | 攻击 | 是 |
| 2 | `defense` | Defense | 防御 | 是 |
| 3 | `support` | Support | 辅助 | 是 |
| 4 | `special` | Special | 特殊 | 是 |

英文名称和顺序是 2.0.2 实机画面的直接证据；简体中文列与中文攻略中长期使用的游戏内术语一致，但本轮没有取得同一画面的简体中文截图，因此应把它作为首版显示文案，而不要把它宣称为已逐像素复核的 2.0.2 官方中文 UI 字符串。

**`Character-Specific` 不是第六个原生 Trait Type。** 2.0.2 的 `Traits` 左栏完整可见时没有该项，旧版实机的 `Trait Type` 也同样只有上述五项。社区工具中的 `character_sigil`、`opus_sigil`、`special_sigil` 等字段描述的是因子家族、来源或组合规则，不是与五类并列的技能类别。角色专属因子仍应保留为独立元数据，例如：

```ts
type TraitCategory = 'basic' | 'attack' | 'defense' | 'support' | 'special'

type SigilFamily =
  | 'normal'
  | 'character'
  | 'opus'
  | 'special_reward'
  | 'unknown'
```

因此首版 Catalog/UI 的主分类栏应严格只显示五类。若产品需要便捷查看角色专属因子，可在“因子家族/来源”或“仅适用角色”的独立筛选面板中提供，不能向 `TraitCategory` 增加 `character`。

### `All`、`Plus` 与其他条件属于物品级/视图级筛选

2.0.2 实机筛选器把条件拆成了不同页面和维度：

- `Standard` 页包含 `Rarity`、`Number of Traits`（`1` / `2`）、`Locked`、`Party Set/Loadout`，下部还有按装备角色筛选的头像矩阵。
- `Traits` 页才包含上述五个类别，并可进一步点选具体 Trait；Basic Stats 页右侧精确显示 `ATK`、`HP`、`Critical Hit Rate`、`Stun Power`。
- 因子列表顶部存在 `All` 视图，但 `All` 是“不限制类别”的合成视图选项，不是第六个类别值。
- 实机没有把 `Plus` 作为 Trait 类别；V+ 的 UI 语义应由 `Number of Traits == 2`，或数据层的 `secondaryTraitId != null` / `isPlus` 表达。

建议 UI 将这些条件分层，避免把完全不同的概念塞进同一个枚举：

| UI 维度 | 数据表达 | 备注 |
|---|---|---|
| 技能类别 | 五值 `TraitCategory` | 主词条决定因子类别 |
| 全部 | `category = null` | 仅 UI 合成选项，不落库为类别 |
| V+ / 双词条 | `traitCount == 2` | 物品结构过滤 |
| 角色专属 | `family == 'character'` | 因子家族/资格过滤 |
| 具体技能 | `primaryTraitId` / `secondaryTraitId` | 2.0.2 原生筛选器已支持具体 Trait |
| 稀有度、锁定、已装备、已保存 | OwnedSigil 状态字段 | 与技能分类正交 |

### 证据边界与首版安全处理

已能高置信度确认的是：**原生技能分类集合严格为五类；角色专属不是第六类；All 与双词条是其他筛选维度。** 当前录像没有展开 `Special` 页的全部具体 Trait，因此本轮不能仅凭画面断言每一条角色专属 Trait 在具体技能选择器中如何排列，也不能证明其是否全部被收在 `Special` 页。这个未知项不影响首版分类设计：

1. Catalog 的 `TraitCategory` 只接受五值；未知类别不得静默映射为 `character`。
2. 角色专属资格以 `SigilFamily.character` 和 `characterId` 单独记录。
3. 在取得 2.0.2 当前游戏表前，角色专属 Trait 的五类归属可暂存为 `category: null`，但仍可按 Trait ID 参与求解；不要猜测为 `special`。
4. UI 可显示“角色专属”徽标或独立过滤项，但视觉上必须与五个原生技能类别分组。

实机证据：YouTube 视频 *Get Any Sigil You Want in Granblue Fantasy: Relink - Endless Ragnarok*（上传于 2026-07-20）在标题画面显示 Version 2.0.2；约 `01:06` 展示五项 `Traits` 左栏和 Basic Stats 的四个成员，约 `01:14` 展示 Attack 页，约 `05:15` 再次展示同一五项左栏与 Defense 页。旧版录像 *Cleaning out your inventory, the one feature some may have missed!*（2024-02-14，约 `00:12–00:18`）的 `Trait Type` 行亦只有同序五类，可作为跨版本一致性旁证。

## 事实、推断与未知项

### 高置信度事实

- 五个正式类别、12 个因子栏、主词条决定类别、同名 Trait 等级叠加并受最大等级限制。
- Basic Stats 的可用成员为 Attack Power、Health、Critical Hit Rate、Stun Power；全部 28 套角色构筑（Gran/Djeeta 共用一套，对应 29 个角色 ID）在 Insight Rank 3 与 Insight EX 各有一枚“每个 Basic Stats 因子 DMG Cap +20%，最多 5 个”的节点。
- 普通 V/V+ 的 Lv11–15；合成普通成功 Lv11、Grand Success Lv15。
- 合成能绕过同类别限制，并能得到完全相同的双 Trait。
- 角色专属、固定 Lv15、Alpha/Beta/Gamma 等存在特殊合成/组合规则。
- Ver. 2.0.2 已上线并新增按因子类别计数的 Master Traits。

### 中等置信度 / 社区实测

- 天然 V+ 副词条类别方向 `Basic > Attack > Defense > Support > Special`。这对解释掉落有用，但不应约束已读出的库存。
- Awakening+ 的单份 knockout 获取机制。
- Master Trait 类别计数只看主词条；与 Wiki 的“主词条决定类别”相符，并有 2.0.2 玩家测试佐证。
- 两枚 Basic Stats 计数节点同时启用时叠加到每个因子 +40%、5 个时总计 +200%；完整节点表与多份玩家构筑一致，但本轮未直接取得游戏内部计算函数。

### 尚未闭合

- 2.0.2 全量 `sigilHash ↔ item ID ↔ localized name ↔ primaryTraitHash` 表，尤其新六名角色的专属因子。
- 完整、机器可验证的天然副词条掉落池；`choeki` 和 `GBFR-PE-Patch-Tool` 都把这部分标为草稿/TODO。
- 所有特殊因子的合成资格表；目前应以实际游戏表或真实存档样本补齐，而不是靠命名规则猜测。
- 不同语言下 OCR 所需的完整官方显示名及字体/截断形式。
- 2.0.2 后续热修是否会改 hash、表结构或 Trait 数值；数据包必须可更新。
- `SKILL_000_00`（Attack Power）的汇总等级上限：2026-07-16 抽取数据为 50，2026-07-21 当前 Wiki 为 45，需从玩家本机 2.0.2 `skill_status.tbl` 或游戏 UI 直接裁决。

## 建议的后续验证清单

1. 用一份 2.0.2 Steam 实际存档做**只读**抽取，至少覆盖：普通 Lv11 V+、Lv15 V+、同类别合成因子、双同名因子、角色专属+、Awakening+、Alpha/Beta/Gamma+、War Elemental+、新 Celestial、新角色专属。
2. 对每枚样本比对游戏 UI 与解析字段：`GemUnitID`、`sigilHash`、`itemLevel`、两条 Trait hash、两条 Trait level、锁定状态、装备角色。
3. 直接从当前游戏 `gem.tbl`、`skill_status.tbl`、文本表生成版本化原始清单；生成过程使用 MIT 许可的 `GBFRDataTools`，不要复制无许可证项目的数据文件。
4. 建立 golden fixtures：脱敏后只保留最小二进制片段或解析后的 JSON 测试向量，覆盖上述例外。
5. 在 UI 中提供“未知因子/未知词条”诊断页和数据包导出，便于用户提交 hash 与截图补库。

## 游戏筛选分类与工具 UI 边界

当前 Ver. 2.0.2 Wiki 明确把因子划分为五个 distinct categories，顺序为 `Basic Stats、Attack、Defense、Support、Special`，并说明主词条决定因子类别。[Relink Wiki: Sigils](https://relink.gbf.wiki/Sigils)；[Relink Wiki: Traits](https://relink.gbf.wiki/Traits)

`choeki/gbfr-relink-sim` 的当前 Picker 在这五项之外增加了 `role` 和因子级 `plus` 过滤。它们是社区工具代码中的便利筛选，不能据此宣称游戏原生筛选器存在“角色专属”第六技能类型；其中 `plus` 明确是因子是否带 `+` 的物品属性，不是技能类别。

因此本工具采用两层数据：

- `SemanticCategory` 保存五个业务类别，用于 Basic Stats 主词条等求解规则；
- 开放字符串 `FilterCategoryId` 和 `OrderedFilters` 从版本化 Catalog 提供，UI 不使用封闭 enum。

首版 Catalog 以五个类别为已确认基线。“全部”只作为聚合浏览状态；“角色专属”只有在 Ver. 2.0.2 游戏内筛选截图或本地化表直接证明存在时才加入。简体中文候选标签为“基础能力、攻击、防御、辅助、特殊”，发布前仍须用当前游戏本地化表/UI 样本核准准确措辞和顺序。

## 来源清单

全部访问日期均为 2026-07-22。

- Cygames，《Ver. 2.0.2 Update Information》：<https://relink-ragnarok.granbluefantasy.com/en/updates/381/>
- Cygames，《Updates》：<https://relink-ragnarok.granbluefantasy.com/en/updates/>
- Granblue Fantasy Relink Wiki，《Sigils》（页面最后修改 2026-07-21）：<https://relink.gbf.wiki/Sigils>
- Granblue Fantasy Relink Wiki，《Traits》：<https://relink.gbf.wiki/Traits>
- Granblue Fantasy Relink Wiki，《Sigil Synthesis / Siero's Knickknack Shack》（页面最后修改 2026-07-20）：<https://relink.gbf.wiki/Sigil_Synthesis>
- Nenkai，《Sigil/Gem IDs》，页面标注 Data Version 1.3.x：<https://nenkai.github.io/relink-modding/resources/sigil_gem_ids/>
- Nenkai，《Trait/Skill IDs》，页面标注 Data Version 1.3.x：<https://nenkai.github.io/relink-modding/resources/trait_skill_ids/>
- Nenkai，《Sigil Synthesis Grand Success》：<https://nenkai.github.io/relink-modding/resources/re/mechanics/gem_mix/>
- Nenkai，《PWR / Power》：<https://nenkai.github.io/relink-modding/resources/re/mechanics/pwr_power/>
- Nenkai/GBFRDataTools，MIT，commit `92064d46062fd0649f972470492278f1f5577884`：<https://github.com/Nenkai/GBFRDataTools>
- choeki/gbfr-relink-sim，无许可证，commit `6aba7fc633e870de65f26c01462cdbe1dd6b6baa`：<https://github.com/choeki/gbfr-relink-sim>
- BitterG/GBFR-PE-Patch-Tool，无许可证，commit `b6ff3c76e102a2183d5ebd595f4329f2e79cc7da`：<https://github.com/BitterG/GBFR-PE-Patch-Tool>
- GameFAQs，《Sigils》：<https://gamefaqs.gamespot.com/ps5/308486-granblue-fantasy-relink/faqs/82470/sigils>
- GameFAQs，《Manipulating Sigils》：<https://gamefaqs.gamespot.com/ps5/308486-granblue-fantasy-relink/faqs/82470/manipulating-sigils>
- GameFAQs，《Character-Specific Sigils》：<https://gamefaqs.gamespot.com/ps5/308486-granblue-fantasy-relink/faqs/82470/character-specific-sigils>
- GameFAQs，社区样本《Sigil and Wrightstone Info》：<https://gamefaqs.gamespot.com/boards/308486-granblue-fantasy-relink/80690062>
- GameFAQs，《Tip: Synthesize your sigils to reverse the order of traits》：<https://gamefaqs.gamespot.com/boards/621177-granblue-fantasy-relink-endless-ragnarok/81170393>
- RPG Site，《All the new Sigils》：<https://www.rpgsite.net/guide/20836-granblue-fantasy-relink-endless-ragnarok-all-new-sigils-their-trait-effects-how-you-get-them>
- RPG Site，《All Characters Master Traits》：<https://www.rpgsite.net/guide/20796-granblue-fantasy-relink-endless-ragnarok-all-characters-master-traits>
- Reddit，《Updated Infographic for Endgame Build. Optimized.》：<https://www.reddit.com/r/GranblueFantasyRelink/comments/1uuebvc/updated_infographic_for_endgame_build_optimized/>
- Reddit，《Can someone clarify》：<https://www.reddit.com/r/GranblueFantasyRelink/comments/1v2uegc/can_someone_clarify/>
- YouTube，《Get Any Sigil You Want in Granblue Fantasy: Relink - Endless Ragnarok》（Version 2.0.2 实机筛选画面，2026-07-20）：<https://www.youtube.com/watch?v=jPywy3Ep1hs>
- YouTube，《Cleaning out your inventory, the one feature some may have missed! Granblue Fantasy Relink》（旧版筛选器旁证，2024-02-14）：<https://www.youtube.com/watch?v=ksM3I_-JHbQ>
