# 因子罗盘（Sigil Compass）

面向《碧蓝幻想 Relink》Ver. 2.0.2 的离线 V+ 因子库存读取与配装工具。正式目标为 Windows x64 免安装版，同时提供 Apple Silicon macOS 验证版。

## 使用方式

Windows：从 GitHub Releases 下载 Windows 便携包，解压后双击 `Sigil-Compass.exe`。macOS：解压后打开 `Sigil Compass.app`。应用已封入 Electron、.NET Engine、只读存档 Worker 和固定技能目录，不需要安装 Node.js、.NET 或连接网络。

1. 建议先自行备份游戏存档，再点击“读取存档”选择 `SaveData*.dat`。应用只读解析，不会修改或自动备份原存档。
2. 点击右侧任一目标区域将其激活，再从左侧技能池添加；点击目标中的技能即可删除。
3. 点击“开始分析”。最多显示排序后的前 10 个逻辑方案；同一主副词条组合可合并显示数量，实例等级只用于同方案实体选择和排序。
4. 方案可命名后保存在本机，也可复制带名称、顺序和选项的 `GBFR-RANK-3` 分享字符串。

存档导入采用一次性路径授权，并先复制到应用私有临时快照后解析。原存档不会交给可写组件，校验失败会直接拒绝。应用会记住上次成功读取的路径和因子库存快照，但启动时不会自动重读；存档变化后需要手动点击“读取存档”更新。

## 内置测试目标

首次启动会载入“欧羽尼高手-截图前16项”：图片前 16 个技能按出现次数录入，前 8 个为必须满足；基础能力主词条为 3 个昏厥、2 个体力且优先保证；刀上舞、穷寇心禁止出现；坚守、格挡性能、稳如泰山为尽量避开。

本地验证存档可读取 401 个 V+ 因子。该库存只能满足 1/5 个指定基础能力主词条，因此结果会明确显示缺少 4 个，而不是隐藏这些方案。真实存档不进入源码仓库。

## 开发与验证

```bash
./eng/verify.sh
cd desktop
npm ci
npm run typecheck
npm run test:contracts
GBFR_TEST_SAVE=/path/to/SaveData1.dat npm run test:engine-import
GBFR_SAVE_FIXTURE_DIR=/path/to/SaveGames npm run test:save-fixtures
```

发行构建：

```bash
cd desktop
npm run make:mac-arm64
npm run make:win-x64
```

Windows 包可在 macOS 上交叉生成并检查内容，但正式发布前仍应在干净的 Windows 10/11 x64 环境执行一次启动、导入和分析冒烟测试。

架构与排序规则见 [架构文档](docs/architecture/README.md)，原始需求保存在 [original_requirements.md](docs/original_requirements.md)。

本项目是非官方工具，与 Cygames 或发行方无隶属关系。应用严格只读存档；仍建议在首次使用前自行备份。
