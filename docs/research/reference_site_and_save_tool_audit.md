# 参考站点与存档工具核验（2026-07-22）

## 1. 范围、版本与结论

本次只读核验以下对象：

- 线上站点：<https://gbfr-relink-sim.pages.dev/>
- 站点源码：[`choeki/gbfr-relink-sim`](https://github.com/choeki/gbfr-relink-sim)，`main` 分支提交 [`6aba7fc`](https://github.com/choeki/gbfr-relink-sim/tree/6aba7fc633e870de65f26c01462cdbe1dd6b6baa)
- 存档工具：[`BitterG/GBFR-PE-Patch-Tool`](https://github.com/BitterG/GBFR-PE-Patch-Tool)，`master` 分支提交 [`1c0c909`](https://github.com/BitterG/GBFR-PE-Patch-Tool/tree/1c0c9096c1a51613135f546fd964b1469a5bca4d)，最新发布版为 `v1.8.5`（2026-07-20）

结论：

1. **存档自动读取技术上可行，优先级应高于 CV。** BitterG 项目的当前源码已经能从标准 Windows 存档目录发现 `.dat`，并批量读出每个已有因子的名称、因子等级、主词条/副词条及各自等级。这正好覆盖本项目计算器需要的因子库存字段。
2. **不能直接复用该项目源码或数据。** BitterG 项目和 `choeki/gbfr-relink-sim` 根目录均无许可证，GitHub API 也返回 `license: null`。公开可见不等于获得复制、修改或分发许可；应取得作者明确授权，或按本文的清洁室方案独立实现。
3. **本项目只需要读，不应引入写存档能力。** 参考工具的因子写入链路存在直接覆盖、非原子写入、无自动回滚等风险。将读取器做成无写 API、无写权限需求的独立模块，可显著缩小安全、测试与用户信任成本。
4. `gbfr-relink-sim` 值得学习的是信息分组、本地保存和即时汇总的产品思路；**不应复制其三栏布局、视觉语言、CSS、图片、组件树或文案**。其当前“分享”仅为导出 PNG，不是 URL/字符串分享机制。

> 核验限制：当前环境没有可用的交互式浏览器实例，因此未做逐按钮点击和截图比对。作为替代，已请求线上页面与静态资源、从上述提交执行确定性生产构建，并确认线上 JS/CSS 与本地构建产物 SHA-256 完全相同。因此下面对当前线上实现的代码级结论可靠；仅不宣称完成了人工视觉走查。

## 2. 线上部署与源码一致性

2026-07-22 请求线上首页得到 HTTP 200。首页引用：

- `/assets/index-kYofvvYA.js`
- `/assets/index-CyF9KLsG.css`

在提交 `6aba7fc` 上执行 `npm ci && npm run build` 得到同名资源，并与线上文件逐字节一致：

| 资源 | 字节数 | SHA-256 |
| --- | ---: | --- |
| JS | 896,071 | `049e6ed0cd2d82d3ded3bead43209884e5264242e85caae2c2bca81ac1e02bea` |
| CSS | 36,283 | `401c1ccbc299589c79920e88c77eb8e3dc6de262bab8fdfb9503857523deae84` |

所以，本报告可以把提交 `6aba7fc` 视为核验时线上站点的精确实现，而不只是相近版本。

## 3. `gbfr-relink-sim` 当前产品机制

### 3.1 UI 信息架构

站点定位是“手工构造一套完整配装并查看汇总”的模拟器，不是“从持有库存反推方案”的求解器。当前主要结构为：

- 顶部粘性工具栏：应用标识、因子配装/专精视图切换、方案命名、保存/切换/删除、导出图片、清空、语言切换。
- 桌面三栏工作区：左栏角色/武器/祝福，中栏 12 个因子槽和召唤，右栏技能汇总；窄屏时逐步退化为两栏和单栏。
- 因子区域使用 12 个可直接编辑的槽位；技能汇总随编辑即时重算。
- 右栏汇总在桌面使用粘性定位，便于长表单中持续观察结果。

源码证据：[`App.tsx#L195-L279`](https://github.com/choeki/gbfr-relink-sim/blob/6aba7fc633e870de65f26c01462cdbe1dd6b6baa/src/App.tsx#L195-L279)、[`App.css#L55-L174`](https://github.com/choeki/gbfr-relink-sim/blob/6aba7fc633e870de65f26c01462cdbe1dd6b6baa/src/App.css#L55-L174)。

可借鉴的抽象模式：

- 编辑目标时即时显示“已满足多少”和错误反馈，不必等到最终提交。
- 长任务保留稳定的结果摘要区域。
- 保存多套命名配置，并把“当前草稿”和“已保存方案”分开。
- 响应式布局按任务优先级退化，而不是简单缩小所有控件。

不应照搬：顶部工具条构成、三栏宽度、卡片样式、配色、背景、图标、12 槽卡片排列、组件命名与 DOM/CSS 结构。本项目的主流程本质不同，更适合采用“库存导入 → 目标技能 → 求解结果”的分步工作台。

### 3.2 数据模型与持久化

其 `Trait` 把词条类别定义为 `basic | attack | defense | support | special`，`SigilDef` 记录主词条、是否支持副词条、等级和副词条池，配装固定为 12 个因子槽。参见 [`types.ts#L1-L41`](https://github.com/choeki/gbfr-relink-sim/blob/6aba7fc633e870de65f26c01462cdbe1dd6b6baa/src/types.ts#L1-L41) 与 [`types.ts#L144-L172`](https://github.com/choeki/gbfr-relink-sim/blob/6aba7fc633e870de65f26c01462cdbe1dd6b6baa/src/types.ts#L144-L172)。

基础数据随前端打包，运行时把自定义覆盖层与种子数据合并。持久化完全位于浏览器 `localStorage`：

- `gbfr-sim.custom`：自定义数据覆盖
- `gbfr-sim.builds`：命名方案集合
- `gbfr-sim.current`：当前草稿
- 语言另存为 `gbfr-sim.locale`

参见 [`store.ts#L75-L139`](https://github.com/choeki/gbfr-relink-sim/blob/6aba7fc633e870de65f26c01462cdbe1dd6b6baa/src/store.ts#L75-L139) 和项目说明 [`README.md#L50-L52`](https://github.com/choeki/gbfr-relink-sim/blob/6aba7fc633e870de65f26c01462cdbe1dd6b6baa/README.md#L50-L52)。

适用于本项目的模式是“内置只读基线数据 + 用户数据/覆盖层 + 明确的数据版本号”。但 Windows 桌面应用不应照搬 `localStorage`：建议使用版本化 SQLite 或 JSON 文件，库存导入记录至少保存 `schemaVersion`、来源存档路径、源文件指纹、读取时间、游戏/解析器版本和诊断信息。

数据来源需单独审计。当前站点的 `seed.json` 明示其中一部分来自 `GBFR.PE.Patch.Tool embedded data`，而两个仓库都没有根许可证。这个声明是来源说明，不是再许可。不能从该站点把因子/词条 JSON、翻译、哈希表或游戏图片复制进本项目。参见 [`seed.json#L1-L5`](https://github.com/choeki/gbfr-relink-sim/blob/6aba7fc633e870de65f26c01462cdbe1dd6b6baa/src/data/seed.json#L1-L5)。

### 3.3 当前“分享”机制

核验当前源码和线上打包 JS 后，未发现 `URLSearchParams`、URL hash、Clipboard API、分享码编码/解码或远端方案存储。当前行为是：

- 点击“导出图片”后在浏览器 Canvas 中生成 PNG 并下载；
- 图片标题含“配装分享/Build Share”，但这只是导出图上的文字；
- 命名方案只存在本机浏览器 `localStorage`；
- JSON 导入/导出只用于“自定义数据覆盖”，不是配装分享码。

参见 [`App.tsx#L231-L239`](https://github.com/choeki/gbfr-relink-sim/blob/6aba7fc633e870de65f26c01462cdbe1dd6b6baa/src/App.tsx#L231-L239)、[`exportBuildImage.ts#L116-L310`](https://github.com/choeki/gbfr-relink-sim/blob/6aba7fc633e870de65f26c01462cdbe1dd6b6baa/src/exportBuildImage.ts#L116-L310) 与 [`store.ts#L142-L165`](https://github.com/choeki/gbfr-relink-sim/blob/6aba7fc633e870de65f26c01462cdbe1dd6b6baa/src/store.ts#L142-L165)。

因此，本项目需求中的“目标技能字符串导入/导出”需要自行设计稳定协议。建议使用：协议版本 + 技能稳定 ID 序列 + 必出数量 + 屏蔽列表 + 校验和；字符串只是该结构的紧凑编码，不应依赖中文显示名或数组下标。

## 4. `GBFR-PE-Patch-Tool` 存档读取核验

### 4.1 自动发现与加载入口

工具扫描：

```text
%LOCALAPPDATA%\GBFR\Saved\SaveGames
```

筛选 `SaveData*.dat`，并排除文件名中含 `_BackUp` 的文件。参见 [`save_app.go#L113-L135`](https://github.com/BitterG/GBFR-PE-Patch-Tool/blob/1c0c9096c1a51613135f546fd964b1469a5bca4d/save_app.go#L113-L135)。这证明默认路径自动发现可行，但本项目不能静默选择第一个文件：同目录可能有多个槽位、备份或云同步残留，应显示文件名、修改时间、大小和解析状态，让用户确认默认项。

`LoadSave` 直接 `os.ReadFile`，读取文件头中的 SlotData 偏移与长度，校验边界后把对应字节段作为数据区。当前读取链路没有解密或解压步骤；其格式表现为自定义文件头 + FlatBuffer 风格表 + 尾部 XXHash64 校验数据。参见 [`sigil_store.go#L87-L105`](https://github.com/BitterG/GBFR-PE-Patch-Tool/blob/1c0c9096c1a51613135f546fd964b1469a5bca4d/sigil_store.go#L87-L105) 和 README 的实现说明 [`README.md#L91-L97`](https://github.com/BitterG/GBFR-PE-Patch-Tool/blob/1c0c9096c1a51613135f546fd964b1469a5bca4d/README.md#L91-L97)。

这意味着“存档有加密导致方案 1 不可行”的担忧，在当前 Steam Windows 存档格式和该工具支持版本上没有得到证据支持。仍需用用户真实存档做最终兼容性验证，尤其是 DLC 更新后的新旧存档。

### 4.2 因子库存提取链路

当前实现使用以下字段关系定位因子：

1. 扫描 `GemIDType = 2703` 的所有 FlatBuffer 单元，`UnitID >= 30000` 为因子槽。
2. 因子哈希不等于空值 `0x887AE0B0` 时视为已占用。
3. 同一 `UnitID` 的 `GemLevelIDType = 2704` 是因子等级。
4. 词条单元基址为 `120000000 + (GemUnitID - 30000) * 100`；该单元为主词条，`+1` 为副词条。
5. `TraitHashIDType = 1701` 读取词条哈希，`TraitLevelIDType = 1702` 读取对应词条等级。
6. 最后使用目录中的哈希映射成因子/词条显示名；无法识别时保留十六进制哈希。

结果 DTO 已包含本项目所需的全部字段：`sigilName`、`level`、`primaryTraitName`、`primaryLevel`、`secondaryTraitName`、`secondaryLevel`。参见 [`sigil_gen.go#L634-L749`](https://github.com/BitterG/GBFR-PE-Patch-Tool/blob/1c0c9096c1a51613135f546fd964b1469a5bca4d/sigil_gen.go#L634-L749) 与常量/槽位读取逻辑 [`sigil_store.go#L13-L28`](https://github.com/BitterG/GBFR-PE-Patch-Tool/blob/1c0c9096c1a51613135f546fd964b1469a5bca4d/sigil_store.go#L13-L28)。

对本项目的读取输出建议不要使用显示名作为主键，定义为：

```text
OwnedSigil {
  inventorySlotId,
  sigilHash,
  sigilLevel,
  primaryTraitHash,
  primaryTraitLevel,
  secondaryTraitHash?,
  secondaryTraitLevel?,
  equippedBy?,
  sourceSaveFingerprint
}
```

显示名和分类通过本项目自己维护、具有明确来源与许可的数据表派生。这样即使暂时不认识新 DLC 哈希，也能保留库存记录并提示“未知词条”，不会悄悄丢数据。

### 4.3 尚未完成的可行性验证

本次没有用户真实存档，因此验证到的是“当前源码具备读取路径”，不是“本项目已在全部存档版本上通过实测”。进入开发前应建立匿名化测试矩阵：

- 最新 DLC 正常存档，因子数量较多；
- 游戏自动生成的 `_BackUp`；
- 至少两个存档槽；
- 包含已装备、锁定、单词条、V+、角色专属和未知新增因子；
- 截断文件、随机文件、头部偏移越界、未知哈希；
- 读取期间游戏或 Steam Cloud 正在更新文件的情形。

参考实现为避免渲染卡顿，只返回前 500 个已识别因子；本项目面向大量库存，不能保留这个静默上限。应完整解析，在 UI 侧虚拟列表/分页，并始终显示“解析总数、导入总数、未知总数、跳过总数”。参见 [`sigil_gen.go#L691-L760`](https://github.com/BitterG/GBFR-PE-Patch-Tool/blob/1c0c9096c1a51613135f546fd964b1469a5bca4d/sigil_gen.go#L691-L760)。

参考实现包含大量手写偏移和切片访问。独立实现必须把所有整数加法、向量长度、vtable 和字段范围做溢出/越界检查，并将异常文件转成结构化错误，不能让畸形存档触发进程崩溃。

## 5. 写入流程与风险

虽然本项目不计划写存档，仍需理解参考项目的风险边界，避免在“复用读取器”时无意带入写能力。

### 5.1 因子/祝福写入

因子生成默认输出到 `_modified.dat`，但 UI 可启用“原地修改”，把输出路径设为输入路径。写入过程是：内存修改槽位 → 重算 XXHash64 → `os.WriteFile` 输出 → 重新读取并逐项验证。参见 [`sigil_gen.go#L432-L581`](https://github.com/BitterG/GBFR-PE-Patch-Tool/blob/1c0c9096c1a51613135f546fd964b1469a5bca4d/sigil_gen.go#L432-L581) 和 [`sigil_store.go#L360-L401`](https://github.com/BitterG/GBFR-PE-Patch-Tool/blob/1c0c9096c1a51613135f546fd964b1469a5bca4d/sigil_store.go#L360-L401)。

主要风险：

- 因子/祝福写入路径没有自动创建存档备份；README 仅建议用户先备份。
- `os.WriteFile` 直接写目标，不是“同目录临时文件 + flush + 原子 rename”；断电、磁盘满、杀进程或并发写入都可能留下部分文件。
- 写后验证发生在覆盖完成之后，验证失败没有自动回滚。
- 如果游戏进程或 Steam Cloud 同时保存，可能出现最后写入者覆盖、云冲突或读取到不一致快照。
- 格式依赖固定 ID、槽位布局和哈希区规则；README 已警告 DLC 更新后部分功能可能失效。

README 对原地修改和备份范围的说明见 [`README.md#L19-L32`](https://github.com/BitterG/GBFR-PE-Patch-Tool/blob/1c0c9096c1a51613135f546fd964b1469a5bca4d/README.md#L19-L32) 与 [`README.md#L50-L63`](https://github.com/BitterG/GBFR-PE-Patch-Tool/blob/1c0c9096c1a51613135f546fd964b1469a5bca4d/README.md#L50-L63)。其中“备份/恢复”的 `.bak` 明确是 exe 备份，不应误认为所有存档写入都有自动备份。

### 5.2 其他写入

计数器和角色次数修改会先创建带时间戳的存档备份，再直接 `os.WriteFile` 覆盖原文件；这比因子写入多一层恢复手段，但依然不是原子替换。参见 [`save_app.go#L235-L319`](https://github.com/BitterG/GBFR-PE-Patch-Tool/blob/1c0c9096c1a51613135f546fd964b1469a5bca4d/save_app.go#L235-L319) 与 [`save_app.go#L432-L469`](https://github.com/BitterG/GBFR-PE-Patch-Tool/blob/1c0c9096c1a51613135f546fd964b1469a5bca4d/save_app.go#L432-L469)。

### 5.3 本项目的安全边界

建议做成编译期能力隔离，而不只是隐藏按钮：

- 读取模块只接收文件路径或只读字节流，公开 `scanSlots/readInventory/diagnose`；不包含 patch、checksum rewrite、delete、process memory 或 PE patch 依赖。
- 先一次性读取到内存快照，再解析；读取前后比较大小、修改时间和文件指纹，发生变化则重试或提示用户关闭游戏后重试。
- 不请求管理员权限，不打开游戏进程，不注入 DLL，不修改 exe，不写 SaveGames 目录。
- 导入库存只写本应用自己的数据库，并保留上次成功导入，解析失败不得清空旧库存。
- 诊断日志只记录文件名、版本、计数、未知哈希和错误偏移；不得上传或记录完整存档、用户目录名及其他个人数据。

## 6. 许可与来源结论

### 6.1 仓库许可状态

核验时：

- `choeki/gbfr-relink-sim` 无根 `LICENSE/COPYING/NOTICE`，GitHub API `license: null`。
- `BitterG/GBFR-PE-Patch-Tool` 无项目级 `LICENSE/COPYING/NOTICE`，GitHub API `license: null`。`src_dll/thirdparty/libmem/licenses/` 只覆盖相应第三方依赖，不能扩展为整个项目许可。
- BitterG README 说明其存档解析基于 `Nenkai/GBFRDataTools.SaveFile`，后者仓库标注 MIT；但上游 MIT 许可不会自动给 BitterG 新增的 Go/Vue 实现、中文翻译、数据文件和组合工程授予许可。
- README 的“仅供学习研究”和来源致谢不是允许复制、修改或再分发的开源许可证。

GitHub 官方说明：没有许可证时适用默认版权规则，通常不得复制、分发或创作衍生作品。参见 [GitHub Docs：Licensing a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)。这不是法律意见；如计划直接复用，应让项目负责人取得作者书面授权并明确覆盖代码、数据、翻译和素材。

### 6.2 当前可做与不可做

可做：

- 观察公开产品，提炼“导入—编辑—汇总”等通用交互模式。
- 把存档读取所需的行为写成独立需求、字段契约和黑盒测试。
- 基于合法取得的用户存档、公开格式资料和有明确许可证的上游资料，独立推导格式。
- 在文档中链接、引用并记录参考项目和访问版本。

未经授权不做：

- 复制或翻译其 Go/TypeScript/Vue/React 源码、测试、注释、CSS、DOM 结构。
- 搬运 `sigils.json`、`traits.json`、中文翻译、哈希表、图标、背景或游戏截图。
- 以“重构”“换变量名”“移植语言”的方式制作实质性衍生实现。
- 打包或调用参考工具的可执行文件/DLL，把写存档、内存修改能力作为本项目组件分发。

## 7. 防止视觉近似与源码复制的实施规约

1. **先冻结本项目任务模型。** 用自身需求定义三个一级页面/步骤：库存、目标、结果；不以参考站截图或组件树作为线框图起点。
2. **独立视觉系统。** 自建色板、字体、间距、圆角、阴影、图标和状态色；不使用参考站背景、金蓝卡片语言、顶部工具条组合或三栏比例。
3. **行为规格而非源码规格。** 设计文档只写输入、输出、约束、错误码和验收样例，不粘贴参考源码片段。实现者以规格和自建测试开发。
4. **数据来源台账。** 每个技能名、类别、稳定 ID、哈希映射和图标记录来源、抓取/校对日期、许可与修改说明；来源不明的数据不进入发行包。
5. **来源隔离。** 参考仓库只留在临时研究目录，不作为 git remote、submodule、vendor 或构建依赖；产品目录不保存其静态资源和数据快照。
6. **相似度复核。** 上线前对导航结构、首屏构图、卡片比例、颜色、字体、按钮文案和结果呈现逐项对比；若普通用户可能误认两者为同一产品或换皮，重新设计。
7. **提交说明。** 涉及存档解析的提交注明“基于内部格式规格/测试样本独立实现”，列出允许使用的资料；发现无许可证内容混入时立即移除并重写。

## 8. 建议的近期决策

### 决策 A：先做只读存档 PoC，暂不启动 CV

PoC 只完成四件事：自动发现候选存档、只读解析全部因子、映射主/副词条、输出诊断 JSON。验收门槛：

- 至少 3 份不同进度/版本的真实存档均能解析；
- 因子总数和随机抽查 30 条与游戏 UI 一致；
- 未知哈希可保留且有清晰提示；
- 畸形文件不会崩溃；
- 进程无任何存档目录写操作；
- 大库存不截断，解析时间和内存有基准数据。

若最新版本存档在取得足够样本后仍因格式变化无法稳定读取，才转入 CV 方案；不应因为参考项目包含危险的写入功能而误判“只读解析不可用”。

### 决策 B：许可未解决前按清洁室实现

优先联系 BitterG 与 `choeki` 询问项目许可证和数据授权。等待期间可以继续需求、格式实验和黑盒测试，但产品代码不得复制这两个仓库。若未来取得许可，再单独评估是否值得采用；许可允许也不意味着应该把写存档或内存修改能力带入本项目。

### 决策 C：分享协议自行设计

参考站没有可复用的分享码机制。本项目应从第一版就给技能 ID 和编码协议加版本号，并保证旧字符串可迁移；方案名称和本地收藏使用本应用数据库，导出字符串只表达求解目标，不夹带绝对路径、库存或用户身份信息。
