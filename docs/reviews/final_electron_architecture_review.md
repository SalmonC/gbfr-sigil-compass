# Electron 最终架构实现前终审

## 结论

**当前结论：NO-GO，不能开始正式源码迁移或产品实现。**

原因不是 Electron + .NET Engine 路线不可行，而是架构自己定义的 P0 目录准入门槛尚未关闭。`software-architecture.md:236` 明确规定“P0 未关闭前不迁移源码”，而 `latest_catalog_audit.md:157-159` 仍列出三个 P0。当前可以继续做不冻结业务事实的研究、数据提取、匿名 fixture 和一次性协议实验，但不能删除 WPF 组合根、生成正式 Desktop Schema、把临时 Catalog 写进产品，或宣称已进入 MVP 实现。

P0 关闭且下列 P1 合同问题修订后，方案可以进入 `software-architecture.md:237-242` 的分阶段实现。总体技术方向是成立的：Electron 只负责桌面权限和窗口，C# Engine 持有业务规则，SaveReader Worker 隔离不可信存档，Renderer 只消费 ViewModel；这条边界兼顾低耦合、安全、Windows 首发、macOS 调试、只读导入和分进程诊断。

## 审阅范围与判定口径

本次以当前磁盘版本为准，逐项核对原始需求、软件架构、Electron ADR、目标编辑器、排序规格、两份调研审计、设计系统、任务计划和新增截图夹具，并抽查现有 Domain/Application 合同与测试策略。优先级含义如下：

- **P0**：违反已经冻结的发布/迁移闸门，继续实现会把未经核验的数据或错误身份固化进产品。
- **P1**：架构方向可行，但实现前必须补齐或统一；否则不同进程、UI 与测试会形成不兼容事实源。
- **P2**：不阻止搭建，但应在对应功能合入前修订，避免可访问性、运维或文案债务。

## 需求逐项核对

| 核对项 | 结果 | 证据与判断 |
|---|---|---|
| 只有“可选目标”显示动态上限 | 通过 | `block-pool-ui.md:58-68` 和 `ranking-specification.md:9-21` 均定义 `24 - MandatoryTargets.Count - BasicPrimaryTargets.Count`；其他标题禁止显示配额徽标。 |
| 其他子目标只显示帮助 | 通过 | `block-pool-ui.md:72-83` 要求六个标题都有可悬停、可聚焦的问号；只有可选目标气泡含实时 remaining。 |
| 两侧视觉分区不显示总栏名 | 通过 | `block-pool-ui.md:5` 明确不显示“技能池”“目标技能”总标题。 |
| 激活、取消、添加、删除 | 有条件通过 | `block-pool-ui.md:33-41` 已冻结单激活、再次点击取消、左侧添加后保持激活、右侧只删一个 occurrence；问号等嵌套控件的事件边界和键盘状态机仍需 P1-3 补齐。 |
| 重复、顺序、互斥 | 有条件通过 | 三个目标序列可重复且有序，替代池有序唯一，两个屏蔽池无序唯一，六域互斥；现有 ADR、测试和 C# 合同仍残留五域/普通目标模型，见 P1-1。 |
| 灰显与具体原因 | 通过，待协议固化 | `block-pool-ui.md:99-107` 已定义原因优先级、可聚焦伪禁用、`CanAdd/CanRemove` 和旧配置原子修复；P1-2 要求用版本化编辑命令避免异步结果覆盖。 |
| Electron + .NET Engine 低耦合 | 通过 | `software-architecture.md:23-122,191-205` 分离 Renderer、Preload、Main、Engine、Worker、Domain/Application 和 adapters；业务能力经窄接口与 JSON Schema 传递。 |
| Electron 安全基线 | 有条件通过 | 隔离、沙箱、CSP、sender 校验、禁止通用 IPC 和生产调试口均已定义；子进程定位、path grant 防重放和资源完整性仍需 P1-5。 |
| Windows 首发与 macOS 调试 | 通过，待能力协商细化 | `software-architecture.md:207-217` 定义目标 RID、自包含 Engine/Worker、各 OS 原生 CI/签名；平台不支持能力的 UI 降级见 P2-3。 |
| 原存档只读 | 有条件通过 | `software-architecture.md:126-153,181-189` 与 `reference_site_and_save_tool_audit.md:172-180` 均禁止写回源文件；真实存档验证和备份保留策略仍未闭合，见 P1-6、P1-7。 |
| 可独立调试与故障隔离 | 通过 | Engine 可单独运行协议夹具，结构化日志跨进程关联，Worker 可超时终止，Engine 仅重启一次，生产诊断页脱敏。 |

## 截图基准专项核对

`docs/testing/screenshot-reference-profile.md` 的容量计算正确：必须满足 8 项、基础能力主词条 5 项，因此可选上限为 `24 - 8 - 5 = 11`；当前可选项 8 项，应显示 **`8 / 11`**，帮助气泡实时剩余数为 **3**。必须满足和基础能力主词条标题只显示问号，不显示 `8 / ?` 或 `5 / 5`。这与最终交互及排序规格一致。

双 Berserker 身份也已正确冻结：

| 稳定英文名 | 中文显示名 | Trait hash | 夹具位置 |
|---|---|---|---|
| Berserker Echo | 狂战士 | `0xEE85CD1F` | 可选目标 |
| Berserker | 穷寇心 | `0x70395731` | 禁止出现 |

两者 ID/hash 不同，因此不违反六域互斥。Catalog、搜索别名、occupancy、保存/分享、request hash 和求解器都必须按稳定 ID 处理，禁止按“狂战士/穷寇心”的近似中文或英文前缀合并。该夹具应保留为 Catalog 准入与端到端回归的强制反例。

## P0：当前阻断正式实现

### P0-1：Ver. 2.0.2 Catalog 发布事实尚未过闸

`latest_catalog_audit.md:153-168` 已明确列出三个 P0：

1. 本项目尚未从合法 2.0.2 安装副本独立提取 `gem`、Trait 与简中本地化映射，不能保证所有存档 hash 可识别。
2. 六名新角色的专属 Trait 与因子物品关系不完整，可能导致库存未知或目标选择器漏项。
3. Super Ultimate Perfect Dodge 的第三方分类错误，尚需用游戏表/画面建立本地 Attack 分类回归证据。

这不是“未知条目可优雅降级”能够替代的门槛：截图方案、六域互斥、Basic Stats 资格和 Berserker 身份都直接依赖稳定 Catalog。若现在生成协议/持久化 schema 或 UI fixture，临时显示名和第三方分类会成为事实源，后续迁移将同时影响 profile、分享字符串、request hash 和旧结果解释。

**关闭条件：**逐项满足审计表的关闭条件；Catalog 数据包记录游戏版本、来源、转换器版本和稳定 hash；至少把截图夹具涉及的全部 Trait、双 Berserker 和 Super Ultimate Perfect Dodge 纳入自动准入测试。关闭前遵守 `software-architecture.md:236`，不迁移源码。

## P1：P0 关闭后、正式实现前必须修订

### P1-1：六域最终合同尚未成为唯一事实源

最终规格是六个选择域：`MandatoryTargets`、`BasicPrimaryTargets`、`OptionalTargets`、有序替代池、Forbidden、SoftBlocked；共有 15 组两两交集，前四者保序，只有两个屏蔽集合规范排序。`ranking-specification.md:9-21,47-54` 已写正确。

但当前仍存在互相冲突的合同：

- `testing-strategy.md:34` 仍写“五域 10 组交集”“三个有序域”，与同文件第 29-30 行及最终六域模型冲突；正确值应为六域 15 组、四个有序域。
- `adr/0007-hard-and-soft-skill-blocks.md:17,27` 仍用“普通目标”五域和“两个屏蔽面板”的旧表述。
- `BuildRequest.cs:5-14`、`NormalizedBuildRequest.cs:5-16` 仍暴露 `OrderedNormalTargets + MandatoryPrefixLength`；`BuildRequestNormalizationResult.cs:28-35` 的 enum 也只有五域。
- `ranking-specification.md:43,80,119-126` 仍多处以“普通目标”代称最终的可选目标/旧模型，容易在实现时误读。

现有 C# 是待迁移骨架，本身不是意外回归；问题在于若据此先生成跨进程 Schema，就会把旧前缀模型冻结为公开协议。

**修正：**先统一文档与测试语汇，再定义新 schema：三个显式 occurrence 序列、一个启用态有序唯一替代池、两个无序集合；occupancy enum 必须有六个独立 domain。`MandatoryPrefixLength` 只能存在于旧配置迁移 DTO，不能进入新请求、UI ViewModel 或 request hash。为六域 15 组交集及 A→B/B→A 编辑顺序建立参数化测试。

### P1-2：异步 `EvaluateTargetEdit` 缺少草稿版本与迟到响应规则

`software-architecture.md:157-159` 让每次编辑经 Engine 计算，同时只对分析结果规定迟到响应不能覆盖页面；`DesktopApi` 示例也未冻结编辑命令/返回类型。用户快速切换激活区、连续添加重复项、删除 occurrence 或撤销时，IPC 响应可能乱序，旧响应会回滚新草稿或把技能添加到已经不再激活的区域。

**修正：**编辑命令至少携带 `draftId`、单调 `baseRevision`、`editId`、命令产生时捕获的目标 domain 和精确 occurrence/index；Engine 返回 `acceptedRevision` 与规范化摘要。单草稿编辑串行化或使用 compare-and-swap，Renderer 丢弃低于当前 revision 的响应。保存/分析仍做完整 normalizer 校验。把上述竞态加入 Renderer 与协议测试。

### P1-3：嵌套帮助控件和键盘激活的事件边界未冻结

`block-pool-ui.md:35-36` 规定点击标题、说明或空白区域会激活/取消；问号按钮又位于标题内。若不明确排除交互子控件，点击问号会同时打开 tooltip 并切换激活区，`Esc` 也可能同时关闭气泡和退出添加状态。现规格还未定义区域焦点后的 Enter/Space、添加后的焦点保持及删除按钮的可访问名称。

**修正：**明确帮助按钮、开关、技能 chip、删除按钮等交互后代不触发区域激活并阻止冒泡；规定 Enter/Space 激活/取消区域、Esc 优先关闭当前 tooltip 后再退出添加态、添加/删除后的焦点落点和读屏公告。将鼠标与键盘状态转换写成同一状态机测试。

### P1-4：有序重复目标不能无条件聚合成 `×N`

设计系统允许 chip 独立显示或聚合为 `×N`，但三个目标域既允许重复又保序。对 `[A,B,A]` 做全局聚合会丢失顺序，点击一个聚合 chip 删除时也无法确定 occurrence，直接破坏覆盖向量、保存/分享和 deterministic witness。

**修正：**默认给每个 occurrence 稳定草稿 ID 并逐项显示；若为了密度聚合，只能压缩相邻同值 run，且展开/删除必须映射到确定 index。协议和持久化按序列保存，绝不能只存 `{skillId,count}`。截图夹具中的 Damage Cap ×3、Supplementary DMG ×3 和 Stun ×3 应覆盖“只删一次、顺序不变”。

### P1-5：Engine/Worker 启动和 path grant 仍缺少可执行安全合同

现架构已经禁止 Renderer 提交路径并要求 sender 校验，但实现前还需冻结以下边界：

- grant 使用密码学随机不可猜 ID，与当前 WebContents/session、规范化后的普通文件路径和单个操作绑定；一次使用、短 TTL、使用后/窗口销毁后撤销，禁止目录、符号链接换目标和重放。
- Main 只能从已打包只读资源的固定绝对路径启动 Engine，Engine 同理启动 Worker；`shell:false`，不从 `PATH`、用户目录、请求参数或可变环境决定可执行文件。
- Forge 明确 Engine/Worker 的 `extraResource`/asar 布局、平台 RID、权限位和安装后定位；握手校验协议、能力和构建清单，签名/包完整性失败时停止运行。
- 限制同时操作数、消息/事件队列和进度频率，避免合法 Renderer 事件或畸形输入造成无界内存与进程风暴。

这些要求应进入 Main/Preload/Packaging 的自动测试，而不只依赖代码审查。

### P1-6：默认长期备份缺少保留与删除策略

`software-architecture.md:145,183-189` 决定默认长期备份，但只说“显示保留策略”，没有冻结保留数量/时长/总空间、文件权限、原子写入、磁盘满处理和删除边界。原始存档属于敏感本地数据，长期无限复制会制造隐私与磁盘风险。

**修正：**定义明确上限与回收顺序；备份只来自已经稳定读取并完成 hash 校验的快照，使用临时文件、flush 和同目录原子 rename；目录/文件权限按平台收紧；删除仅解析应用自有清单中的规范化备份路径，永不跟随链接，永不触碰源 SaveGames；磁盘不足时导入失败但保留上次成功库存。UI 必须能关闭默认备份并单独删除备份。

### P1-7：真实存档只读 PoC 尚未完成，不能进入正式导入集成

`reference_site_and_save_tool_audit.md:135-148` 明确当前只验证了参考源码存在读取路径，没有用户真实存档实测；`task_plan.md:98,100` 的只读样本验证和 raw hash/unknown 状态贯通也未完成。架构对只读边界的设计是正确的，但无法据此宣称解析兼容性已经成立。

**修正：**按审计中的匿名矩阵验证正常、备份、多槽、装备/锁定/单词条/V+/角色专属/未知项、截断与并发变化；断言读取前后源文件 hash 不变、没有静默 500 条上限、未知 raw hash 贯穿 Worker→Engine→IPC→InventorySnapshot。此项不阻止在 P0 关闭后搭建假用例的 Engine/Electron 骨架，但阻止接入和发布真实库存导入。

## P2：对应功能合入前处理

### P2-1：容量异常显示需定义 clamp 与修复文案

旧配置可处于三类目标总数大于 24 的修复态。此时公式可能产生负的可选上限。显示层应使用 `max(0, 24 - mandatory - basic)`，另行显示“已超出 N 项”，保留数据、禁用新增和分析；不要展示 `8 / -2`，也不要为了让数字好看而静默删除 occurrence。

### P2-2：基础主词条帮助文案应坚持“优先”而非“保证”

`block-pool-ui.md:77` 的“会先保证数量和匹配顺序”可能被理解为硬约束，而 `ranking-specification.md:27` 明确未满 X 的方案仍输出。建议改成“会优先比较已满足数量、精确匹配和替代顺序”，并沿用“未完全满足仍显示”的说明。

### P2-3：平台能力应进入握手与 UI 可用性

Windows 是正式目标、macOS 是开发/可选产物，这一取舍合理。仍应在 Engine handshake 中返回 `saveDiscovery`、`fileImport`、`workerSandbox` 等能力；不支持 Windows 默认存档发现的平台只隐藏/禁用自动发现并解释原因，保留原生文件选择和固定 fixture 调试，避免 Renderer 用平台判断复制业务逻辑。

### P2-4：冻结工具链与可复现构建版本

实现前记录 Node LTS、包管理器、Electron、Forge、.NET SDK/RID 和 lockfile 策略；CI 用同一版本矩阵。当前架构要求提交依赖锁文件与维护更新窗口，但尚未给出项目级版本钉住位置。

### P2-5：任务计划存在已完成工作未回填和历史决策噪声

`task_plan.md:96-105` 仍把最新目录调研和截图夹具标为未完成，Phase 9 Addendum 仍写旧五域/双面板，历史 Avalonia 决策也容易被脱离上下文引用。保留历史决定可以追溯，但应标注 superseded，并按真实闸门状态更新 checklist，避免实现人员以任务计划覆盖当前架构规范。

## 允许开工的最小门槛

正式实现前至少完成：

1. 关闭 `latest_catalog_audit.md:157-159` 的全部 P0，并提交可重复的 Catalog 准入证据。
2. 修订 P1-1，使排名规格、ADR、测试策略和即将生成的 C#/TS Schema 对六域、24 容量及迁移语义完全一致。
3. 在 Desktop Schema 中冻结 P1-2 的版本化编辑协议、稳定 occurrence 身份，以及 P1-5 的 grant/子进程边界。
4. 冻结 P1-3/P1-4 的输入状态机和有序重复渲染规则，以截图基准作为首个黄金用例。
5. 在接入真实导入前完成 P1-6/P1-7；在发行前通过 `software-architecture.md:219-232` 的安全、只读、E2E、打包和 Catalog 闸门。

达到 1-4 后可以开始架构第 2-3 步的假用例 Engine Host 与 Electron 安全骨架；达到第 5 项后才能把真实存档导入称为已实现。当前尚未达到第 1 项，因此最终判定仍为 **NO-GO**。

---

## 第二轮复审附录（修订后）

> 本节以修订后的当前磁盘内容为准，是对上文初次结论的最新判定。初次发现保留用于追溯，不再把正式 Catalog P0 与纯 `test.*` 基础设施开工合并为同一道闸门。

### 两道开工结论

| 闸门 | 结论 | 允许与禁止范围 |
|---|---|---|
| **A. 仅使用 `test.*` 合成 Catalog 创建 Desktop Schema、Engine Host 和 Electron 安全骨架** | **GO** | 可实现六域 schema/生成类型、协议握手、revision 草稿、Main/Preload 安全边界、固定子进程启动、合成 UI 状态机和打包冒烟。禁止真实 Skill hash、社区翻译/分类、真实存档、正式 profile/分享字符串进入该阶段。 |
| **B. 接入正式 Ver. 2.0.2 Catalog 和真实存档** | **NO-GO** | `latest_catalog_audit.md:157-159` 的正式目录 P0、`task_plan.md:98,100` 的真实只读样本与 raw hash 全链路仍未完成；不得接入正式 Catalog adapter、真实库存入口或发布用户数据功能。 |

这一分闸已由 `software-architecture.md:252-261` 明确写入迁移顺序。A 的 GO 不表示产品 MVP 或正式数据已经过闸，也不改变未知真实技能不得猜测映射的要求。

### 原 P1 关闭情况

| 原发现 | 架构层状态 | 修订证据与复审判断 |
|---|---|---|
| **P1-1 六域合同漂移** | **已关闭** | `desktop-contracts.md:24-45` 冻结六个 domain、三条可重复序列、一个有序唯一替代池、两个无序集合、15 组交集和 `MandatoryPrefixLength` 仅限迁移输入；`testing-strategy.md:29-35`、`ranking-specification.md:43-54`、ADR 0007:17-27 已同步。现有 C# 五域 record 仍是待迁移源码，不再作为新 Schema 来源；`software-architecture.md:253-256` 把合成六域合同置于接通旧 Domain 之前。A 阶段必须保持这条边界，不能从 `BuildRequest.cs` 反向生成 Desktop Schema。 |
| **P1-2 异步编辑竞态** | **已关闭** | `desktop-contracts.md:47-76` 定义 `draftId/baseRevision/editId/domain/entry`、Engine 串行 CAS、幂等重试、迟到响应丢弃、保存/分析二次校验及首版非乐观排队；`software-architecture.md:157-161` 已引用同一模型。 |
| **P1-3 嵌套控件与键盘边界** | **已关闭** | `block-pool-ui.md:43-50` 明确交互后代不触发容器、Enter/Space、Esc 优先级、添加/删除焦点与 `aria-live`；测试要求鼠标和键盘共享状态机用例。 |
| **P1-4 有序重复项身份** | **已关闭** | `desktop-contracts.md:37-45` 规定草稿稳定 `targetEntryId` 且持久化完整序列；`block-pool-ui.md:63-65` 禁止跨项全局聚合，仅允许保留 entry ID 的相邻 run，并定义单次删除。 |
| **P1-5 grant、子进程和拒绝服务边界** | **已关闭** | `desktop-contracts.md:78-121` 冻结 128-bit grant、sender/session/用途/文件身份绑定、TTL/一次消费、realpath/普通文件复核、固定资源路径、`shell:false`、最小环境、manifest/RID/权限检查、帧/队列/并发/进度/重启上限；`testing-strategy.md:38` 和 `software-architecture.md:237-248` 将关键边界纳入测试门槛。构建实现时 manifest 的期望 hash 必须来自已签名/受信任包内容，不能只自洽地信任与二进制同目录的可替换 manifest。该实现注意事项不阻止 A 开工。 |
| **P1-6 长期备份策略** | **已关闭** | `software-architecture.md:193-203` 已定义稳定快照来源、临时写入/flush/hash/原子 rename、ACL/权限、10 份与 2 GiB 上限、每来源最后一份保护、清单约束删除、用户关闭/删除及磁盘失败行为；`testing-strategy.md:39` 有对应测试。 |
| **P1-7 真实存档 PoC** | **架构处置已关闭；实证闸门仍开放** | `testing-strategy.md:41-63` 冻结匿名 fixture 矩阵、前后 SHA-256、无 500 条截断和 unknown raw hash 全链路；`software-architecture.md:255-259` 明确它阻断正式接入但不阻断合成骨架。故它不再阻止 A，仍直接阻止 B。 |

复审未发现新的架构级 P1 阻断 A。尤其是六域/24 容量不再依赖旧 `OrderedNormalTargets + MandatoryPrefixLength`，编辑响应也不会因用户快速切换激活区而覆盖新草稿。

### 原 P2 关闭情况

| 原发现 | 架构层状态 | 修订证据与复审判断 |
|---|---|---|
| **P2-1 超限容量显示** | **已关闭** | `block-pool-ui.md:69-81` 使用 `max(0, …)`，显示“已超出 N 项”，保留数据并禁止新增、保存和分析。 |
| **P2-2 主词条软目标文案** | **已关闭** | `block-pool-ui.md:87-94` 已改为“优先比较”，同时明确未完全满足仍显示，不再暗示硬保证。 |
| **P2-3 跨平台能力协商** | **已关闭** | `desktop-contracts.md:13-22` 冻结能力集合和 `saveDiscovery=false` 的 macOS 行为，Renderer 不自行复制 OS 判断。 |
| **P2-4 可复现工具链** | **已关闭** | `software-architecture.md:221-231` 定义 `.node-version`、精确 `packageManager`、精确前端依赖、`package-lock.json/npm ci` 和 `global.json`。精确版本在脚手架提交时落盘符合当前阶段。 |
| **P2-5 计划与历史噪声** | **已关闭，保留非阻断历史记录** | `task_plan.md:93-117,141-147` 已回填调研/截图状态、改为六域/统一技能池、标记 Avalonia 被替代并记录双闸门；`progress.md:5-29` 在当前 Phase 10 摘要中记录初审与修订。`progress.md:215-229` 仍保留当时五域/双面板的历史原文，但其位置是已完成阶段的事件日志，且当前摘要已明确 supersede，不再构成实现规范。 |

### A 阶段的硬护栏

A 的 GO 仅在以下约束持续满足时有效：

1. 合成稳定 ID 全部位于 `test.*` 命名空间；不使用 Berserker、Berserker Echo 等真实 hash、待核验中文名或社区分类伪装正式数据。
2. `contracts/desktop/v1` 直接表达 `desktop-contracts.md` 的六域合同；旧 C# `MandatoryPrefixLength` 只作为以后迁移输入，不能泄漏到新 schema、ViewModel 或 request hash。
3. Engine 在 A 阶段可以使用合成 Catalog/fake use case，但 Main/Preload、path grant、进程启动、CSP、sender 校验和资源上限必须按生产边界实现和测试，不能因为数据是假的而放宽安全设置。
4. 新 Electron/Engine 骨架可验证启动并通过安全/合同测试后，才按 `software-architecture.md:254` 删除旧 WPF 组合根；不同时保留两个生产入口。
5. A 阶段不读取真实 SaveGames，不生成可被误认为正式兼容的 profile/分享字符串，不把合成数据迁移为正式数据。

### 第二轮最终判定

**A：GO。** 原 P1-1 至 P1-6 和全部 P2 已在架构层闭合；P1-7 已被正确隔离成正式导入的实证闸门。可以开始只使用 `test.*` 合成 Catalog 的 Desktop Schema、Engine Host 与 Electron 安全骨架。

**B：NO-GO。** 正式 Catalog 三项 P0、真实存档只读 PoC 和 unknown raw hash 全链路仍未完成。只有这些证据通过并执行实现后审查，才可接入正式 Catalog 和真实存档。

---

## 增量勘误：必须满足与可选目标的 Skill ID 共享

### 结论

**修正正确，且比前两轮“六域全部互斥”的结论更符合原始需求。** 原始需求把目标定义为一个有序、可重复列表，并以“前 X 条”为必出前缀（`original_requirements.md:14-16,20-24`）。把该连续列表拆成 `mandatory` 与 `optional` 两个 UI/协议序列后，同一 Skill ID 跨过前缀边界仍必须合法；否则用户把重复技能放在边界两侧时，拆分后的模型会拒绝原列表本来允许的状态。

截图正是不可省略的反例：前 16 项包含 Damage Cap ×4，其中第 6-8 项属于必须满足，第 9 项属于可选目标（`screenshot-reference-profile.md:15-43`）。因此正确规则是：

- `mandatory ↔ optional` 双向允许共享同一 Skill ID；
- 两侧 occurrence 仍分别保存、分别计入 24 项容量并分别消耗技能 token，不能让一次 Damage Cap 同时满足两个 occurrence；
- 六域 15 组两两组合中，其余 14 组仍双向互斥；三个目标域内部的重复规则不变。

### 一致性核对

| 层级 | 结果 | 证据 |
|---|---|---|
| 原始业务语义 | 通过 | `original_requirements.md:14-16` 的有序重复列表和必出前缀天然允许相同技能跨前缀边界。 |
| UI 与容量 | 通过 | `block-pool-ui.md:63-81` 明确唯一例外；8 mandatory + 5 basic 仍得到 optional 上限 11，当前 8 项显示 `8 / 11`、剩余 3。共享 ID 不减少 occurrence 数。 |
| Desktop 合同 | 通过 | `desktop-contracts.md:35-45` 明确 15 组中的唯一放行组合，仍按独立 entry/position 持久化。 |
| 排序与 token | 通过 | `ranking-specification.md:47-62` 明确放行该交集，同时继续按 mandatory → basicPrimary → optional 统一一对一分配；没有发生跨 occurrence 双计数。 |
| ADR 与测试规格 | 通过 | ADR 0007:17 与 `testing-strategy.md:29-35` 均改为一组双向放行、其余 14 组双向拒绝。 |
| 截图夹具 | 通过 | `screenshot-reference-profile.md:22-43` 明确 Damage Cap 的 3+1 分段及 `8 / 11` 期望；Berserker Echo/Berserker 的稳定身份反例不受影响。 |
| Engine 规则 | 通过 | `TargetDraftSession.cs:77-82,129-131` 仅对 Mandatory/Optional 两个方向放行；其他不同 domain 仍返回 `desktop.draft.skill_occupied`。 |
| 真实自测 | 通过 | 执行 `dotnet run --project src/GBFRTool.Engine.Host -- --self-test` 成功，输出 `fixture capacity 8/11; priority-boundary sharing verified`；随后把 Damage Cap 加入 Forbidden 仍被拒绝。 |

`screenshot-reference-profile.md:76` 的“技能被一个区域占用后，在其他区域下……不可添加”仍有轻微字面歧义，应解释为“被互斥区域占用”；同文件第 28 行和总架构已经明确 mandatory/optional 例外。建议后续顺手补上“除必须满足↔可选目标外”，但这不影响规则、实现或本轮 GO 判定。

### 勘误后的闸门判定

- **A 仍为 GO**：可继续使用 `test.*` 合成 Catalog 实现 Desktop Schema、Engine Host 与 Electron 安全骨架；其互斥参数应固定为 1 组允许、14 组拒绝。
- **B 仍为 NO-GO**：正式 Catalog 与真实存档的外部证据门槛没有因本次规则勘误而改变。

本节取代上文所有“六域 15 组全部互斥”的旧表述；其他 P1/P2 复审结论保持不变。
