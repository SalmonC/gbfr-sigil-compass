# Windows 换机交接：Tauri 2 + Rust 重构

## 1. 当前可用基线

- 私有仓库：`https://github.com/SalmonC/gbfr-sigil-compass`
- Electron 稳定版：`v0.2.0`
- 当前主分支提交：以 `origin/main` 最新提交为准
- Windows 包：Release 中的 `Sigil-Compass-0.2.0-win-x64-portable.zip`
- 重构决策：`docs/architecture/adr/0011-windows-tauri-rust-rewrite.md`

先运行 v0.2.0，使用同一存档和测试方案截图记录当前行为。它是重构的对照组，不应边迁移边改变产品规则。

## 2. Windows 开发环境

安装：

1. Codex Windows 客户端。
2. Git 与 GitHub CLI。
3. Visual Studio 2022 Build Tools，并勾选 **Desktop development with C++** 和 Windows 10/11 SDK。
4. Rust stable MSVC 工具链（`rustup`）。
5. Node.js；版本读取仓库根目录 `.node-version`。
6. Microsoft Edge WebView2 Evergreen Runtime。更新过的 Windows 10/11 通常已有。

Tauri 官方 Windows 前置要求：

- https://v2.tauri.app/start/prerequisites/

建议在 PowerShell 验证：

```powershell
git --version
gh --version
rustup show
rustc --version
cargo --version
node --version
npm --version
```

## 3. 克隆与分支

```powershell
gh auth login
New-Item -ItemType Directory -Force C:\Code | Out-Null
Set-Location C:\Code
gh repo clone SalmonC/gbfr-sigil-compass
Set-Location gbfr-sigil-compass
git switch -c rewrite/tauri-windows
```

不要把存档复制进仓库，也不要提交应用缓存、构建目录或 Release ZIP。

## 4. 在 Codex 中继续

用 Codex 打开 `C:\Code\gbfr-sigil-compass`，新建任务并发送：

> 继续因子罗盘的 Windows-only Tauri 2 + Rust 轻量化重构。先完整阅读 task_plan.md、progress.md、findings.md、docs/original_requirements.md、docs/architecture/adr/0011-windows-tauri-rust-rewrite.md 和 docs/handoff/windows-tauri-rewrite.md。Electron v0.2.0 是功能与视觉基线。先建立 parity 清单和 Tauri 骨架，再迁移 React/Vite 前端；用 Rust clean-room 重写只读存档解析器，不复制无许可证项目代码。每个阶段运行现有求解 oracle，并在 Windows 125%/150% 缩放下截图检查。不要删除 desktop/，直到真实存档、排序、缓存、确认配装和 UI 全部通过。

如果同一 Codex 账户能看到当前任务，也仍建议在 Windows 工作区新建任务：长对话不是可靠的工程状态，仓库文档和测试才是交接依据。

## 5. 第一轮实施顺序

1. 建立 `app/` 的 React/Vite + Tauri 2 骨架，先显示现有 UI。
2. 把纯 TypeScript 领域模块和 Web Worker 求解器迁入，保持 oracle 原样通过。
3. 建立最小 Tauri capabilities；默认拒绝远程导航和未声明能力。
4. 用 Rust 解析真实存档私有副本；先完成 checksum 与 401 因子夹具，再接 UI。
5. 迁移库存缓存、最近路径、确认配装和方案缓存。
6. 做 Windows DPI、窗口缩放、内存、耗时和产物体积检查。
7. 通过 parity 门槛后发布新的预览 Release；最后再删除 Electron/.NET。

## 6. 存档与隐私

把测试存档放在仓库外，例如：

```text
C:\GBFR-TestData\SaveData1.dat
```

测试脚本通过环境变量接收路径：

```powershell
$env:GBFR_TEST_SAVE = 'C:\GBFR-TestData\SaveData1.dat'
```

任何时候都只读源文件；解析前复制到应用私有临时目录，退出或完成后清理。测试应比较读取前后的 SHA-256。
