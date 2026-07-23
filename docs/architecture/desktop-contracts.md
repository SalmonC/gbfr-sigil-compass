# Electron 桌面合同与安全边界

## 1. 规范来源

`contracts/desktop/v1/*.schema.json` 是 Electron Main 与 .NET Engine Host 的跨运行时规范来源。TypeScript 与 C# 类型由 schema 生成；黄金消息同时在两端做序列化、反序列化和运行时验证。Renderer 只接触 Preload 暴露的 ViewModel API，不直接发送 NDJSON。

所有信封包含：

```text
protocolVersion, messageType, requestId, correlationId, payload
```

握手返回 `engineVersion`、`buildManifestHash`、`catalogSchemaVersion`、`maxFrameBytes` 和能力集合。必须协商的能力至少包括：

```text
fileImport, saveDiscovery, readOnlySaveWorker, workerIsolation,
profilePersistence, shareCode, targetDraftV1
```

macOS 不支持 Windows 默认存档发现时返回 `saveDiscovery=false`；Renderer 只根据能力禁用该入口并解释原因，不能自己判断操作系统来复制业务规则。

## 2. 八域目标合同

新合同只有以下六个 domain：

```text
mandatory
basicPrimary
attackPrimary
defensePrimary
optional
basicSubstitutionOrder
forbidden
avoid
```

- `mandatory`、`basicPrimary`、`attackPrimary`、`defensePrimary`、`optional` 是允许重复的有序 occurrence 序列。
- `basicSubstitutionOrder` 是启用时参与请求的有序唯一序列。
- `forbidden`、`avoid` 是无序唯一集合，规范化时按稳定 Skill ID 排序。
- 八域中 `mandatory ↔ optional` 是唯一允许共享同一 Skill ID 的组合，因为两者只是普通目标的优先级分段。其余组合交集互斥，且必须双向验证。
- `MandatoryPrefixLength` 只允许出现在旧 schema 迁移输入；不得进入新请求、ViewModel、保存记录、分享字符串或 request hash。

有序目标的每个草稿项为：

```text
targetEntryId, skillId, domain, position
```

`targetEntryId` 是草稿局部稳定的不透明 ID。持久化和分享按 `(domain, position, skillId)` 保存，加载为新草稿时重新分配 entry ID；求解器永远接收完整序列，不接收 `{skillId,count}` 聚合。

## 3. 版本化编辑会话

Engine 是已验证草稿的唯一事实源。Renderer 通过以下流程编辑：

1. `OpenTargetDraft(profileId?)` 返回 `draftId`、`revision=0` 和完整 `TargetEditorViewModel`。
2. 每次 `ApplyTargetEdit` 携带 `draftId`、单调 `baseRevision`、唯一 `editId`、命令创建时捕获的 `domain` 和精确 entry/index。
3. Engine 对单个 draft 串行处理并做 compare-and-swap。`baseRevision` 不等于当前值时返回 `desktop.draft.revision_conflict` 和当前摘要，不部分执行。
4. 成功返回 `acceptedRevision=baseRevision+1`、变更后的完整目标摘要、动态容量、occupancy 和禁用原因。
5. Renderer 只应用 revision 高于当前已确认值的响应；迟到、重复或未知 edit ID 响应被丢弃。单个 edit ID 的重试必须幂等。
6. 保存和分析携带 `draftId + expectedRevision`，Engine 再运行完整 Catalog-aware normalizer；不能只信任增量编辑结果。

首版不做乐观写入：命令在途时保留清晰的短暂 pending 状态，同一草稿的后续命令排队，避免本地回滚造成视觉跳变。性能测量证明需要时，才通过单独决策增加可撤销的乐观 reducer。

`ApplyTargetEdit` 的最小命令集合：

```text
AddTarget(skillId, domain, insertAfterEntryId?)
RemoveTarget(targetEntryId)
MoveTarget(targetEntryId, beforeEntryId?)
SetPrimaryPriority(enabled)
SetSubstitutionEnabled(enabled)
ResolveConflict(skillId, keepDomain)
```

添加命令捕获发出时已激活的 domain；Engine 不读取 Renderer 当前激活状态。无激活区域时 Renderer 不发送命令。

## 4. 文件选择授权

Renderer 永远不提交或接收绝对路径。`chooseSaveFile()` 由 Main 调用原生对话框并返回：

```text
grantId, displayName, size, expiresAt
```

Main 的 grant registry 必须满足：

- `grantId` 至少 128 bit 密码学随机，不可按计数猜测；
- 绑定创建它的 WebContents/session、规范化后的普通文件、文件身份和 `importInventory` 单一用途；
- 默认 10 分钟 TTL，一次消费；窗口销毁、导航、超时或首次使用后立即撤销；
- 对话框结果先 realpath/handle 校验，拒绝目录、设备、管道和解析后逃逸的符号链接；消费时再次核对文件身份，防止换目标；
- sender 校验失败、重放、跨窗口使用或字段篡改都返回稳定错误且不向 Renderer泄露真实路径。

Main 只在消费 grant 时把实际路径传给 Engine 的私有 stdin。Engine 仍以稳定快照和前后元数据/hash 校验防御选择后被游戏改写的文件。

## 5. Engine 与 Worker 启动

生产包固定布局：

```text
resources/engine/<rid>/GBFRTool.Engine.Host[.exe]
resources/engine/<rid>/GBFRTool.SaveReader.Worker[.exe]
resources/engine/<rid>/build-manifest.json
```

这些文件通过 Forge `extraResource` 放在 asar 外的只读资源位置，并纳入平台签名。Main 只用 `process.resourcesPath` 加固定相对段定位 Engine；Engine 只用自身资源根定位 Worker。开发模式路径来自签入的开发配置，不接受 Renderer、IPC、PATH 或用户目录覆盖。

启动参数固定采用 `shell:false`、显式 `cwd`、stdio pipes、最小环境变量 allowlist；Windows 使用隐藏子进程窗口。启动前验证文件类型、规范化路径、manifest SHA-256、RID 和可执行权限；握手再验证协议、能力和 manifest hash。任何失败停止运行并进入诊断页，不能回退到同名 PATH 程序。

## 6. 资源与拒绝服务限制

- 协商后的单帧默认上限 16 MiB；超过即拒绝并终止当前协议会话。
- 每个 Renderer 同时最多一个导入/写入操作和一个分析操作；Main 待处理命令队列最多 128 项。
- 每个 Engine 实例同时最多一个 SaveReader Worker；取消/超时后必须回收句柄和临时快照。
- 进度事件在 Main 侧合并到每操作每秒最多 10 次；完成和错误事件不得丢弃。
- profile、目标 occurrence、库存实例、字符串和诊断项都由 schema 定义上限；超过返回 typed validation error，不预分配无界集合。
- Engine 异常退出最多自动重启一次；重启窗口内再次退出则停止重启，避免进程风暴。

## 7. 能力与错误

错误使用稳定代码，不把 C# 异常、绝对路径或 Electron event 传给 Renderer。至少覆盖：

```text
desktop.protocol.*
desktop.draft.*
desktop.grant.*
desktop.engine.*
save.snapshot.*
save.inventory_cache.*
```

Preload 每个方法都有独立 schema 和 channel；禁止 `send(channel,payload)`、同步 IPC、任意订阅和原始 event 回调。
