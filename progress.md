# Progress Log

## Session: 2026-07-24

### Phase 16: 结果手动调整

- **Status:** complete
- 已确认编辑语义、占用范围和持久化方式。
- 已将整枚因子的添加、删除与替换纳入本阶段。
- 正在梳理结果缓存、具体实例身份、确认配装和结果卡片的数据流。
- 手动结果纯函数评估、缓存槽位与求解期位置去重已实现；类型检查和工作区状态测试通过。
- oracle 已升级为位置敏感的目标外副词条去重规则，定向用例和 120 组随机穷举重新通过。
- 结果已移除“等级合计”，增加按技能聚合的等级列表；手动增删换因子后同步刷新。
- 真实 401 枚库存完成一次分析并返回 10 套结果；实际验证灰色附带词条、主副词条下拉替换、整枚替换入口、手动结果恢复和技能汇总联动。
- `npm run verify:release` 全部通过，涵盖类型、分享串、缓存与占用、库存快照、路径授权、图标、Renderer 回归和求解器 oracle。

## Session: 2026-07-23

### Phase 11: 编辑、结果缓存与多角色占用设计

- **Status:** complete
- 安装并完整读取 `op7418/Humanizer-zh`，后续用户可见文本按其直接、自然、少术语原则审阅。
- 读取参考截图并提炼“实例卡片而非可编辑槽位”的结果展示形式。
- 核查现有求解合同，确认结果已经保留具体因子实例身份，支持只占用实际选中的因子。
- 将本轮六组新增需求加入持久计划；产品决定确认后已完成实现、测试和 macOS 视觉检查。

## Session: 2026-07-22

### Phase 10 final implementation and release

- 实现严格只读 FlatBuffers/XXHash64 解析：主档 401 个 V+，两个备份各 399；损坏副本 fail-closed，三份源文件 hash 不变。
- Engine Host 通过固定路径启动独立 SaveReader Worker；Electron Main 使用 128-bit 一次性 path grant，并始终解析应用私有临时快照。
- UI 默认提供“读取后保留备份”选项，长期副本只写应用数据目录。
- 固定 Ver. 2.0.2 Catalog 快照并生成 r2：基础 4、攻击 39、防御 28、辅助 12、特殊 22、角色专属 91；纠正 SUPD 分类。
- 完成六域目标编辑、搜索/分类、互斥原因、重复 occurrence、动态可选容量、本地命名方案和带名称/Catalog 版本的 `GBFR-RANK-2` 分享字符串。
- 对抗审查发现并修复 Top-10 启发式裁剪、关闭主词条优先丢目标、基础精确/替代顺序缺失和 token 重复消费。
- 精确 DP 通过 5 个回归反例、120 组随机小库存穷举 oracle；真实主档约 14,550 状态、223 ms、10 个结果，首名基础主词条 1/5、可选 3/8。
- 求解运行于独立 Web Worker，复杂分析不阻塞 UI；ADR-0009 记录与原 C# Solver/SQLite 草案的差异。
- 最终生成 Windows x64 免安装 ZIP 和 macOS arm64 ZIP；两包引擎 manifest 分别校验 203/202 个文件，未混入异平台 runtime。
- macOS `.app` 启动成功，Engine 子进程正常，ad-hoc 深度签名和 `NSAllowsArbitraryLoads=false` 校验通过。
- Windows ZIP 已完成交叉构建、PE/结构/依赖/哈希检查；真实 Windows 10/11 启动冒烟仍需外部环境。

### Phase 10: 最新版调研、存档 PoC 与产品实现

- **Status:** in_progress
- Decisions received:
  - Electron 跨平台 UI 正式替换 Avalonia（Windows 正式支持，macOS 可调试）。
  - 长期备份默认开启，解析仍始终基于只读快照。
  - 未知技能保留原始标识并从求解器隔离。
- Actions taken:
  - 重新读取 brainstorming、planning-with-files、ui-ux-pro-max 的完整规范。
  - 确认本机测试夹具目录含 3 份 23,068,672 字节的角色存档样本及系统存档；真实存档不进入源码仓库。
  - 派发最新版技能目录和参考站点/存档工具两项并行只读研究。
  - 使用浏览器实际检查参考站首页和因子选择弹窗，确认当前筛选、搜索、双语卡片及 2.0.2 新技能覆盖。
  - 核查官方 Ver. 2.0.2 更新与 2026-07-21 Wiki，确认最新版和五类因子基线。
  - 计算三份角色存档 SHA-256 并读取文件头；未修改、复制或上传源文件。
  - 运行 UI 设计系统检索；拒绝不符合要求的霓虹/赛博视觉建议，仅保留可访问性和设计令牌原则。
  - 首次运行临时只读存档审计器失败：第三方 FlatSharp.Compiler 固定请求 .NET 9，本机仅安装 .NET 10；已记录并改用不安装旧运行时的前滚方案。
  - 用户中断 Avalonia 定稿，询问 Electron 跨平台可行性并重设目标编辑器交互；产品源码保持未改动。
  - 核验 Electron 官方进程、安全和发行文档；确认 Electron 可行，但必须采用沙箱 Renderer + 窄 Preload API + .NET Worker 的边界。
  - 将“点击激活子目标 → 从技能池添加 → 从目标项删除”的交互规则落盘。
  - 用户正式选择 Electron，并确认只有“可选目标”显示动态容量；所有子目标增加悬停/聚焦帮助气泡。
  - 重写目标配置 UI 规格，补齐重复策略、动态上限公式、不可添加原因优先级、冲突修复和无障碍行为。
  - 完成 Ver. 2.0.2 目录独立审计；记录第三方 seed 的误分类、新角色缺口、狂战士/穷寇心 ID 区分和正式目录准入规则。
  - 子 agent 完成 Electron 架构终审，初次结论 NO-GO：1 个 Catalog P0、7 个架构/集成 P1、5 个 P2。
  - 已修订六域合同、版本化草稿编辑、occurrence 身份、嵌套控件事件、path grant、固定子进程启动、消息限流、备份回收和容量异常显示。
  - 将开工拆为两道闸门：合成 `test.*` Catalog 可用于基础设施骨架；正式 Catalog 与真实存档导入仍需独立准入。
  - 第二轮独立复审给出基础设施 GO；正式 Catalog/真实存档维持 NO-GO。
  - 迁移 C# BuildRequest/NormalizedBuildRequest/结果字段与 occupancy enum 到显式 Mandatory、BasicPrimary、Optional 六域模型。
  - 新增 Desktop v1 JSON Schema、黄金 NDJSON、带 revision/editId/targetEntryId 的 Engine Host 及 16 MiB 帧限制。
  - 新增 React/TypeScript + Electron Forge Webpack 外壳，启用 sandbox、contextIsolation、CSP、sender 校验、权限/导航/新窗口拒绝和 Electron fuses。
  - Engine 以 self-contained 资源打包；Main 从固定 RID 路径读取 manifest、校验 SHA-256、`shell:false` 启动并完成真实握手。
  - 实现 128-bit、10 分钟、一次消费并绑定 WebContents 的 path grant 骨架；Renderer 不接收绝对路径。
  - 对抗式检查发现 Mandatory/Optional 必须允许同一 Skill ID 跨优先级边界；已修正规格与 Engine，并由子 agent 增量确认。
  - macOS arm64 Forge package 成功，打包应用启动并保持运行完成冒烟检查；未读取任何真实存档。
  - npm 首次审计发现 Forge 构建链的旧 `tar/tmp/uuid/webpack-dev-server` 告警；使用精确兼容 override 升级并重新打包，最终 `npm audit` 为 0 vulnerabilities。
  - Electron/Engine 打包与启动通过后，移除已被替代的空白 WPF 启动项目和 solution/架构守卫入口；领域、Application 与全部 adapter 未删除。

### Phase 1: 原始需求与关键决策

- **Status:** complete
- **Started:** 2026-07-22
- Actions taken:
  - 检查工作目录与版本管理状态。
  - 完整读取 brainstorming、planning-with-files、hv-analysis、pdf 的工作规范。
  - 将用户原始诉求保存为独立文档。
  - 建立持久化任务计划、发现记录和进度日志。
  - 用户确认本轮只做方案、技术栈自由选型、自动采集为硬需求。
- Files created/modified:
  - `docs/original_requirements.md`（created）
  - `task_plan.md`（created）
  - `findings.md`（created）
  - `progress.md`（created）

## Test Results

| Test | Input | Expected | Actual | Status |
|---|---|---|---|---|
| 工作区检查 | `ls -la` | 识别现有项目状态 | 空目录 | ✓ |
| Git 状态检查 | `git status --short` | 判断是否已有仓库 | 非 Git 仓库 | ✓（作为项目事实记录） |
| 原始需求落盘 | 用户消息 | 独立、可追溯文档 | `docs/original_requirements.md` 已创建 | ✓ |

## Error Log

| Timestamp | Error | Attempt | Resolution |
|---|---|---:|---|
| 2026-07-22 | `git status`：not a git repository | 1 | 不初始化仓库，记录为绿地项目 |

## 5-Question Reboot Check

| Question | Answer |
|---|---|
| Where am I? | Phase 5：报告已成稿，生成并视觉校验 PDF |
| Where am I going? | PDF 校验 → 来源/需求覆盖检查 → 交付 |
| What's the goal? | 交付可靠、可实施、可验证的 GBFR 因子配装工具方案 |
| What have I learned? | 存档核心布局可读，Ver. 2.0.2 仍需两份真实样本过闸；目标和库存都需要 multiset/实例化建模 |
| What have I done? | 完成原始诉求、三路专项研究、第一性原理模型和实施报告 |

### Phase 2: 联网资料与样本项目核查

- **Status:** complete
- **Started:** 2026-07-22
- Actions taken:
  - 核查存档格式、哈希、因子实例与主副词条关联。
  - 核查 Ver. 2.0.2 因子类别、合成例外、12 槽和 Master Traits。
  - 对比 gbfr-relink-sim、莫娜/YAS、ok-oldking 与 WuWa Inventory Kamera。
  - 审核第三方项目许可证边界和官方服务协议风险。
- Files created/modified:
  - `task_plan.md`（updated）
  - `findings.md`（updated）
  - `progress.md`（updated）
  - `docs/research/save_reading.md`（created）
  - `docs/research/game_rules_and_data.md`（created）
  - `docs/research/reference_tools.md`（created）

### Phase 3: 第一性原理需求建模

- **Status:** complete
- Actions taken:
  - 建立实例级库存、有序重复目标、必出多重集和屏蔽出现次数语义。
  - 将排序形式化为满足数、屏蔽数、目标位置、槽位、等级、seed 的词典序比较器。
  - 补齐角色专属、已装备、锁定、未知哈希、数据版本和隐私边界。

### Phase 4: 实现方案与分期路线

- **Status:** complete
- Actions taken:
  - 选择 .NET 10 LTS + WPF、SQLite、CP-SAT 和穷举 oracle。
  - 设计严格只读快照、adapter、catalog、Top-K、分享字符串和三页 UI。
  - 制定存档 PoC 十项闸门与 CV 启动条件。

### Phase 5: 报告生成与验证

- **Status:** complete
- Actions taken:
  - 完成 Markdown 报告并修正 Ver. 2.0.2 兼容性表述。
  - 写入未加密/未压缩事实、服务协议风险和十项 PoC 验收。
  - 生成 25 页 A4 PDF，渲染全部页面并检查 5 张联系表及 4 张关键页原图。
  - 验证 PDF 可提取中文文本、关键章节齐全、输出目录仅保留最终 PDF。
- Files created/modified:
  - `docs/GBFR_factor_build_tool_research_and_implementation_plan.md`（created/updated）

## Additional Test Results

| Test | Expected | Actual | Status |
|---|---|---|---|
| 需求追溯 | 原始措辞独立保存 | `docs/original_requirements.md` | ✓ |
| 版本口径 | 游戏基线统一为 Ver. 2.0.2 | 报告已统一；工具 release v2.0.0 单独标注 | ✓ |
| 许可证检查 | 不把公开仓库误当可复制 | MIT/无许可/AGPL/GPL 分别记录 | ✓ |
| 存档结论校准 | 区分核心可行与当前版实测 | 95%/80% + 两份样本十项闸门 | ✓ |
| PDF 元数据 | A4、非加密、25 页 | 25 页，A4，WeasyPrint 69.0 | ✓ |
| PDF 视觉 QA | 无截断、乱码、表格溢出 | 全 25 页渲染检查通过 | ✓ |
| PDF 文本 QA | 关键结论和来源可提取 | 9 项关键词检查全部通过 | ✓ |

### Phase 6: 交付

- **Status:** complete
- Deliverables ready:
  - 原始需求文档；
  - Markdown 研究与实现方案；
  - 经过视觉和文本检查的 PDF；
  - 三份专项研究底稿。

### Phase 7: 软件架构设计

- **Status:** complete
- **Started:** 2026-07-22
- Actions taken:
  - 重新读取既有研究、规划和关键技术决策。
  - 将“低耦合、高可维护、方便调试”拆为进程边界、扩展边界和交付深度三个高影响决策。
  - 按 brainstorming 规范暂停实施，等待用户确认三项架构选择。
  - 用户选择 B/A/B：存档解析独立进程、仅内部 adapter、交付文档与 solution 骨架。
  - 首次 Release 编译完成 restore，但 5 个代码分析警告因 warnings-as-errors 阻止生成；正在按分析器建议修正。
  - 创建 9 个产品项目、1 个零依赖架构守卫项目和 .NET 10 WPF solution。
  - 完成总体架构、IPC、调试、测试策略和 5 份 ADR。
  - 将导入端口修订为 SourceId + URI，并支持多数据源按 ID 路由。
  - 修正全部分析器错误，Release 构建达到 0 warning / 0 error。
  - 完整验证脚本通过：build、format、依赖守卫、Worker self-test。
  - 校验 10 份架构 Markdown，0 个失效相对链接。
  - 按 stop-slop 规范复核架构文档；未发现表演式标题、二元反转或含糊结论需要修改。

## Phase 7 Test Results

| Test | Expected | Actual | Status |
|---|---|---|---|
| Release build | 全 solution 可编译 | 10 项目，0 warning / 0 error | ✓ |
| WPF cross-target | macOS 可验证 Windows 编译 | `net10.0-windows` 生成成功 | ✓ |
| Format | 无未格式化 C# | `dotnet format --verify-no-changes` 通过 | ✓ |
| Dependency guard | 无禁止项目引用 | `Architecture dependency checks passed` | ✓ |
| Worker self-test | 协议版本与能力可读 | Protocol 1，read-only/stdio-ndjson | ✓ |
| Markdown links | 相对链接均存在 | 10 文件，0 broken links | ✓ |

## Phase 7 Limitations

- 当前环境是 macOS，只验证了 WPF 交叉编译，尚未在 Windows 上启动窗口。
- Worker 当前只实现 `--self-test`；真实存档解析属于下一阶段 PoC。
- OrTools 与 SQLite 项目目前是 adapter 边界骨架，尚未引入 NuGet 包或实现业务。
- `eng/verify.ps1` 已创建，但本机没有 PowerShell，需在 Windows CI/开发机首次执行。

### Phase 8: 独立需求提炼与交叉审阅

- **Status:** complete
- **Started:** 2026-07-22
- Actions taken:
  - 用户明确要求另起子 agent 独立分析原始诉求，并交叉审阅当前方案。
  - 限定子 agent 只创建独立审阅报告，不修改现有源码或方案文档。
  - 子 agent 完成 564 行独立报告，包含逐条规格、追踪矩阵、P1-P3 发现和阶段阻断项。
  - 主 agent 完整复核报告证据，接受五项 P1 核心结论。
  - 主审阅新增一项 P3 文档漂移：旧 path 时序和未定义取消信号。
  - 保留独立报告原文，另建主审阅补充；未擅自修改会改变用户结果的排序语义。

### Phase 9: 排序规格冻结与审阅问题修订

- **Status:** complete
- **Started:** 2026-07-22
- Decisions received:
  - 1B：少槽优先。
  - 2A：屏蔽按出现次数。
  - 3A：屏蔽次数先于目标位置。
  - 5：方案等价忽略等级和实例 ID，保留主副顺序；同一方案选择等级最高的实体实现。
  - 4：等待解释等级字段影响后确认。
  - 用户随后确认 4A：使用 `sigilLevel` 总和衡量强化材料节省。
  - 用户新增 Basic Stats 主词条配额 X：排序仅次于必出，未满足仍输出并明确标注。
  - 按 brainstorming 规范暂停设计/实现，等待三个高影响语义确认后再检索当前可信数据。
  - 用户确认基础属性目标是高优先级软目标，替代使用可多选的有序池，池顺序按勾选/取消动态紧凑维护。
  - 用户确认必选前缀只作用于普通目标，并要求在目标配置栏醒目标识必选项。
  - 将 24 个目标容量形式化为普通目标与基础属性主词条复合目标；同一实体词条不能跨两类目标双计数。
  - 发布 `GBFR-RANK-1` 排序规格和 ADR 0006，补充 Exact/Substituted/Missing 解释与 11 个验收用例。
  - 引入 `ISkillCatalog`、独立 JSON Catalog adapter 边界和可重放 `BuildAnalysis` 结果信封。
  - 子 agent 增量交叉审阅识别了共享容量、非贪心匹配、替代池持久化和目标容量边界；主 agent 已逐项处置。
  - 核查 Ver. 2.0.2：Basic Stats 为攻击力、体力、暴击率、昏厥；两个全角色 Master Trait 节点可合计至每个因子 +40% 伤害上限，最多计 5 个。

## Phase 9 Test Results

| Test | Expected | Actual | Status |
|---|---|---|---|
| Release build | 新领域合同与 Catalog 项目可编译 | 11 项目，0 warning / 0 error | ✓ |
| Format | C# 无格式漂移 | `dotnet format --verify-no-changes` 通过 | ✓ |
| Dependency guard | 新 Catalog adapter 不破坏依赖方向 | `Architecture dependency checks passed` | ✓ |
| Worker self-test | 架构修订未破坏 IPC worker | Protocol 1，read-only/stdio-ndjson | ✓ |
| Markdown links | 新规格、ADR 与审阅链接有效 | 0 broken links | ✓ |

### Phase 9 Addendum: 双层屏蔽

- **Status:** complete
- Decisions received:
  - 绝对屏蔽检查已选因子的主、副词条；任一命中即淘汰。
  - 五个选择域互斥；其他域中同技能保持可见但失效，并显示占用原因。
  - 软屏蔽和绝对屏蔽使用两个独立的分类多选面板，不使用下拉框。
  - 屏蔽面板分类完全跟随游戏内置筛选器，成员与顺序由 Catalog 提供。
- Actions taken:
  - 将领域合同拆为 `ForbiddenSkillIds` 与 `SoftBlockedSkillIds`。
  - 将比较器提升为 `GBFR-RANK-2`，补充 ADR 0007 和屏蔽池 UI 规格。
  - 为 Catalog 增加有序分类元数据，防止 WPF 硬编码类别标签。
  - 独立审阅发现 inactive draft、旧冲突修复死锁、封闭分类 enum 和匹配解释漂移问题。
  - 修订为 `CanAdd/CanRemove` 状态、inactive draft 不占用、开放 `FilterCategoryId`、Catalog-aware normalizer 和 canonical assignment witness。
  - 当前资料确认五个语义类别；社区工具 `role/plus` 不视为游戏原生类别，发布前以当前游戏本地化表/UI 样本核准筛选栏。

## Phase 9 Addendum Test Results

| Test | Expected | Actual | Status |
|---|---|---|---|
| Release build | 双层屏蔽与 normalizer 合同可编译 | 11 项目，0 warning / 0 error | ✓ |
| Format | C# 无格式漂移 | `dotnet format --verify-no-changes` 通过 | ✓ |
| Dependency guard | 新合同不破坏依赖方向 | 通过 | ✓ |
| Worker self-test | 核心架构修订不影响只读 Worker | Protocol 1 通过 | ✓ |
| Markdown links | 新 UI、ADR、审阅和研究链接有效 | 0 broken links | ✓ |

## Additional Errors

| Timestamp | Error | Attempt | Resolution |
|---|---|---:|---|
| 2026-07-22 | WeasyPrint 找不到 GLib/Pango 动态库 | 2 | 安装 Homebrew `pango`，并设置 `/opt/homebrew/lib` 后成功生成 |
| 2026-07-22 | 清理渲染目录的 `rm -f` 命令被安全策略拒绝 | 1 | 改用新的带日期渲染目录，不删除既有文件 |
| 2026-07-22 | 系统无 `pdftotext` | 1 | 使用 `pypdf` 提取文本并完成关键词校验 |
| 2026-07-22 | 首次来源短语检查受 PDF 抽取空格影响 | 1 | 归一化空白后复检通过；视觉页面同时确认 |
| 2026-07-22 | `./eng/verify.sh` permission denied | 1 | 先用 `bash` 验证，再补齐用户执行位；随后 `./eng/verify.sh` 完整通过 |

### Phase 11: 目标编辑、结果缓存与多角色配装

- **Status:** complete
- 为六个可见目标区增加独立清空操作；替代主词条区仅在允许补位时显示。
- 目标编辑区分为“想要的技能”和“需要避开的技能”，两组内保持原求解字段和互斥规则。
- 结果改为一次展示一套方案，十个标签切换；替代、缺少指定主词条和需避开技能同时使用文字、图标和颜色提示。
- 引入稳定实例键、逻辑指纹、库存指纹和版本化缓存键；确认只占用具体因子。
- 确认配装保存唯一名称、目标快照、结果快照和实例键，并提供独立双栏浏览入口。
- 只有开始分析和重新计算启动 Web Worker；目标或方案变化会终止失效 Worker，确认和浏览不求解。
- 从固定上游快照接入普通技能图标并记录文件哈希；角色头像没有冒充技能图标。
- 子 agent 完成独立交叉审阅，发现并推动修复名称碰撞、目标快照、目录重建丢图标映射和布局样式问题。
- 使用用户 `SaveData1.dat` 只读导入 401 个双词条因子，测试目标检索 14,550 个状态并返回 10 套方案。
- macOS 打包应用完成视觉检查：目标分组、技能图标、结果卡、确认流程和已确认配装入口均可见可用。

## Phase 11 Test Results

| Test | Expected | Actual | Status |
|---|---|---|---|
| TypeScript | Renderer 与领域代码可编译 | `tsc --noEmit` 通过 | ✓ |
| Workspace state | 缓存、实例占用、重名和状态机正确 | 通过 | ✓ |
| Skill icons | 目录引用均有固定哈希资源 | 49 个文件通过 | ✓ |
| Real save | 原文件不变且可解析 | 401 个双词条因子 | ✓ |
| Real solver | 测试方案有可解释 Top 10 | 49 类候选、14,550 状态 | ✓ |
| macOS visual | 非空白、分组和结果卡可读 | 目标/结果/已确认配装均通过 | ✓ |

## Phase 11 Remaining Risk

- 技能图标来源仓库没有许可证。当前资源可用于本地验证，公开发行前需要取得再分发许可或改成用户自行导入图标包。
- Windows 免安装包仍需在真实 Windows 10/11 x64 主机完成最终启动、读取和计算冒烟。

### Phase 12: 素材权利、缓存生命周期、内存与性能审计

- **Status:** in progress
- 已将游戏图标再分发、磁盘缓存清理、Worker/IPC 生命周期、内存趋势和真实样本性能纳入同一轮发布审计。
- 先进行只读盘点和基线测量；清理策略以“仅删除可再生成且已确定失效的数据”为边界，不触碰用户存档、目标方案或已确认配装。
- 已实现分析缓存即时淘汰、旧存储键迁移清理、短生命周期求解 Worker、流式 Engine 完整性校验、bounded path grants 和串行存档导入。
- 已实现备份清单、原子提交、同内容去重、10 份/2 GiB 上限和每来源最后一份保护；现有目录已清掉一份 22 MiB 的逐字节重复备份。
- 真实存档 15 次压力测试 p95 为 214 ms，post-GC heap 无可见增长；完整发行校验仍需在最终打包后重跑。
# Phase 13：因子库存、只读快照与分类主词条目标

- 已确认启动不自动重读存档，只恢复最后一次成功解析的库存快照；下一次手动选择文件时复用上次路径。
- 已删除长期备份功能、备份 Store/测试/IPC 字段和本机旧备份目录；读取完成后改为建议用户自行备份。
- 已实现主进程库存快照 Store、Preload 窄接口、损坏缓存拒绝和原子覆盖测试。
- 已新增“持有因子”独立页面，包含搜索、分类、使用状态、排序、分页、装备角色与确认配装占用显示。
- 已实现攻击类、防御类主词条目标；与基础主词条合计最多 12 项，与其他目标合计最多 24 项。
- 已把求解分配和排序升级到 `GBFR-RANK-3`，增加 schema 2 方案/分享串迁移及旧确认结果字段迁移。
- 已完成 1180 px、720 px 浏览器视觉检查。720 px 下无横向溢出，顶栏按钮文字不换行，库存空状态和筛选工具栏布局正常。
- `npm run verify:release` 通过；新增 1 个三类主词条穷举回归，共 6 个 P0 回归和 120 个随机穷举用例。
- 真实 401 枚库存压力测试通过：15 次求解 p95 192 ms，post-GC heap 无可见增长。
- `dotnet test GBFRTool.slnx -c Release --no-restore` 通过。首次误用不存在的旧 `.sln` 路径，已改用仓库实际 `.slnx`。
- 独立对抗审阅复现 24 项可选目标导致旧求解器 OOM，结论一度改为 NO-GO。
- 为精确求解增加状态、候选和时间硬预算，并在 Renderer 增加独立终止计时；达到预算只返回可解释失败，不保存部分结果。
- 为真实 401 因子加入 24 项压力回归，并为发行测试加入全连接 24 项合成回归；旧 OOM 用例现可在安全预算内停止。
- 修复审阅发现的导入前文件大小校验、旧备份清理阻断启动、Engine 历史库存常驻、解析超时错位和库存分页复位问题。
- 独立审阅者对修正版给出最终 GO，未发现剩余 P0/P1；Windows/macOS 修正版已重新打包并通过 SHA-256、版本元数据、架构与 macOS 启动校验。

## Phase 14：Renderer 整体重设计

- 用户确认整体重设计，要求先提交方案再实施，并以均衡的视觉、效率、响应式和无障碍为目标。
- UI 子代理完成当前打包应用、Renderer 代码和断点的只读审查；确认 Windows 720px 外框对应客户区溢出风险，以及大型模态框焦点隔离缺失。
- 用户批准开始实施，并要求修改后执行独立对抗性审查。
- 实现代理负责分批修改；另一名独立代理负责验收矩阵和最终 NO-GO/GO 审查；主代理负责计划、整合、全量测试和实际视觉验证。
- 第一批实现已形成可编译检查点：三页导航、统一 FactorCard、目标序号与上下移动、窄屏目标选择器、Dialog/Tabs/HelpPopover 无障碍、自动保存语义、设计 token 和响应式 CSS 已接入。
- `npm run typecheck` 与 `npm run verify:release` 在该检查点通过；求解、缓存、库存快照、路径授权、图标和 120 组随机 oracle 均未回归。
- 完成 480/576/680/1180 客户区实机渲染检查：无横向溢出，技能图标破图数为 0；计算后结果区进入视口。
- 第一轮独立对抗审查发现自动保存关闭窗口期和返回配装页后导航 observer 失效两个 P1，均已复现并修复。
- 所有 workspace 更新统一同步更新 `workspaceRef`；自动保存显示保存中、已保存和失败，关闭前同步 flush。50ms 内关闭并重启的实测保留最后修改。
- `IntersectionObserver` 按 `appPage` 生命周期重建；离开并返回配装页后，目标/结果导航高亮继续跟随滚动。
- 必须满足项移除无业务意义的序号和上下移动；仍支持重复添加与逐项删除。
- 第二轮独立对抗审查结论为 GO，未发现剩余 P0/P1。
- 真实 401 因子性能回归 p95 429ms，15 次运行 post-GC heap 增长 0 MiB；三份存档只读校验与损坏校验拒绝均通过。

## Phase 15：求解器最优性审阅

- 逐项对照 `GBFR-RANK-3`，确认硬约束、主词条、替代、可选目标、软避开、槽位、等级和稳定随机尾项的实现顺序一致。
- 完成候选分组、计数截断、状态合并、后缀可行性剪枝和每状态 Top-K 截断的无损性检查。
- 对必须满足、精确主词条、基础替代和可选目标的逐层 token 消费给出交换论证，未发现会牺牲更高层或总完成数的贪心反例。
- 确认同逻辑方案固定选取最高等级实体，且 `A&B`、`B&A` 保持不同方案身份。
- 在 `desktop` 目录运行 `npm run test:solver-oracle`：7 组 P0 定向回归、多重集/身份检查和 120 组随机全量穷举全部通过。
- 最终判断：求解成功时返回全局最优有序 Top-K；超过 25,000 状态、50,000 变体或 6 秒预算时明确失败，因而不是“任意合法输入都保证返回最优解”。
# 2026-07-23 Windows v0.2.0 可用版

- 在读取存档按钮旁增加 `%LOCALAPPDATA%\GBFR\Saved\SaveGames\`、`SaveData1.dat` 和多文件选择说明。
- 求解预算调整为 30 秒 / 50,000 状态 / 100,000 变体，Renderer Worker 35 秒强制回收。
- Windows 宽屏技能池由固定 `max-height` 改为填充父容器，窄屏继续使用受控视口高度。
- 新增 `renderer-regressions.test.mjs`，完整求解 oracle 通过。
- 用户真实存档回归：401 个因子，14,550 状态，15 次 p95 181 ms，GC 后堆增长 0 MiB。
- Windows x64 包生成成功，ZIP 173 MiB，PE32+ x86-64。
- 错误记录：首次运行 `shasum -c release/SHA256SUMS.txt` 时工作目录错误，清单中的相对路径无法解析；改在 `release/` 目录执行。

# 2026-07-23 v0.2.0 公开发布准备

- 仓库未跟踪真实存档、缓存、Release ZIP、依赖目录或构建输出。
- 工作树文本扫描未发现 GitHub token、私钥或本机绝对路径。
- Git 历史作者信息包含学校邮箱，公开前改写为 GitHub noreply 地址。
- 49 个游戏技能图标和技能目录来自无项目级许可证的社区快照；保留当前功能，但在 README、NOTICE、LICENSE 和包内 notice 中明确来源、权利边界和下架渠道。
- 新增使用说明、故障排查、隐私、安全、更新记录和结构化 Bug 模板。
- `npm run verify:release` 全部通过，npm audit 报告 0 个已知漏洞。
- 提交历史、`v0.1.0` 和 `v0.2.0` 标签中的学校邮箱已改为 GitHub noreply 地址；内容和 Release 附件保持不变。
- `v0.1.0` 标记为历史预发布版，`v0.2.0` 更新为 Windows 最新可用版。
- 仓库已设为 public，启用 Issues、分类 topics 和私密漏洞报告；GitHub 未登录 API 已确认仓库与 Release 可公开访问。
- 错误记录：本地最初未获取版本标签，历史清理在执行前安全退出；拉取标签后重跑成功。仓库简介更新和一次 Release 字段查询分别遇到 CLI EOF、不支持字段，均改用分步 API 查询完成，没有留下部分公开状态。

# 2026-07-23 Issue #1 精确求解优化

- 已读取 Issue #1：真实存档 ZIP、GBFR-RANK-3 配置串、Windows 11 的“组合状态超过安全容量/超时”复现。
- 用户确认保持精确 Top-10；内存预算默认 512 MiB 且允许调整；修复后直接发布 v0.2.2 并回复 Issue。
- 进入真实附件基线、算法优化、oracle/压力验证和发行阶段。
- 基线复现：3,895 枚因子，v0.2.1 在约 3.5 秒触发固定容量；放开容量的旧结构约 26 秒完成、累计 269 万状态、RSS 约 871 MiB。
- 已实现贡献等价类压缩、局部精确 Top-10、紧凑状态键、持久化选择链、延迟计数复制和按内存预算停止。Issue 样例约 3.3 秒完成，第一方案与大容量基线一致。
- 已增加默认 512 MiB、可调 128–1024 MiB 的内存预算；界面明确说明它不是操作系统级硬限制，提高预算可能影响低内存电脑。
- 方案操作菜单已增加点击外部关闭，并统一方案菜单、帮助气泡、页面导航和对话框层级。
- 用户将“复杂配置也能算出结果”设为最高优先级，并明确不使用磁盘交换。已把内存预算改为快速算法切换线：达到后自动进入 HiGHS WebAssembly 精确求解。
- 24 项全连接合成库存能完成 24/24 覆盖；MILP 小规模结果与独立穷举完整排序一致。Issue #1 在 128 MiB 切换线下约 9.3 秒完成，第一方案与 512 MiB 快速路径一致。
