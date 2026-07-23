# 相近工具设计研究：GBFR 因子采集、求解与 Windows UX

> 访问日期：2026-07-22
> 研究范围：只考察与本项目的「持有因子自动采集」「目标配装求解」「Windows 交互」直接相关的设计，不建议照搬其他游戏工具的额外功能。
> 证据口径：以下将源码或 README 能直接证明的内容标为“事实”，将针对 GBFR 的落地建议标为“推断/建议”。

## 结论先行

没有一个参考项目能够整套搬来解决 GBFR 问题。最合理的借鉴组合是：

1. 用 `choeki/gbfr-relink-sim` 校核 GBFR 的词条 ID、类别、主副词条约束和搜索式选择器，但不要直接复制其代码或数据，因为仓库没有许可证。
2. 用 `ok-oldking/ok-wuthering-waves` 及其底层 `ok-script` 理解 Windows 游戏窗口捕获的工程边界：窗口定位、WGC/BitBlt 备选、分辨率归一化、后台输入和诊断截图。它不是库存扫描器，不能直接提供 GBFR 因子遍历算法。
3. 用莫娜占卜铺的“扫描器与求解器解耦”作为产品边界：扫描端输出有版本的数据合同，求解器只消费库存快照；预设与库存分别持久化。
4. 用 YAS 的“网格遍历 + 滚动反馈 + 捕获/识别流水线”作为采集主参考，但绝不能沿用它按完整内容去重的做法。GBFR 明确允许两个因子技能和等级完全相同，库存必须是多重集合（multiset），每件实物都保留独立实例。
5. 用 `WuWa_Inventory_Kamera` 的“失败截图进入人工复核队列”补足可靠性。它的固定坐标、全屏限制、模糊匹配直接接受结果等做法不应照搬。

## 一、横向对照

| 项目 | 直接相关定位 | 技术栈 | 数据更新 | 采集能力 | 求解/预设/展示 | 许可证判断 |
|---|---|---|---|---|---|---|
| `choeki/gbfr-relink-sim` | GBFR 配装模拟与数据模型 | Vite、React、TypeScript，纯前端 | 仓库内 JSON；Wiki、游戏截图及工具内嵌数据人工校对 | 无 | 12 因子槽、搜索/分类选择、技能来源汇总、本地多套配装、PNG 导出 | 仓库无 `LICENSE`，GitHub API 也未识别许可证；不可直接复制 |
| `ok-oldking/ok-wuthering-waves` + `ok-script` | Windows 游戏图像自动化框架与实例 | Python 3.12、PySide6/qfluentwidgets、OpenCV、ONNX/OpenVINO、Win32 | 随代码和 Release 更新 | WGC/BitBlt 捕获、PostMessage 输入、模板匹配/OCR、分辨率适配 | 任务式 UI、日志、诊断、热键与配置；没有库存求解器 | 两者均 AGPL-3.0；README 另有“仅供个人/非营利”表述，复用前需法律确认 |
| 莫娜占卜铺 `wormtql/genshin_artifact` | 已持有装备导入与组合优化 | Vue 3、TypeScript/JavaScript、Rust/WASM、Web Worker、localForage；有 Tauri 1 试验目录 | Rust 生成器把角色/武器/装备元数据生成到前端资产 | 主应用不负责直接 OCR；通过 YAS/Amenoma JSON 或本地 YAS 控制器导入 | 版本化预设、导入导出、最多 100 个降序结果、A*/启发式求解 | MIT；但游戏素材和 `sub/yas` 仍需按各自权利处理 |
| YAS `wormtql/yas` | 原神/星铁/鸣潮库存扫描器 | Rust、Win32 GDI、ONNX、自定义 SVTR OCR | 游戏名词与导出映射随版本更新 | DPI aware、客户区定位、分辨率模板缩放、网格遍历、反馈滚动、异步 OCR、内容去重 | 输出 Mona/GOOD 等 JSON；CLI 为主，无完善人工复核 | crate manifest 声明 GPL-2.0-or-later，但顶层无许可证文本、GitHub API 未识别；先按不可直接复用处理 |
| `Psycho-Marcus/WuWa_Inventory_Kamera` | 鸣潮库存 OCR 与 JSON 导出 | Python、PySide6、RapidOCR/ONNX Runtime、OpenCV、MSS、Win32 | 从 `Dimbreath/WutheringData` 的 GitHub 内容 API 更新文本和 ID | 前台全屏、固定网格、滚轮、DPI 比例与坐标缩放、OCR 缓存、重复项终止 | JSON 查看/编辑；识别失败截图可人工搜索修正 | GPL-3.0；复用会带来强 copyleft 义务 |

## 二、`choeki/gbfr-relink-sim`

### 身份、版本与技术栈

- **事实**：准确仓库是 [choeki/gbfr-relink-sim](https://github.com/choeki/gbfr-relink-sim)。本次检查 commit [`6aba7fc`](https://github.com/choeki/gbfr-relink-sim/commit/6aba7fc633e870de65f26c01462cdbe1dd6b6baa)，提交时间 2026-07-20；仓库未归档，无 GitHub Release。
- **事实**：[`README.md`](https://github.com/choeki/gbfr-relink-sim/blob/6aba7fc633e870de65f26c01462cdbe1dd6b6baa/README.md) 和 [`package.json`](https://github.com/choeki/gbfr-relink-sim/blob/6aba7fc633e870de65f26c01462cdbe1dd6b6baa/package.json) 表明它是 Vite + React + TypeScript 的纯前端应用，数据保存在浏览器 `localStorage`。
- **事实**：[`src/types.ts`](https://github.com/choeki/gbfr-relink-sim/blob/6aba7fc633e870de65f26c01462cdbe1dd6b6baa/src/types.ts) 将词条类别写为 `basic | attack | defense | support | special`，并明确区分 `canPrimary`、`canSecondary`；`SIGIL_SLOTS = 12`。这直接确认用户记忆中的分类还缺少“基础”和“辅助/支援”。
- **事实**：本次数据快照的 [`src/data/seed.json`](https://github.com/choeki/gbfr-relink-sim/blob/6aba7fc633e870de65f26c01462cdbe1dd6b6baa/src/data/seed.json) 含 212 个 trait、189 个 sigil、2 个副词条池；其中一部分条目的 `category` 仍未填，不能把这份表当成无需校验的权威数据库。

### 数据更新方式

- **事实**：[`src/store.ts`](https://github.com/choeki/gbfr-relink-sim/blob/6aba7fc633e870de65f26c01462cdbe1dd6b6baa/src/store.ts) 将内置 `seed.json`、`trait-levels.json`、`weapon-templates.json` 与用户自定义覆盖层合并；没有发现联网自动更新或签名数据包机制。
- **事实**：数据元信息称 traits/sigils/wrightstones 来自 `GBFR.PE.Patch.Tool` 内嵌数据，抽取日期 2026-07-16；README 同时称优先参考 GBF Relink Wiki 并用游戏界面校对。规则说明放在 [`data-source/`](https://github.com/choeki/gbfr-relink-sim/tree/6aba7fc633e870de65f26c01462cdbe1dd6b6baa/data-source)。
- **建议**：本项目可以学习“内置基线 + 本地覆盖”的数据分层，但应自己建立来源清单和生成流程；不要复制其内嵌游戏数据、图标或翻译，除非先取得明确许可。

### 与本项目直接相关的 UX

- **事实**：[`src/components/Picker.tsx`](https://github.com/choeki/gbfr-relink-sim/blob/6aba7fc633e870de65f26c01462cdbe1dd6b6baa/src/components/Picker.tsx) 同时提供名称搜索与类别过滤，并按基础、攻击、防御、辅助、特殊、角色专属排序。这适合作为本项目 24 个目标技能选择栏的交互参考。
- **事实**：[`src/App.tsx`](https://github.com/choeki/gbfr-relink-sim/blob/6aba7fc633e870de65f26c01462cdbe1dd6b6baa/src/App.tsx) 支持命名保存多套配装、载入和删除；[`src/components/SkillSummary.tsx`](https://github.com/choeki/gbfr-relink-sim/blob/6aba7fc633e870de65f26c01462cdbe1dd6b6baa/src/components/SkillSummary.tsx) 把技能汇总为“总等级、有效等级、溢出、来源”。
- **建议**：本项目只应借鉴“搜索式选择器、稳定 ID、命名预设、来源可展开”四个设计概念。它的模拟器是用户逐槽选择，不是从实际库存反向求解，不能当作求解算法参考。

### 许可证边界

- **事实**：commit 根目录没有 `LICENSE`/`COPYING`，GitHub 仓库 API 的 license 字段为 `null`。
- **判断**：公开可读不等于获得复制、修改、再分发授权。可把它当事实线索和交互研究对象，但不应复制源码、JSON、图片或翻译到本项目。若希望直接使用，先向作者取得书面许可或要求补充许可证。

## 三、`ok-oldking/ok-wuthering-waves` 与 `ok-script`

### 准确仓库与定位

- **事实**：用户口中的 `old-king-wuthering-wave` 对应 [ok-oldking/ok-wuthering-waves](https://github.com/ok-oldking/ok-wuthering-waves)，不是一个库存扫描器。本次检查 commit [`513f4d1`](https://github.com/ok-oldking/ok-wuthering-waves/commit/513f4d1ebdcce212422ae8d44746d6f8610336c5)，2026-07-22；最新 Release 为 [`v3.5.9`](https://github.com/ok-oldking/ok-wuthering-waves/releases/tag/v3.5.9)，发布于 2026-07-18。
- **事实**：其 [`README.md`](https://github.com/ok-oldking/ok-wuthering-waves/blob/513f4d1ebdcce212422ae8d44746d6f8610336c5/README.md) 明确说明它基于图像识别、通过 Windows UI 模拟操作，不读内存、不改游戏文件；支持 4K 以下 16:9、最低 1600×900，部分兼容 21:9，并可后台运行。
- **事实**：项目依赖 [ok-oldking/ok-script](https://github.com/ok-oldking/ok-script)。本次检查框架 commit [`2a98863`](https://github.com/ok-oldking/ok-script/commit/2a988638cf32ef5faffec6d5474c8555e24da83d)，2026-07-22。

### 窗口、截图、缩放、输入

- **事实**：鸣潮实例的 [`config.py`](https://github.com/ok-oldking/ok-wuthering-waves/blob/513f4d1ebdcce212422ae8d44746d6f8610336c5/config.py) 以进程 `Client-Win64-Shipping.exe`、窗口类 `UnrealWindow` 定位游戏；交互选择 `PostMessage`；捕获优先级为 `WGC` 后备 `BitBlt_RenderFull`。
- **事实**：同一配置声明 16:9 的基准分辨率列表 2560×1440、1920×1080、1600×900、1280×720，并设置最小尺寸。README 还要求关闭滤镜、锐化和覆盖层、保持默认亮度与稳定帧率，说明 CV 对显示链路变化非常敏感。
- **事实**：`ok-script` 的 [`README.md`](https://github.com/ok-oldking/ok-script/blob/2a988638cf32ef5faffec6d5474c8555e24da83d/README.md) 提供截图、输入、OCR、模板匹配、标注与 Debug 浮层；[`windows_graphics.py`](https://github.com/ok-oldking/ok-script/blob/2a988638cf32ef5faffec6d5474c8555e24da83d/ok/device/capture_methods/windows_graphics.py) 实现 Windows Graphics Capture，另有 [`bitblt.py`](https://github.com/ok-oldking/ok-script/blob/2a988638cf32ef5faffec6d5474c8555e24da83d/ok/device/capture_methods/bitblt.py) 作为路径之一。
- **事实**：框架可以在 Debug 截图上绘制识别框和置信度，参见 [`ok/gui/debug/Screenshot.py`](https://github.com/ok-oldking/ok-script/blob/2a988638cf32ef5faffec6d5474c8555e24da83d/ok/gui/debug/Screenshot.py)。这对建立 GBFR 的失败样本集很有用。

### 对 GBFR 的适用边界

- **建议**：可借鉴“窗口句柄 → 客户区截图 → 统一坐标系 → 输入适配器 → 诊断截图”的分层，以及 WGC/BitBlt 双路径。GBFR 是否可在被遮挡或最小化时稳定捕获必须单独做 PoC，不应由鸣潮的成功直接推断。
- **建议**：本项目扫描时应默认前台、窗口化或无边框，禁止最小化；后台捕获可以作为后续增强。这样能显著缩小首次 CV 验证矩阵。
- **不可照搬**：`ok-wuthering-waves` 的战斗、任务、自动登录、角色识别、YOLO 模型和任务调度均与因子库存无关；引入会让桌面工具承担不必要的自动化风险和依赖体积。

### 许可证边界

- **事实**：`ok-wuthering-waves` 和 `ok-script` 的许可证文件都是 AGPL-3.0，分别见 [`LICENSE.txt`](https://github.com/ok-oldking/ok-wuthering-waves/blob/513f4d1ebdcce212422ae8d44746d6f8610336c5/LICENSE.txt) 与 [`ok-script/LICENSE.txt`](https://github.com/ok-oldking/ok-script/blob/2a988638cf32ef5faffec6d5474c8555e24da83d/LICENSE.txt)。
- **事实**：鸣潮项目 README 同时写有仅供个人学习、不得商业营利的限制性声明，这与标准 AGPL 的通常授权范围存在解释冲突。
- **判断**：在决定本项目许可证之前，不应复制、修改或链接其实现。最安全的方式是独立实现从公开 Win32/WGC API 学到的通用架构；若直接依赖 `ok-script`，需接受 AGPL 合规并进一步澄清 README 的附加限制。

## 四、莫娜占卜铺与 YAS

### 莫娜占卜铺的当前项目和开源状态

- **事实**：当前开源仓库是 [wormtql/genshin_artifact](https://github.com/wormtql/genshin_artifact)，不是 `frzyc/genshin-optimizer`。本次检查最新 commit [`ca32cf5`](https://github.com/wormtql/genshin_artifact/commit/ca32cf53cc4dc0484f0c2fea56bfb49d0946dce0)，2025-05-05；仓库未归档，`package.json` 版本为 5.30.0，但没有 GitHub Release。由此只能说源码仍公开，不能推断 2026 年仍高频维护。
- **事实**：根许可证为 [MIT](https://github.com/wormtql/genshin_artifact/blob/ca32cf53cc4dc0484f0c2fea56bfb49d0946dce0/LICENSE)。
- **事实**：[`README.md`](https://github.com/wormtql/genshin_artifact/blob/ca32cf53cc4dc0484f0c2fea56bfb49d0946dce0/README.md) 显示前端为 Vue，核心计算和元数据生成依赖 Rust/WASM；[`package.json`](https://github.com/wormtql/genshin_artifact/blob/ca32cf53cc4dc0484f0c2fea56bfb49d0946dce0/package.json) 还列出 localForage、Pinia、Element Plus、ECharts 和 Tauri 1。

### 最值得学习的产品边界

- **事实**：官方文档 [`mona_book/src/quick_start.md`](https://github.com/wormtql/genshin_artifact/blob/ca32cf53cc4dc0484f0c2fea56bfb49d0946dce0/mona_book/src/quick_start.md) 把采集交给 YAS 或 Amenoma，再将 JSON 导入莫娜；也支持本地启动 YAS 并经 WebSocket 与网页连接。计算后最多展示 100 组降序结果。
- **事实**：[`src/types/artifact.ts`](https://github.com/wormtql/genshin_artifact/blob/ca32cf53cc4dc0484f0c2fea56bfb49d0946dce0/src/types/artifact.ts) 将每件装备建模为独立对象，包含 `id` 和 `contentHash`；[`src/store/pinia/artifact.ts`](https://github.com/wormtql/genshin_artifact/blob/ca32cf53cc4dc0484f0c2fea56bfb49d0946dce0/src/store/pinia/artifact.ts) 用 `Map<id, artifact>` 保存实例，并用 hash 计数，而不是把相同内容天然合并成一件。这一点与 GBFR 的重复因子要求一致。
- **事实**：[`src/types/preset.ts`](https://github.com/wormtql/genshin_artifact/blob/ca32cf53cc4dc0484f0c2fea56bfb49d0946dce0/src/types/preset.ts) 定义命名预设；[`src/store/pinia/preset.ts`](https://github.com/wormtql/genshin_artifact/blob/ca32cf53cc4dc0484f0c2fea56bfb49d0946dce0/src/store/pinia/preset.ts) 给预设记录版本；[`CharacterPresetsPage.vue`](https://github.com/wormtql/genshin_artifact/blob/ca32cf53cc4dc0484f0c2fea56bfb49d0946dce0/src/pages/CharacterPresetsPage/CharacterPresetsPage.vue) 支持单个或全部 JSON 导入导出。
- **事实**：[`src/store/backend.ts`](https://github.com/wormtql/genshin_artifact/blob/ca32cf53cc4dc0484f0c2fea56bfb49d0946dce0/src/store/backend.ts) 同时抽象浏览器 localForage 和目录文件后端，并用元数据检测外部修改；这是“库存、预设、数据库版本分别落盘”的好参考。
- **事实**：[`src/wasm/single_optimize.js`](https://github.com/wormtql/genshin_artifact/blob/ca32cf53cc4dc0484f0c2fea56bfb49d0946dce0/src/wasm/single_optimize.js) 在 Web Worker 中执行 WASM 求解，并设 10 分钟超时，避免阻塞 UI。
- **建议**：GBFR 应采用同样的边界，但无需复制莫娜的伤害模型、DSL、A* 和队伍优化。GBFR 当前目标是约束满足与词典序排序，位集 + 剪枝/动态规划或 ILP 都比照搬复杂伤害优化更直接。

### YAS 的采集机制

- **事实**：莫娜推荐的扫描器是 [wormtql/yas](https://github.com/wormtql/yas)。本次检查 commit [`757689f`](https://github.com/wormtql/yas/commit/757689f062d0f3c2dc0bd48e16544f5f6e8e78d1)，Release [`v0.1.21`](https://github.com/wormtql/yas/releases/tag/v0.1.21)，均为 2025-05-25。
- **事实**：[`README.md`](https://github.com/wormtql/yas/blob/757689f062d0f3c2dc0bd48e16544f5f6e8e78d1/README.md) 说明它以 Rust 和针对游戏字体训练的 SVTR OCR 工作；要求从背包顶部开始、扫描期间不操作鼠标，推荐 16:9，只支持简体中文和键鼠。
- **事实**：[`yas/src/game_info/os/winodws.rs`](https://github.com/wormtql/yas/blob/757689f062d0f3c2dc0bd48e16544f5f6e8e78d1/yas/src/game_info/os/winodws.rs) 先设置 DPI awareness，再按窗口标题枚举句柄、恢复并置前窗口，通过 `GetClientRect + ClientToScreen` 取得客户区坐标，并拒绝不支持的宽高比。
- **事实**：[`window_info_repository.rs`](https://github.com/wormtql/yas/blob/757689f062d0f3c2dc0bd48e16544f5f6e8e78d1/yas/src/window_info/window_info_repository.rs) 对已知分辨率使用精确坐标，对相同比例的其他分辨率按宽度比例缩放；原神扫描器内置多套分辨率 JSON，见 [`artifact_scanner.rs` 应用入口](https://github.com/wormtql/yas/blob/757689f062d0f3c2dc0bd48e16544f5f6e8e78d1/yas-genshin/src/application/artifact_scanner.rs)。
- **事实**：Windows 抓屏由 [`winapi_capturer.rs`](https://github.com/wormtql/yas/blob/757689f062d0f3c2dc0bd48e16544f5f6e8e78d1/yas/src/capture/winapi_capturer.rs) 使用桌面 DC 的 BitBlt，失败后可走 screenshots fallback；因此扫描时游戏必须可见，不能据此得到后台捕获能力。
- **事实**：[`repository_layout/controller.rs`](https://github.com/wormtql/yas/blob/757689f062d0f3c2dc0bd48e16544f5f6e8e78d1/yas-genshin/src/scanner_controller/repository_layout/controller.rs) 逐格移动并点击，通过局部像素池变化等待详情面板稳定；滚动时采样标志像素的“离开初始颜色再回到初始颜色”判断一行是否对齐，先学习单行滚轮量，再估算多行滚动长度并微调。
- **事实**：[`artifact_scanner.rs`](https://github.com/wormtql/yas/blob/757689f062d0f3c2dc0bd48e16544f5f6e8e78d1/yas-genshin/src/scanner/artifact_scanner/artifact_scanner.rs) 将截图发送给独立识别线程，主线程继续遍历 UI；[`artifact_scanner_worker.rs`](https://github.com/wormtql/yas/blob/757689f062d0f3c2dc0bd48e16544f5f6e8e78d1/yas-genshin/src/scanner/artifact_scanner/artifact_scanner_worker.rs) OCR 标题、主词条、副词条、等级与装备状态。
- **事实**：YAS worker 把完整识别结果放入 `HashSet` 去重，并在连续重复达到一行列数时认为翻页错误；[`scan_result.rs`](https://github.com/wormtql/yas/blob/757689f062d0f3c2dc0bd48e16544f5f6e8e78d1/yas-genshin/src/scanner/artifact_scanner/scan_result.rs) 的 hash 覆盖全部可见字段。
- **关键判断**：这一去重规则不能用于 GBFR。两件完全相同的 V+ 因子是两件合法库存，按内容 `HashSet` 会少算数量。GBFR 只能去除“滚动重叠导致同一格被重复读取”的扫描事件，不能去除“内容相同的库存实例”。建议给每次遍历产生 `(scanSessionId, logicalIndex)`，重叠页用网格图像序列对齐；最终仍为每件实例生成独立 `instanceId`。
- **事实**：YAS 的扫描结果结构只有文本字段，没有把 OCR 概率传到最终记录，也没有主应用内的逐项人工复核界面。它依靠定制字库、合法值解析、物品数量、星级/等级阈值和重复异常来约束错误。

### YAS 许可证边界

- **事实**：YAS 顶层没有许可证文本，GitHub API 没有识别许可证；但 [`yas/Cargo.toml`](https://github.com/wormtql/yas/blob/757689f062d0f3c2dc0bd48e16544f5f6e8e78d1/yas/Cargo.toml) 与游戏 crate 的 manifest 声明 `GPL-2.0-or-later`。
- **判断**：许可证表达与分发材料不完整，且莫娜主仓库的 MIT 不会自动覆盖其 `sub/yas`。在作者补充/澄清前，不应复制 YAS 源码或模型；可以独立实现由公开行为观察得到的网格扫描策略。

## 五、补充库存 OCR 项目：`WuWa_Inventory_Kamera`

### 版本、栈与数据更新

- **事实**：仓库为 [Psycho-Marcus/WuWa_Inventory_Kamera](https://github.com/Psycho-Marcus/WuWa_Inventory_Kamera)。本次检查 commit [`7b5ecf4`](https://github.com/Psycho-Marcus/WuWa_Inventory_Kamera/commit/7b5ecf4eca355d3f4a06fb0d65e8419d1f984883)，Release [`v1.7.1`](https://github.com/Psycho-Marcus/WuWa_Inventory_Kamera/releases/tag/v1.7.1)，均为 2025-09-26。
- **事实**：[`requirements.txt`](https://github.com/Psycho-Marcus/WuWa_Inventory_Kamera/blob/7b5ecf4eca355d3f4a06fb0d65e8419d1f984883/requirements.txt) 与源码显示它使用 Python、PySide6、RapidOCR/ONNX Runtime、OpenCV、MSS 和 pywin32；README 只保证全屏，以及 1680×1050、1920×1080、2560×1440 三种已测试分辨率。
- **事实**：[`updater/databaseUpdater.py`](https://github.com/Psycho-Marcus/WuWa_Inventory_Kamera/blob/7b5ecf4eca355d3f4a06fb0d65e8419d1f984883/updater/databaseUpdater.py) 通过 GitHub Contents API 从 `Dimbreath/WutheringData` 下载文本、物品和武器数据，并转换成本地按语言映射的 JSON。
- **建议**：GBFR 可以借鉴“显示名与稳定 ID 分离、按语言生成搜索词典”，但正式数据更新包应包含 schema version、游戏版本、来源、内容 hash 和签名/校验，不应仅按远端文件大小判断更新。

### DPI、坐标、滚动和识别

- **事实**：[`game/foreground.py`](https://github.com/Psycho-Marcus/WuWa_Inventory_Kamera/blob/7b5ecf4eca355d3f4a06fb0d65e8419d1f984883/game/foreground.py) 同时按窗口标题和进程名找游戏，读取 `GetDpiForWindow/96`，把窗口尺寸除以 DPI 比例，再选择显示器。
- **事实**：[`game/screenInfo.py`](https://github.com/Psycho-Marcus/WuWa_Inventory_Kamera/blob/7b5ecf4eca355d3f4a06fb0d65e8419d1f984883/game/screenInfo.py) 优先取精确分辨率坐标，否则选最近宽高比并缩放 [`game/gameROI.py`](https://github.com/Psycho-Marcus/WuWa_Inventory_Kamera/blob/7b5ecf4eca355d3f4a06fb0d65e8419d1f984883/game/gameROI.py) 的固定 ROI。
- **事实**：[`scraping/utils/common.py`](https://github.com/Psycho-Marcus/WuWa_Inventory_Kamera/blob/7b5ecf4eca355d3f4a06fb0d65e8419d1f984883/scraping/utils/common.py) 使用 MSS 抓取显示器区域，并以 CLAHE、模糊、Otsu 二值化、形态闭运算和锐化预处理 OCR；OCR 结果中的置信度被丢弃，只保留文本。
- **事实**：[`echoesScraper.py`](https://github.com/Psycho-Marcus/WuWa_Inventory_Kamera/blob/7b5ecf4eca355d3f4a06fb0d65e8419d1f984883/scraping/echoesScraper.py) 遍历 4×6 网格、读总数计算页数、按颜色识别稀有度、对名称做 0.9 cutoff 的模糊匹配，并按裁剪图 hash 缓存 OCR；翻页使用固定滚轮量和 1.2 秒等待。
- **事实**：普通材料的 [`itemsScraper.py`](https://github.com/Psycho-Marcus/WuWa_Inventory_Kamera/blob/7b5ecf4eca355d3f4a06fb0d65e8419d1f984883/scraping/itemsScraper.py) 不依赖总数，而是按名称再次出现次数判断滚到底，再从最后一页倒序补扫。
- **判断**：固定滚轮量 + 固定等待在帧率波动、不同滚轮设置、DPI/超宽屏下较脆弱。GBFR 应同时检测“详情面板已切换”“滚动已停止”“网格锚点已对齐”，超时则重试或进入复核，而不是盲等固定时长。

### 人工复核

- **事实**：当普通物品名称不能映射到数据库时，`itemsScraper.py` 保存详情裁剪图并记录数量；[`ui/homeUI.py`](https://github.com/Psycho-Marcus/WuWa_Inventory_Kamera/blob/7b5ecf4eca355d3f4a06fb0d65e8419d1f984883/ui/homeUI.py) 展示失败截图、数量、可搜索物品列表，允许“跳过”或“更新”。
- **建议**：这是所有参考项目中最接近本项目所需的复核闭环，但 GBFR 应把它扩展到低置信度而不只是“完全无法映射”。复核项至少保留原截图、两个词条候选及各自分数、等级候选、逻辑库存序号和扫描会话。

### 许可证边界

- **事实**：仓库许可证为 [GPL-3.0](https://github.com/Psycho-Marcus/WuWa_Inventory_Kamera/blob/7b5ecf4eca355d3f4a06fb0d65e8419d1f984883/LICENSE)。
- **判断**：若不准备把整个派生作品按 GPL-3.0 分发，就只能借鉴工作流并独立实现；RapidOCR、模型、数据源和图标还需分别检查许可证。

## 六、对 GBFR 的直接实施建议

### 1. 采集层应是可替换适配器

建议将采集拆为五层，避免存档 PoC 失败后重写求解器：

1. `InventorySource`：`SaveFileSource` 与 `VisionSource` 输出同一库存快照。
2. `WindowCapture`：按进程/窗口类选 HWND，获取客户区；优先 WGC，后备 BitBlt/桌面捕获，并记录捕获能力诊断。
3. `GridNavigator`：只负责定位、点击、滚动、等待稳定、逻辑序号，不理解技能文本。
4. `SigilRecognizer`：裁剪主词条、副词条、两级别（如 UI 可见）并输出候选及概率；合法技能词典约束解码。
5. `InventoryReconciler`：保留实例数量，处理滚动重叠，生成复核队列和最终快照。

这套接口使存档读取成功时只替换第 1 层；失败时 CV 仍能无缝接入后续求解和 UI。

### 2. 窗口、缩放和 DPI 的最低支持策略

- MVP 建议只支持 Windows、Steam PC 版、简体中文、16:9、1920×1080 与 2560×1440、窗口化/无边框、游戏可见且前台。
- 进程、窗口标题和窗口类三者联合定位；多窗口时让用户从缩略图中选择，不使用模糊命中后的第一个窗口。
- 程序声明 Per-Monitor DPI Aware V2，所有 ROI 以客户区像素计算，不把屏幕物理坐标、窗口外框和逻辑 DPI 坐标混用。
- 每次扫描先做“锚点校准”：识别因子列表区域、详情面板边界、首格中心和行/列间距。纯比例缩放只作初值，不作最终定位。
- 扫描前给出环境检查：语言、分辨率、宽高比、页面、排序方式、滚动是否在顶部、覆盖层/HDR/滤镜风险。

### 3. 滚动和去重必须围绕“同一实例”，不是“相同内容”

- 若界面显示因子总数，先 OCR 总数并用网格容量计算预计页数；总数只作约束，不应在 OCR 失败时默认为某个大值静默继续。
- 每次翻页保留翻页前后网格缩略图，用感知 hash/特征匹配估算重叠行；以“旧页尾部序列 == 新页头部序列”确定逻辑索引推进量。
- 对内容完全相同的因子仍创建不同 `instanceId`。内容 hash 只用于快速比较和聚合显示，库存结构应是 `instanceId -> SigilInstance`，并额外维护 `contentHash -> count`。
- 终止条件至少双重满足：达到可靠总数；或连续两次滚动后网格与滚动条位置均不再变化。异常重复只能触发重试/复核，不能直接删库存。

### 4. 置信度与人工复核

单一 OCR 分数不足以判断正确性，建议组合：

- OCR 字符概率；
- 到合法技能词典的编辑距离；
- 主/副词条合法性与因子规则；
- 同一裁剪连续两帧的一致性；
- UI 锚点和详情面板是否稳定；
- 等级是否在合法范围。

低于阈值的实例进入复核队列。复核界面一次只处理一件，显示原图和裁剪图，给出前 3 个候选，允许重扫、修正、跳过；完成后再提交库存快照。不要像部分参考项目那样丢弃 OCR 概率后直接模糊匹配为唯一答案。

### 5. 数据、库存与预设分开版本化

建议至少有三种独立文件：

- `game-data.json`：`schemaVersion`、`gameVersion`、`sourceRevision`、技能稳定 ID、中文名、类别、主/副合法性。
- `inventory.json`：`schemaVersion`、扫描时间、捕获环境、每件因子的 `instanceId`、主副技能、等级、置信度、证据截图引用。
- `build-preset.json`：有序目标技能 ID 列表、必出前 N 条、屏蔽技能 ID、结果上限和名称。

用户要求的短字符串导入导出应只编码 `build-preset`，使用版本前缀、稳定 ID、压缩编码和校验和；不要把显示名直接编码，因为翻译或改名会破坏兼容性。完整 JSON 仍可作为诊断和备份格式。

### 6. 结果展示

- 默认仅展示前 10 个“方案组”，格式可聚合为 `追击&伤害上限 ×2 + 伤害上限&追击`。
- 每组显示：满足目标数、首个未满足目标、屏蔽技能数量、因子等级总和；屏蔽词条在摘要和展开列表中都标红。
- 聚合摘要下可展开实际库存实例及等级，确保两个内容相同的因子仍能被验证为两件库存。
- 求解放在后台任务中，支持取消；结果排序键应显式构造并测试，不照搬莫娜的伤害分数或随机启发式。

## 七、最值得借鉴的 5 点

1. **莫娜的边界**：扫描器与求解器通过版本化 JSON 解耦，库存和预设分别持久化。
2. **YAS 的扫描流水线**：主线程遍历并截图、后台线程 OCR；详情变化与滚动反馈用于等待稳定，而非完全依赖固定 sleep。
3. **ok-script 的 Windows 捕获抽象**：窗口句柄、WGC/BitBlt 备选、统一分辨率坐标、诊断截图和识别框。
4. **WuWa Inventory Kamera 的人工复核队列**：无法映射时保留截图，让用户搜索修正，而不是静默丢弃。
5. **gbfr-relink-sim 的稳定数据模型与选择器**：主/副词条能力、五类技能、搜索 + 分类过滤、命名预设和技能来源展开。

## 八、不可照搬的部分

- 不复制 YAS 的内容 `HashSet` 去重；它会误删 GBFR 中合法的同技能同等级重复因子。
- 不复制 WuWa 工具的全屏固定坐标、固定滚轮量、固定等待和“0.9 模糊命中即接受”。
- 不引入 `ok-wuthering-waves` 的战斗/任务自动化、YOLO 角色识别和游戏玩法功能。
- 不引入莫娜的伤害 DSL、角色/武器/Buff 模型、A* 目标函数；GBFR 的当前问题更适合专用约束求解器。
- 不把第三方仓库中的游戏图标、翻译、内嵌数据和 OCR 模型视为可自由再分发素材。
- 不在许可证未明确或 AGPL/GPL 义务未接受时复制实现；“参考设计思想”和“复用源码”必须分开处理。

## 主要来源索引

- [choeki/gbfr-relink-sim](https://github.com/choeki/gbfr-relink-sim/tree/6aba7fc633e870de65f26c01462cdbe1dd6b6baa)
- [ok-oldking/ok-wuthering-waves](https://github.com/ok-oldking/ok-wuthering-waves/tree/513f4d1ebdcce212422ae8d44746d6f8610336c5)
- [ok-oldking/ok-script](https://github.com/ok-oldking/ok-script/tree/2a988638cf32ef5faffec6d5474c8555e24da83d)
- [wormtql/genshin_artifact（莫娜占卜铺）](https://github.com/wormtql/genshin_artifact/tree/ca32cf53cc4dc0484f0c2fea56bfb49d0946dce0)
- [wormtql/yas](https://github.com/wormtql/yas/tree/757689f062d0f3c2dc0bd48e16544f5f6e8e78d1)
- [Psycho-Marcus/WuWa_Inventory_Kamera](https://github.com/Psycho-Marcus/WuWa_Inventory_Kamera/tree/7b5ecf4eca355d3f4a06fb0d65e8419d1f984883)

