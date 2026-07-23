# 存档读取工作进程协议

## 1. 进程模型

每次导入启动一个短生命周期 `GBFRTool.SaveReader.Worker.exe`。一次任务结束后进程退出，避免解析库状态、句柄或内存泄漏跨任务积累。

- stdin：Engine Host 内的 SaveReader Client 发送 NDJSON 请求。
- stdout：工作进程发送 NDJSON 协议消息，禁止混入普通日志。
- stderr：工作进程结构化诊断；Engine Host 按 correlation ID 收集。
- exit code：`0` 成功，`2` 请求/协议错误，`3` 存档格式错误，`4` 内部错误，`130` 取消。

## 2. 握手

工作进程启动后先发送 `WorkerHello`：

```json
{"protocolVersion":1,"workerVersion":"0.1.0","capabilities":["read-only","stdio-ndjson"]}
```

SaveReader Client 在发送路径前验证协议版本和能力。版本不兼容时直接终止进程并返回 `save.worker.protocol_mismatch`。

## 3. 请求

`ImportSaveRequest` 只接受应用缓存中的稳定快照路径：

```json
{
  "protocolVersion": 1,
  "correlationId": "32位十六进制字符串",
  "snapshotPath": "应用缓存中的绝对路径",
  "expectedSha256": "小写十六进制 SHA-256",
  "catalogVersion": "2.0.2-20260722.1"
}
```

Worker 必须：

1. 拒绝相对路径、目录和非普通文件。
2. 以共享读、禁止写的方式打开文件。
3. 复算 SHA-256；不一致时拒绝解析。
4. 限制输入大小、消息长度、最大实例数和执行时间。
5. 不访问源存档路径、网络、注册表或 Engine 数据库。

## 4. 响应与诊断

成功返回 `ImportSaveResponse`，每个重复因子都有独立 `instanceId`。未知项保留原始 hash，并通过 `WireDiagnostic` 报告；不得静默删除。

失败返回 `WorkerFailure`，其中 `retryable` 只描述相同输入在环境变化后是否值得重试。展示文本由 Engine 返回 typed reason，再由 Renderer 本地化。

## 5. 取消与超时

Renderer 向 Engine 发送显式取消命令；Engine 对 SaveReader Worker 采用进程级取消：停止读取、关闭 stdin，等待短暂宽限期后终止 Worker。因为 Worker 只读取临时快照，强制退出不会造成源存档损坏。

## 6. 独立调试入口

Worker 必须支持：

```powershell
GBFRTool.SaveReader.Worker.exe --self-test
GBFRTool.SaveReader.Worker.exe --parse <snapshot> --diagnostics <output-directory>
```

`--parse` 仍要求输入是副本，并默认只输出脱敏摘要。开发者显式启用敏感诊断时，CLI 应再次确认输出目录和包含字段。
