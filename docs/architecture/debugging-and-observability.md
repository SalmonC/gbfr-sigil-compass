# 调试与可观测性

## 1. 调试目标

用户报告“少了一枚因子”或“排序不对”时，开发者应能回答：

1. 读取了哪个快照和解析器版本？
2. 哪个阶段丢失、过滤或转换了实例？
3. 求解器收到了什么规范化请求？
4. 使用哪个 run seed 和比较器版本得到结果？

## 2. 关联标识

| 标识 | 生命周期 |
|---|---|
| `correlationId` | 一次 UI 用例调用，贯穿 Renderer、Electron Main、Engine、Worker、仓储与求解器 |
| `snapshotId` | 一次成功导入的不可变库存快照 |
| `sourceSha256` | 稳定副本内容，仅显示前 8 位；完整值保存在本地数据库 |
| `requestHash` | 规范化 BuildRequest 的 SHA-256 |
| `runSeed` | 最终随机 tie-break，保证结果可重放 |

每条结构化日志至少含时间、级别、事件 ID、correlation ID、组件和错误码。不得用自由文本替代可查询字段。

## 3. 日志事件

建议稳定事件 ID：

```text
1000 ImportRequested
1010 StableSnapshotCreated
1020 WorkerStarted
1030 WorkerHandshakeAccepted
1040 SaveParsed
1050 InventoryMapped
1090 ImportFailed

2000 AnalysisRequested
2010 InventoryCompressed
2020 SolverStarted
2030 SolverCandidateFound
2040 SolverCompleted
2090 AnalysisFailed
```

普通日志不记录：原始存档字节、Steam ID、玩家名、完整用户路径、完整 IPC payload、因子实例的全部原始字段。

## 4. Activity 与耗时

使用 `System.Diagnostics.ActivitySource` 建立以下 span：

```text
inventory.import
  snapshot.copy
  worker.start
  worker.handshake
  save.parse
  inventory.map
  snapshot.persist

build.analyze
  inventory.load
  inventory.compress
  solver.optimize
  result.materialize
```

首版不上传遥测。开发模式可把 trace 写到本地 JSON；未来若加入上报，必须独立征得用户同意。

## 5. 诊断包

用户主动导出 ZIP，包含：

- `manifest.json`：应用、协议、parser、catalog、数据库 schema 和操作系统版本。
- `events.ndjson`：选定 correlation ID 的脱敏日志。
- `inventory-summary.json`：数量、未知 hash、过滤原因、内容签名计数。
- `request.json`：稳定 Skill ID、必须满足/基础能力主词条/可选目标、禁止出现/尽量避开集合、maxSlots、Catalog 版本、比较器版本和 runSeed。
- `result-summary.json`：排序键和 canonical signature，不含用户路径。

默认排除原始存档和稳定副本。若开发者确需样本，应让用户单独选择文件，并在发送前展示风险。

## 6. 调试开关

| 开关 | 用途 | 发布版默认 |
|---|---|---|
| `Diagnostics:Level` | Normal / Detailed | Normal |
| `Diagnostics:KeepStableSnapshot` | 暂时保留解析副本 | false |
| `Diagnostics:KeepWorkerMessages` | 保存脱敏协议消息 | false |
| `Solver:ExplainRanking` | 生成逐级排序解释 | true |
| `Solver:RunSeed` | 固定复现种子 | 自动生成并持久化 |

敏感开关只能从开发配置或显式诊断界面启用，不接受隐藏环境变量后门。

## 7. 全局异常

- Renderer 未处理异常：记录 correlation ID，展示可恢复错误页；未知状态下禁止提交新的写入命令。
- Electron Main 未处理异常：终止受影响窗口或 Engine 会话并进入诊断恢复流程，不继续接受特权 IPC。
- 未观察 Task 异常：记录为缺陷并在开发构建中 fail fast。
- Worker 崩溃：收集 exit code 与 stderr 尾部，返回 `save.worker.crashed`，UI 保持运行。
- OR-Tools 原生异常：转换成 `solver.engine_failed`；若实际出现进程不稳定，再通过 ADR 决定是否隔离求解器。
