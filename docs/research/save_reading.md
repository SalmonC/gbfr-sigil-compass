# GBFR Windows/Steam 存档自动读取可行性研究

> 研究日期：2026-07-22（Asia/Shanghai）
> 研究范围：Windows/Steam 版《Granblue Fantasy: Relink》（含 1.3.x 与 2026 年 2.0.2 / Endless Ragnarok）
> 目标：判断能否只读导入玩家现有因子，并准确得到每个因子实例的主词条、副词条和等级
> 结论性质：技术调研，不构成法律意见，也不承诺账号绝对无风险

## 一、结论先行

**方案一“直接读取存档”技术上可行，应作为正式产品的首选导入方式；当前没有理由直接转向 CV。**

决定性证据不是“有人说可以改存档”，而是已经存在两套可审查的代码链路：

1. `Nenkai/GBFRDataTools` 从 2024 年起公开了 `SaveData1.dat` 的外层头、两个 FlatBuffers 数据块、存档单位表和 XXHash64 校验算法。其读取代码直接解析原始 `.dat`，没有任何解密或解压步骤。
2. `GBFR-Sigil-Generator` 的存续分叉不但能定位因子实例，还明确给出了主/副词条的配对公式和等级字段。该工具能添加自定义因子并重新打开输出存档逐字段验证；Nexus 页面也记录了其实际使用流程。这比仅有格式猜测强得多。

对本项目最关键的字段已经足够明确：

| 信息 | 存档表示 | 结论 |
|---|---|---|
| 因子实例 | `IDType=2703`，`UnitID >= 30000` | 每个库存位置是一个独立实例，完全相同的两个因子不会被合并 |
| 因子 ID | `2703` 的 `uint32` 哈希 | 可映射到 `GEEN_*` 因子定义 |
| 因子等级 | 同一 `UnitID` 的 `IDType=2704`，类型为 `int32` | 可用于方案中的因子等级总和排序 |
| 主词条 | 由因子 `UnitID` 推导出的 `1701` 词条哈希 | 位置顺序明确，不需要从名称猜主副 |
| 主词条等级 | 同一主词条单元的 `1702` | 可读取，虽然 MVP 求解可先只使用“出现次数” |
| 副词条 | 主词条单元 `+1` 处的 `1701` | 可判断是否为双技能因子，并保留副词条顺序 |
| 副词条等级 | 副词条单元的 `1702` | 可读取 |
| 装备状态 | 同一因子 `UnitID` 的 `2706` | 可标记被哪个角色装备，不应因此从库存中丢弃 |
| 锁定等标志 | 同一因子 `UnitID` 的 `2707` | 可保留为实例元数据 |

因此，“只枚举 V+ 因子实例，保留两个技能、主副顺序、等级和重复件数量”没有结构性障碍。

不过，**2.0.2 当前版本仍需一份真实存档完成最终 PoC**。公开写入工具的最后代码提交是 2026-06-01，早于 2.0.2 的 2026-07-09 全球发行；`GBFRDataTools` 虽然已经发布面向 2.0.0 数据文件的版本，存档解析模块自 2026-03-07 后没有格式改动。现有证据强烈指向兼容，但不能把“代码没有改”冒充成“已经用 2.0.2 玩家存档逐项验证”。

### 置信度

| 判断 | 置信度 | 理由 |
|---|---:|---|
| 1.3.x 存档可只读解析 | 高，约 95% | 格式库、字段文档、写入工具、旧版社区数据互相印证 |
| 能枚举每个重复因子实例 | 高，约 95% | 库存 `UnitID` 与槽位 ID 独立存在，写入工具按实例逐个处理 |
| 能得到主词条、副词条和各自等级 | 高，约 95% | `1701/1702` 及配对公式有直接代码证据 |
| 2.0.2 仍沿用同一核心布局 | 中高，约 80% | 老存档可官方继续使用、当前数据工具未改变解析器，但缺少本次研究可公开复验的 2.0.2 样本 |
| 所有 2.0 新因子/技能都能立刻显示正确中文名 | 中，约 70% | 二进制字段可读，但当前公开 ID 网页仍标注 `Data Version: 1.3.x`，2.0 本地化字典需单独核验 |
| 使用工具绝无封号或条款风险 | 不能确认 | 官方服务协议明确限制逆向和未经许可的外部工具，不能给“零风险”承诺 |

## 二、存档在哪里，应该读哪个文件

Steam Cloud 的公开 UFS 配置给出的根目录是 `WinAppDataLocal`，相对路径为：

```text
GBFR/Saved/SaveGames/*.dat
```

对应 Windows 路径：

```text
%LOCALAPPDATA%\GBFR\Saved\SaveGames\
```

常见主存档名是：

```text
SaveData1.dat
```

SteamDB 记录该应用的 App ID 为 `881020`、云存档文件数上限为 14、通配符为 `*.dat`。官方 1.0.5 更新还加入了“条件允许时创建备份存档”的行为，因此目录中可能同时出现主存档、备份存档和系统数据。导入器不能武断地读取“目录中最新的任意 `.dat`”。

建议的文件选择策略：

1. 默认发现 `%LOCALAPPDATA%\GBFR\Saved\SaveGames\SaveData*.dat`。
2. 名称含 `BackUp` / `Backup` 的文件只作为恢复候选，不自动覆盖主存档选择。
3. UI 显示文件名、修改时间、解析出的版本号和因子数量，允许用户切换。
4. 不读取 Steam `userdata` 下的云同步镜像作为日常数据源。那个目录用于 Steam Cloud，同步过程中可能变化，而且不同 Steam 安装位置和用户 ID 会改变路径。
5. Proton/Steam Deck 虽非本项目首发范围，但路径仍落在 AppData 映射下；解析层本身无需绑定 Windows API。

## 三、文件结构：不是加密包，而是带完整性校验的 FlatBuffers

### 3.1 外层头

`GBFRDataTools.SaveFile/SaveFile.cs` 对文件头的读取顺序如下：

| 偏移 | 大小 | 类型 | 含义 |
|---:|---:|---|---|
| `0x00` | 4 | `int32` | `mainVersion` |
| `0x04` | 8 | `uint64` | Steam ID / 存档所有者标识 |
| `0x0C` | 4 | `int32` | 未命名字段 |
| `0x10` | 4 | `int32` | `subVersion` |
| `0x14` | 8 | `int64` | 第一个数据块偏移 |
| `0x1C` | 8 | `int64` | 槽位数据块偏移 |
| `0x24` | 8 | `int64` | 第一个数据块大小 |
| `0x2C` | 8 | `int64` | 槽位数据块大小 |

两个块都用同一个 `SaveDataBinary` FlatBuffers 根表解析。

### 3.2 内部序列化

`SaveDataBinary.fbs` 将存档内容按标量类型拆成多张表：

```text
BoolTable, ByteTable, UByteTable, ShortTable, UShortTable,
IntTable, UIntTable, LongTable, ULongTable, FloatTable
```

每个存档单元都至少含：

```text
IDType : uint32
UnitID : uint32
ValueData : 对应标量类型的向量
```

可以把它理解为一个稀疏的、按值类型分桶的 `(数据种类, 实例编号) -> 数值数组` 数据库。因子并不是一个固定 C 结构体顺序排在文件里，而是由多个拥有相同或可推导 `UnitID` 的存档单元拼成。

### 3.3 压缩与加密

**未发现压缩，也未发现加密。** 依据是：

- 公开读取器在读出两个块后直接调用 FlatSharp 的 `SaveDataBinary.Serializer.Parse(...)`。
- 写入工具可以在原始槽位块中定位 FlatBuffers 标量向量并直接覆写 32 位值。
- 文件头的 8 字节 Steam ID 可直接读取；社区跨账号转移教程也通过改这段明文标识实现重新绑定。

因此不需要密钥管理、游戏进程注入、DLL 注入或内存扫描。把“有哈希校验”误称为“加密”会让技术路线复杂化。

### 3.4 完整性校验

槽位数据末尾包含哈希表偏移。公开实现读取 `slotDataSize - 0x14` 处的一个小端 `uint32` 作为哈希表起点，表中有 10 个 `uint64` 哈希。

当前有效哈希槽由：

```text
IDType 1003 (SAVEDATA_HASHSEED) 的值 % 10
```

决定。哈希算法是带固定种子的 XXHash64：

```text
seed = 0x2F1A43EBCD
```

十个候选区段的起点和跳过长度也已公开。**只读工具不需要“修复”哈希**，但应校验当前有效哈希，用它检测半写入、损坏或不兼容存档。校验失败时应提示并停止自动分析，不能为了“读取成功”去改原文件。

## 四、如何从存档恢复因子实例

### 4.1 判断库存槽是否被占用

公开工具使用以下条件枚举已占用因子：

```text
IDType == 2703
UnitID >= 30000
ValueData[0] != 0x887AE0B0
```

`0x887AE0B0` 是空字符串经过游戏哈希算法后的值，被作为空槽哈希。排序键是 `UnitID`。

每个满足条件的 `2703` 单元都是一个**物理实例**。即使两个实例的因子 ID、两个词条及所有等级完全相同，它们仍有不同 `UnitID`。这正好满足求解器对“重复物品不能去重”的要求。

同一因子的其他字段使用相同 `UnitID`：

| IDType | 类型 | 内容 |
|---:|---|---|
| `2702` | `uint32` | 因子槽 ID |
| `2703` | `uint32` | 因子/物品哈希 |
| `2704` | `int32` | 因子等级 |
| `2706` | `uint32` | 装备角色哈希；空值表示未装备 |
| `2707` | `uint32` | 标志位；公开文档已知至少含锁定等含义，但完整位语义仍未完全确认 |

### 4.2 主、副词条配对

对每个因子单元：

```text
gemIndex          = gemUnitId - 30000
primaryTraitUnit  = 120000000 + gemIndex * 100
secondaryTraitUnit = primaryTraitUnit + 1
```

随后读取：

```text
UIntTable: IDType 1701, UnitID primaryTraitUnit    -> 主词条哈希
IntTable : IDType 1702, UnitID primaryTraitUnit    -> 主词条等级
UIntTable: IDType 1701, UnitID secondaryTraitUnit  -> 副词条哈希
IntTable : IDType 1702, UnitID secondaryTraitUnit  -> 副词条等级
```

这条公式来自能够实际写入并复读验证的代码，不是根据 UI 文本作出的推测。写入工具的开发记录还特别指出：显示出来的词条等级保存在 `1702`，不能只看 `2704`。

### 4.3 V+ 过滤

产品要求只保留双技能因子。安全判定应同时使用事实字段和数据字典：

1. 主词条哈希必须非空且可解析。
2. 副词条哈希必须不是 `0x887AE0B0`，副词条单元存在。
3. 因子 ID 数据字典将该实例识别为 `V+`、固定双技能因子或其他合法双词条因子。
4. 若因子 ID 未知但两个词条单元均有效，暂列为“未知双词条因子”，不要静默丢弃。

只用因子英文名称末尾是否有 `+` 会漏掉命名特殊的双技能因子，也会被本地化文本变化影响。

### 4.4 哈希到技能名称

存档保存的是 32 位哈希，不保存可直接显示的中文名。映射需分两层：

- `2703` 因子哈希 -> `GEEN_*` 因子 ID；
- `1701` 词条哈希 -> `SKILL_*` 技能 ID，再由本地化字典得到简中名称。

Nenkai 的 `ids.txt` 和在线 Sigil/Gem、Trait/Skill ID 页面可以作为哈希基础表，`choeki/gbfr-relink-sim` 可作为 2026 技能与中文名称数据的参考。但 Nenkai 在线因子 ID 页当前仍明确标注 `Data Version: 1.3.x`；2.0 新增项目必须从 2.0.2 游戏表或经逐项验证的数据集补齐，不能拿 1.3.x 表假装完整。

导入模型建议保留原始值，避免字典升级后重读存档：

```text
SigilInstance
  snapshotInstanceId    // 本次导入内唯一，建议直接包含 gemUnitId
  gemUnitId
  slotId
  sigilHash
  sigilInternalId?
  sigilLevel
  primaryTraitHash
  primaryTraitInternalId?
  primaryTraitLevel
  secondaryTraitHash
  secondaryTraitInternalId?
  secondaryTraitLevel
  wornByHash
  flags
  sourceSaveVersion
```

`gemUnitId` 只保证在某次存档快照中唯一；玩家出售、整理或重新获得因子后，不应把它当成跨导入永不变化的全局身份。

## 五、版本变化与 2.0.2 的不确定性

### 5.1 已确认的时间线

- 2024-03-23：`GBFRDataTools` 提交 `f639a7a` 加入存档解析。该版本已包含当前相同的外层头、FlatBuffers 解析、十段 XXHash64 校验结构。
- 2024-07-18：`GBFRDataTools` 标签 `1.3.2`。
- 2026-03-07：提交 `6ce0540` 修正 `FloatTable` 的 schema 类型并补充存档 ID 文档；因子核心布局没有被改写。
- 2026-06-01：`GBFR-Sigil-Generator` 存续分叉最新提交 `97f0dc7`，完整记录 `270x`、`1701/1702` 和主副词条公式。
- 2026-07-09：Endless Ragnarok 全球发行，Day 1 Patch 为 2.0.2。Cygames 官方更新页明确面向继续使用既有存档的玩家。
- 2026-07-13：`GBFRDataTools` 发布 `2.0.0` 标签；仓库开始更新 Endless Ragnarok 数据文件支持。
- 2026-07-20：本研究检查的 `GBFRDataTools` 头提交为 `92064d46062fd0649f972470492278f1f5577884`，存档解析代码仍沿用上述结构。

### 5.2 可以下的判断

历史上从 1.3.x 到当前仓库，**外层容器和核心因子存档单元没有公开证据显示发生破坏性变化**。2.0.2 能继续载入已更新到 1.3.2 的旧存档，也支持“结构向后兼容”的判断。

### 5.3 不能下的判断

不能仅凭以下事实宣称“2.0.2 已 100% 验证”：

- `GBFRDataTools` 仓库已经打了 `2.0.0` 标签；该工具主要处理游戏资源档，标签不等于每个存档字段都做过回归测试。
- 旧存档能被 2.0.2 转换；转换过程可能增加新表或变更版本字段。
- 解析器未修改；也可能只是维护者尚未检查到差异。

公开社区还有个案称 1.1.3 存档不能直接转换到 2.0.2，而先经 1.3.2 保存后可以转换。它是低样本量的社区报告，不能作为格式规范，但足以说明 PoC 要使用**游戏已正常打开并重新保存的 2.0.2 文件**，不要拿两年前的旧存档代替。

## 六、建议的只读实现

### 6.1 技术路线

在 `.NET 8 + WPF` 应用中增加独立的 `GbfrSaveReader` 组件：

```text
发现文件
  -> 创建一致性内存快照
  -> 校验文件头和偏移范围
  -> 解析 SlotData FlatBuffer
  -> 校验当前 XXHash64
  -> 枚举 2703 因子实例
  -> 配对 1701/1702 主副词条
  -> 通过版本化数据包解析 ID/中文名
  -> 产出不可变 SigilInstance[]
  -> 交给求解器
```

有两种合理实现方式：

1. **优先建议：复用 Nenkai 的 MIT schema/解析思路，写本项目专用的最小只读层。** 只包含需要的头、FlatBuffers 表、哈希校验和因子字段，攻击面和维护成本最低。
2. 直接引用或抽取 `GBFRDataTools.SaveFile`。开发更快，但会带入本项目不需要的通用模型，并且上游 `FromFile` 在校验失败时包含“修复当前哈希”的内部逻辑，虽然不会写回输入文件，仍不适合直接成为产品的只读语义。若复用，应封装并去掉任何修复路径。

不要复制 `GBFR-Sigil-Generator` 的源码或数据。其 GitHub 存续分叉未见清晰的项目级开源许可证，Nexus 页面也声明了较严格的再利用限制；它适合作为格式事实的交叉证据，而不是代码依赖。Nenkai 的 `GBFRDataTools` 明确采用 MIT License，复用时保留版权与许可证文本即可。

### 6.2 真正做到只读

“界面上没有保存按钮”不等于只读。实现需同时满足：

- 文件只用 `FileAccess.Read` 打开，允许 `FileShare.ReadWrite | FileShare.Delete`，以便游戏或 Steam 不因工具被阻塞。
- 先复制到内存或应用临时快照，再解析快照；解析过程中不长时间持有原文件句柄。
- 读取前后比较文件长度和 `LastWriteTimeUtc`；若变化，重试一次，仍变化则提示“游戏正在保存，请稍后重试”。
- 可选计算读取前后的 SHA-256；测试版必须验证原文件字节与 mtime 均未改变。
- 解析器不暴露 serialize、patch、fix-hash、write-back API。
- 不关闭 Steam Cloud，不移动、不重命名、不替换用户文件。
- 不把存档复制到项目目录或日志目录；内存快照在导入后释放。

### 6.3 错误与兼容策略

- 头偏移越界、FlatBuffer 校验失败、有效 XXHash64 不匹配：停止导入，显示可操作错误，不尝试修复。
- 遇到未知 `mainVersion/subVersion`：可以做结构探测，但 UI 必须标注“未验证版本”。只有关键字段一致且 PoC 规则通过才允许进入求解。
- 遇到未知因子/词条哈希：保留原始哈希并列入诊断，不静默忽略；未知主/副词条会使完整求解失真，应阻止“结果完整”的绿色状态。
- 单个实例缺少配对 `1701/1702`：记录为损坏/未知实例并提示计数，不将它伪装成单技能垃圾因子。
- 版本化数据包应记录适配游戏版本、来源和构建日期。解析代码与名称字典分离，游戏更新通常只需更新数据包。

### 6.4 隐私与安全

存档头含 64 位 Steam ID，槽位数据还可能包含玩家名、关注/最近玩家、在线资料等与配装无关的信息。应用应遵循数据最小化：

- 不上传存档，所有解析和求解本地完成；
- 不在日志、崩溃报告、遥测中记录 Steam ID、玩家名、完整路径或原始存档；
- 诊断导出默认只含版本号、未知哈希和字段计数，并对路径脱敏；
- 如果未来提供“上传样本帮助适配”，必须由用户明确选择，并在上传前展示会发送的字段。

## 七、法律、服务协议、封号与损坏风险

### 7.1 官方条款事实

Steam 上的《Granblue Fantasy: Relink》服务协议最后更新于 2026-04-23。与本项目直接相关的条款包括：

- 第 5 条第 3 款限制修改、复制、适配、逆向工程、反编译等行为。
- 第 11 条第 1 款第 (14) 项限制对服务进行反汇编、反编译、逆向，以及未经授权操作、修改、获取、分发或发布相关数据。
- 第 11 条第 1 款第 (16) 项限制使用、制作、分发或销售未经 Cygames 提供且会影响服务的外部工具、机器人或修改设备。
- 第 11 条第 2 款允许 Cygames 采取撤销物品、暂停服务、暂停或删除账号等措施。

因此不能宣传“官方允许”“绝对不会封号”。只读本地配装导入不修改游戏、不注入进程、不自动操作网络服务，技术风险明显低于存档编辑器或作弊工具；但它仍建立在逆向获得的格式上，是否落入条款限制没有官方豁免说明。

### 7.2 本项目应采取的边界

- 只读，不提供存档写回、签名修复、物品生成、改等级、改 Steam ID 或跨账号存档功能。
- 不注入游戏进程，不读取游戏内存，不规避反作弊或网络限制。
- 不提供“合法因子生成器”“离线作弊”等隐藏入口。
- 产品文案写明“非官方、与 Cygames 无关联；仅在本地读取用户选择的文件”。
- 将“在线使用是否安全”表述为未知风险，不能引用社区“没有反作弊”说法作保证。

### 7.3 损坏风险

纯只读解析器本身不会改变存档，所以不会因重算错误直接损坏文件。实际风险来自：

1. 游戏或 Steam 正在写入时读到不一致快照，导致错误库存；通过稳定快照和哈希校验处理。
2. 应用误用写权限、临时文件覆盖原文件或把输出路径指向输入；通过移除全部写 API 处理。
3. 用户把第三方编辑器产生的已损坏存档当正常存档导入；只读工具应报告校验失败，不“帮忙修复”。
4. Steam Cloud 冲突。读取器不应改 Cloud 设置或云镜像，因此只承担展示提示的责任。

官方 1.0.5 已加入备份存档，但社区仍长期报告存档损坏。即便本工具只读，首次导入页仍可以提示玩家自行备份；不要由应用自动搬动或替换存档来“帮用户备份”。

## 八、PoC 验收判据

在开始完整 UI 和求解器集成前，用 1—2 天完成只读 PoC。**必须使用用户自己当前能正常加载的真实存档，且先退出任务或等待自动保存结束。**

### 8.1 样本

最低样本集：

- 2 份不同玩家、由 2.0.2 正常保存的 Windows/Steam 存档；
- 如能获得，再加 1 份 1.3.2 存档做回归；
- 至少一份库存较大、包含完全相同重复因子、锁定因子和已装备因子；
- 至少包含普通 V+、角色专属双技能因子、固定双技能因子和单技能因子。

样本只在本机测试，不提交 Git，不上传公共服务。

### 8.2 必过检查

1. **零写入**：导入前后原文件 SHA-256、长度、创建时间和修改时间完全一致。
2. **结构**：头版本与两个块范围合法；SlotData 能通过 FlatBuffers 解析；当前 XXHash64 校验通过。
3. **数量**：解析出的所有已占用因子数量与游戏 UI 统计一致；双技能过滤后的数量可通过筛选页核对。
4. **内容**：对每份存档至少抽查 30 个双技能因子，主词条、副词条、顺序、因子等级均 100% 与游戏 UI 一致。
5. **重复件**：准备至少 2 个技能和等级完全相同的实例，解析结果数量必须为 2，且实例键不同。
6. **差分**：在游戏中获得或出售一个已知因子并再次保存；两次解析快照的差异应只表现为相应库存实例及游戏自然更新字段，不得出现批量错位。
7. **装备/锁定**：被装备或锁定的因子仍被枚举，状态字段与 UI 一致。
8. **未知字典**：目标范围内所有已持有双技能因子的两个词条都能映射到稳定内部 ID；中文名称未知率为 0。若只有名称缺失，不丢失哈希与实例。
9. **并发保存**：游戏正在自动保存时，PoC 必须重试或明确失败，不能返回一份看似成功的半快照。
10. **健壮性**：截断文件、随机文件、旧备份和错误的 `SystemData.dat` 不导致崩溃，也不被误报为成功导入。

建议性能门槛：在普通 SSD 上，最大常见存档的发现、复制、校验和因子解析合计小于 2 秒；这不是技术瓶颈，准确性优先。

### 8.3 决策闸门

- 上述 1—10 全部通过：确认方案一，正式实现存档导入；CV 仅保留为未来兼容兜底，不进入 MVP。
- 2.0.2 只是新增字段或未知哈希：仍采用方案一，更新 schema/字典，不转 CV。
- 连续两轮真实样本都无法稳定解析核心因子，且无法通过新版本表或上游研究定位字段：才启动 CV 路线。

CV 自动滚动会引入分辨率、UI 缩放、语言、帧率、遮挡、排序、重复行和滚动丢帧等新误差。既然当前存档字段已有直接证据，就不应把 CV 当成并行主方案。

## 九、建议的下一步

1. 用户提供或在目标 Windows 机器上就地运行 2.0.2 样本验证，不需要把存档发送到网络。
2. 做一个命令行只读 PoC，仅输出脱敏 JSON 和诊断摘要；禁止任何写回代码进入该项目。
3. 用 `GBFRDataTools` 现有 MIT schema/字段定义实现头和 SlotData 解析，加入主动哈希校验。
4. 从 2.0.2 游戏数据与 `choeki/gbfr-relink-sim` 交叉生成“词条哈希 -> 稳定内部 ID -> 简中名”版本化数据包。
5. PoC 按第八章验收，通过后再接入 WPF UI 和求解器。

## 十、来源与证据分级

以下链接均于 **2026-07-22** 访问。

### A. 一手代码与官方来源

1. [Nenkai/GBFRDataTools：仓库首页，当前检查提交 `92064d4`](https://github.com/Nenkai/GBFRDataTools/tree/92064d46062fd0649f972470492278f1f5577884)
   证据：项目包含 `GBFRDataTools.SaveFile`，许可证为 MIT；当前仓库已更新到 Endless Ragnarok 时代。
2. [`GBFRDataTools.SaveFile/SaveFile.cs` @ `92064d4`](https://github.com/Nenkai/GBFRDataTools/blob/92064d46062fd0649f972470492278f1f5577884/GBFRDataTools.SaveFile/SaveFile.cs)
   证据：文件头字段、两个 FlatBuffers 块、XXHash64 种子、十个哈希区段和有效哈希选择逻辑。
3. [`GBFRDataTools.FlatBuffers/SaveDataBinary.fbs` @ `92064d4`](https://github.com/Nenkai/GBFRDataTools/blob/92064d46062fd0649f972470492278f1f5577884/GBFRDataTools.FlatBuffers/SaveDataBinary.fbs)
   证据：存档标量表、`IDType`、`UnitID` 与 `ValueData` schema。
4. [`GBFRDataTools.SaveFile/SaveIDType.cs` @ `92064d4`](https://github.com/Nenkai/GBFRDataTools/blob/92064d46062fd0649f972470492278f1f5577884/GBFRDataTools.SaveFile/SaveIDType.cs)
   证据：`2701/2702/2703/2704/2706/2707` 的公开注释和类型。
5. [Nenkai Relink Modding：Save Unit IDs](https://nenkai.github.io/relink-modding/resources/re/save_units/)
   证据：GemManager 的 5100 实例循环和相关 `270x/170x` 单元；页面同时警告仍可能缺少部分类型。
6. [Nenkai Relink Modding：Sigil/Gem IDs](https://nenkai.github.io/relink-modding/resources/sigil_gem_ids/)
   证据：因子内部 ID、英文名与哈希映射；页面标注数据版本为 `1.3.x`。
7. [Nenkai Relink Modding：Trait/Skill IDs](https://nenkai.github.io/relink-modding/resources/trait_skill_ids/)
   证据：词条内部 ID 与哈希映射。
8. [BitterG/GBFR-Sigil-Generator 存续分叉，提交 `97f0dc7`](https://github.com/BitterG/GBFR-Sigil-Generator/tree/97f0dc7b2110521b2aa923391e68702a6628fedb)
   证据：原作者仓库现已不可访问，但该公开分叉保留 2026-06-01 的完整源码与历史。
9. [`SaveEditorService.cs` @ `97f0dc7`](https://github.com/BitterG/GBFR-Sigil-Generator/blob/97f0dc7b2110521b2aa923391e68702a6628fedb/SaveEditorService.cs)
   证据：因子实例写入、`1701/1702` 主副词条配对、逐字段复读验证。
10. [`Program.cs` @ `97f0dc7`](https://github.com/BitterG/GBFR-Sigil-Generator/blob/97f0dc7b2110521b2aa923391e68702a6628fedb/Program.cs)
    证据：只读外层解析、空/占用库存枚举、原始 FlatBuffer 标量定位、XXHash64 写回逻辑和常量。
11. [`docs/current-save-editing-flow.md` @ `97f0dc7`](https://github.com/BitterG/GBFR-Sigil-Generator/blob/97f0dc7b2110521b2aa923391e68702a6628fedb/docs/current-save-editing-flow.md)
    证据：`gemIndex`、主副词条 `UnitID` 公式及字段说明。
12. [Cygames：Ver. 2.0.2 Update Information](https://relink-ragnarok.granbluefantasy.com/en/updates/381/)
    证据：2.0.2 发行状态，以及继续使用既有存档玩家的说明。
13. [Steam：《Granblue Fantasy: Relink》Terms of Service Agreement](https://store.steampowered.com/eula/881020_eula_0)
    证据：2026-04-23 更新的官方服务协议，尤其第 5、11 条。
14. [Nenkai/GBFRDataTools MIT License](https://github.com/Nenkai/GBFRDataTools/blob/92064d46062fd0649f972470492278f1f5577884/LICENSE.txt)
    证据：可复用代码的许可条件。
15. [首次加入存档解析的提交 `f639a7a`](https://github.com/Nenkai/GBFRDataTools/commit/f639a7aa52c6290b735b4af13a4b2249845093a6)
    证据：可追溯 2024-03-23 时已经存在的外层头、FlatBuffers 和哈希校验实现。
16. [修正 FloatTable 并扩充存档 ID 的提交 `6ce0540`](https://github.com/Nenkai/GBFRDataTools/commit/6ce05408753a67710b237ea507da340961da9dfe)
    证据：2026-03-07 的 schema/文档变化范围；因子核心枚举和主副词条布局未在该提交中改变。
17. [choeki/gbfr-relink-sim，检查提交 `6aba7fc`](https://github.com/choeki/gbfr-relink-sim/tree/6aba7fc633e870de65f26c01462cdbe1dd6b6baa)
    证据：当前技能、因子与简中显示数据的交叉参考；它不是存档解析器，不能单独证明存档布局。

### B. 工具发布页与平台配置

18. [Nexus Mods：GBFR Sigil Generator](https://www.nexusmods.com/granbluefantasyrelink/mods/582)
    证据：2026-05-31 首次发布、2026-06-19 更新；工具会从用户选择的存档副本生成新存档，并声称可创建指定主/副词条和等级。它是实践佐证，不是官方格式规范。
19. [SteamDB：Granblue Fantasy: Relink Cloud Saves](https://steamdb.info/app/881020/ufs/)
    证据：`WinAppDataLocal/GBFR/Saved/SaveGames/*.dat`、App ID 881020、云存档文件限制。SteamDB 是对 Steam 配置的展示，不是 Cygames 文档。
20. [SteamDB：Ver. 1.0.5 Update Information](https://steamdb.info/patchnotes/13445086/)
    证据：Steam 版保存时会在可能的情况下创建备份数据。

### C. 社区交叉证据，仅作辅助

21. [nyaoouo：2024 年“因子添加”数据表 Gist](https://gist.github.com/nyaoouo/c32b8c93e4505eb393b75df2e0ecd23b)
    证据：游戏发布初期即有人通过因子哈希区分主词条和随机/固定副词条；可交叉验证部分旧因子哈希与中文名。数据未经官方保证，不应直接作为 2026 生产字典。
22. [Reddit：2.0.2 旧存档转换个案](https://www.reddit.com/r/GranblueFantasyRelink/comments/1ur1etw/granblue_fantasy_relink_endless_ragnarok_pc/)
    证据：有用户报告 1.1.3 旧存档直接转换失败，而经 1.3.2 保存后可转换。低置信度，只用于制定版本 PoC，不用于断言通用兼容规则。

## 十一、事实、推断与未知项总表

| 类别 | 内容 |
|---|---|
| 已由代码确认 | 文件头、FlatBuffers schema、无解密/解压步骤、XXHash64 校验、因子 `2703/2704`、词条 `1701/1702`、主副词条配对公式、实例不去重 |
| 由多源实践支持 | 1.3.x 存档可以编辑并重新载入；指定主副词条和等级可以写入；Windows 主路径为 `%LOCALAPPDATA%` |
| 合理推断 | 2.0.2 继续沿用核心结构；只读解析比 CV 更稳定、比写入工具风险低 |
| 仍未知/待 PoC | 2.0.2 真实大库存存档是否 100% 沿用所有因子单元；全部 2.0 新词条哈希和简中名；`2707` 所有标志位语义；官方是否会明确允许纯只读配装导入工具 |

最终工程决策：**先实现并验证只读存档 PoC；验证成功后直接进入方案一，不开发 CV。只有第八章的决策闸门明确失败，才启动 CV。**
