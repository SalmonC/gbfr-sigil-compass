# 因子罗盘（Sigil Compass）

《碧蓝幻想 Relink》V+ 因子配装工具。它会只读解析本地存档，根据现有库存计算配装方案，适合因子较多、不想逐页翻找的玩家。

> 当前公开版为 Windows x64 `v0.2.0`。项目是非官方玩家工具，与 Cygames、发行商及平台方无关。

## 主要功能

- 直接读取 `SaveData*.dat`，自动整理持有的双词条因子。
- 设置必须满足、可选目标，以及基础、攻击、防御类主词条。
- 将不想要的技能分为“不能出现”和“尽量避开”。
- 按目标完成情况、屏蔽技能、因子数量和等级等规则计算前 10 套方案。
- 保存和分享命名方案；更新库存后可以重新计算。
- 查看全部持有因子，并按技能、分类、等级和占用状态筛选。
- 确认角色配装后，占用具体因子，避免多个角色使用同一枚因子。

完整排序规则见 [配装匹配与排序规格](docs/architecture/ranking-specification.md)。

## 下载与运行

1. 打开 [Releases](https://github.com/SalmonC/gbfr-sigil-compass/releases)，下载 `Sigil-Compass-0.2.0-win-x64-portable.zip`。
2. 解压到普通文件夹，不要直接在压缩包内运行。
3. 双击 `Sigil-Compass.exe`。

当前程序没有商业代码签名，Windows 可能弹出 SmartScreen 提示。请确认文件来自本仓库 Release，并用同一 Release 中的 `SHA256SUMS.txt` 核对哈希。

详细步骤见 [使用说明](docs/user-guide.md)，常见问题见 [故障排查](docs/troubleshooting.md)。

## 存档位置

Windows 默认目录：

```text
%LOCALAPPDATA%\GBFR\Saved\SaveGames\
```

通常选择 `SaveData1.dat`。如果目录里有多个 `SaveData*.dat`，请选择修改时间最新的文件。应用只读取存档，不会写回或自动备份；首次使用前仍建议自行复制一份备份。

## 隐私与本地数据

- 存档、库存和方案不会上传，应用运行时不需要联网。
- 读取时先创建私有临时副本，解析完成后删除；原存档不会交给可写组件。
- 应用会保存解析后的因子清单、最近一次存档路径、方案和已确认配装，但不会保存存档副本。
- 启动时只恢复上次的库存快照，不会自动重读存档。游戏内库存改变后，需要手动点击“读取存档”。

具体保存内容和清理方法见 [隐私说明](PRIVACY.md)。

## 当前限制

- 技能目录以 GBFR Ver. 2.0.2 为基线，游戏更新后可能需要同步数据。
- 只考虑带两个技能的 V+ 因子。
- 每次最多显示排序后的前 10 套逻辑方案。
- 极端目标组合可能触发 30 秒或状态容量上限；此时不会返回不完整结果。
- 当前 Electron 便携包约 173 MB，解压后约 426 MB。Windows-only 的 Tauri 2 + Rust 轻量版正在迁移，目标是在功能和界面不回退的前提下显著缩小体积。
- 当前版本未做 Windows 原生代码签名，也没有自动更新功能。

## 开发

环境版本由 `.node-version`、`global.json` 和 `desktop/package-lock.json` 固定。

```bash
./eng/verify.sh
cd desktop
npm ci
npm run verify:release
```

真实存档测试必须把文件放在仓库外：

```bash
GBFR_TEST_SAVE=/path/to/SaveData1.dat npm run test:engine-import
GBFR_SAVE_FIXTURE_DIR=/path/to/SaveGames npm run test:save-fixtures
```

Windows 发行包：

```bash
cd desktop
npm run make:win-x64
```

架构入口见 [docs/architecture/README.md](docs/architecture/README.md)。Tauri 重构决策见 [ADR-0011](docs/architecture/adr/0011-windows-tauri-rust-rewrite.md)。

## 反馈

遇到问题请先阅读 [故障排查](docs/troubleshooting.md)，再提交 Issue。不要在公开 Issue 中上传存档；建议附上系统版本、应用版本、操作步骤、错误提示和经过遮挡的截图。

安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 权利说明

仓库目前公开源代码，但尚未授予通用的开源使用许可，详见 [LICENSE.md](LICENSE.md)。游戏名称、技能名称、数据和图标归各自权利人所有，不包含在本项目代码许可中。素材来源和处理边界见 [NOTICE.md](NOTICE.md)。
