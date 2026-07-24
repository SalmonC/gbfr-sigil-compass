# 测试策略

## 1. 测试层级

| 层级 | 范围 | 外部依赖 |
|---|---|---|
| Domain 单元/属性测试 | 重复目标、A&A、比较器、规范化签名 | 无 |
| Application 用例测试 | 成功、取消、错误传播、仓储交互 | 内存 fake |
| Adapter 契约测试 | 每个 `IInventorySource`、Repository、Solver 实现遵守相同语义 | 临时目录/测试数据库 |
| Worker 协议测试 | 握手、版本、损坏消息、超时、退出码 | 子进程 |
| Desktop 合同测试 | JSON Schema、C#/TS 生成漂移、黄金消息、大小限制 | 无 |
| Renderer 组件测试 | 目标状态机、重复、tooltip、键盘、迟到响应 | 内存 DesktopApi |
| Main/Preload 安全测试 | sender、path grant、allowlist、导航、CSP、Engine 重启 | Electron harness |
| Golden fixture | 脱敏存档片段到 ParsedSave/InventorySnapshot | 固定二进制 fixture |
| 架构守卫 | 项目引用白名单、核心层无第三方包 | 项目 XML |
| Electron E2E | 启动、导入、编辑、分析、取消、保存/分享 | Windows/macOS runner |

## 2. 必须保持确定性的测试

- 相同 snapshot、BuildRequest、比较器版本和 runSeed 得到相同前 10 名。
- CP-SAT 在小库存上的完整排序与穷举 oracle 一致。
- 两个内容相同实例仍能同时被选择。
- `A&B` 与 `B&A` 保持不同 canonical signature。
- `GBFR-RANK-4` 的禁止技能可行性、三类主词条数量、精确覆盖、基础替代顺序、可选目标满足数、尽量避开出现次数、目标位置、槽位、等级和 seed 逐级验证。
- 目标外副词条只在同一主词条位置合并；目标外词条换到另一枚主词条因子时仍保留为独立方案。
- 手动改单词条、换整枚、删除和添加均只使用真实未占用实例；编辑后目标状态、屏蔽提示和技能等级汇总同步更新。
- 有序替代池执行“勾选追加、取消压紧、重新勾选追加到末尾”的状态转换。
- 一枚因子的主词条最多匹配一个基础、攻击或防御主词条目标，但仍可用另一个词条满足必须满足或可选目标。
- 关闭主词条优先后，基础属性目标退化为普通可选目标，替代池不参与结果。
- 任一主/副词条命中绝对屏蔽的因子均不能入选；软屏蔽仍按出现次数排序。
- 六个界面子目标的互斥规则、重复策略、具体禁用原因和旧配置冲突修复使用同一组参数化测试。
- 只有“可选目标”显示动态容量；验证公式 `24 - 必须满足数 - 三类主词条数`、三类主词条合计 12 项上限、实时更新、0 容量、旧配置超限和其他标题无配额徽标。
- 所有问号气泡验证 hover、focus、Escape、动态剩余数、可访问名称和 320 px 最大宽度。
- 点击当前子目标可取消激活；点击右侧技能只删除一个 occurrence 且不改变激活；无激活时点击左侧只提示不修改。
- 屏蔽集合以不同点击顺序构造时，规范化请求 hash 和 Top-10 完全一致。
- normalizer 覆盖八域全部两两组合：`mandatory ↔ optional` 双向允许同一 Skill ID，其余组合双向互斥；只规范化两个无序屏蔽集合，其余有序域保持顺序；重复规范化结果不变。
- inactive 替代池草稿不占用其他域、不进入 request hash；重开时冲突可达且可移除。
- 同分 assignment 在不同线程数、seed 相同的重复运行中生成相同逐目标解释见证。
- 旧单屏蔽列表幂等迁移到 SoftBlocked；覆盖跨域冲突、orphan Skill ID、Catalog 重分类、旧缓存失效和旧分享串。
- path grant 覆盖不可猜、sender/session 绑定、TTL、一次使用、重放、符号链接换目标、窗口销毁和文件身份变化。
- 库存快照覆盖原子替换、损坏/超大缓存拒绝、失败导入不覆盖、启动不访问源存档、上次路径不泄露到 Renderer，以及旧备份目录迁移清理。
- 缓存覆盖：名称变更保留、计算输入变更立即删除、库存指纹变更删除、占用只淘汰命中的结果、释放占用保守删除、v2 键迁移后清理。
- 重复真实存档求解至少 15 次并在每次后强制 GC；p95 小于 2 秒，首尾 post-GC heap 增长小于 8 MiB。Renderer 另验证每次响应后 Worker 已终止且 pending Map 为空。
- 用真实 401 枚库存和 24 个高频不同可选目标复现组合爆炸边界：快速路径达到切换线后必须自动进入低内存精确求解并返回结果，不得写磁盘缓存或留下 Worker。另用 24 项全连接合成库存验证能得到 24/24 完整覆盖，并用小规模穷举验证兜底排序一致。

## 3. 存档 fixtures

fixtures 分三类：

1. 人工构造的最小 FlatBuffers/typed unit 片段，用于字段边界。
2. 真实存档脱敏后提取的最小片段，用于兼容回归。
3. 完整真实存档，只保存在开发者本地安全目录，不提交仓库。

每个 fixture 附 manifest，记录来源游戏版本、期望实例数、哈希和允许公开范围。测试不得在失败输出中打印原始字节。

用户截图派生的目标编辑、保存/分享和求解共同夹具见 [截图基准测试方案](../testing/screenshot-reference-profile.md)。正式 JSON fixture 在 Catalog 稳定 ID 准入后生成，不能把待核验中文名直接当作 ID。

## 4. 契约测试

所有 `IInventorySource` 实现共享测试套件：

- 为每件实体生成唯一 instance ID。
- 保留主副顺序和三个等级字段。
- 未知技能产生诊断，不丢实例。
- 取消能在规定时间内结束。
- 输出不可变，重复调用不共享可变集合。

真实存档只读 PoC 另需覆盖正常/游戏备份/多槽、已装备、锁定、V+、单词条、角色专属、未知 hash、截断和读取中变化。每次测试记录源文件读取前后 SHA-256 相同，验证无 500 项截断，并追踪未知 raw hash 从 Worker 到 Renderer 的完整路径；这些用例通过前不能接入正式库存入口。

SQLite 仓储共享另一套契约：原子切换 current、旧快照可追溯、migration 幂等、取消不留下半事务。

## 5. 发布门槛

```powershell
dotnet build GBFRTool.slnx -c Release
dotnet run --project tests/GBFRTool.ArchitectureTests -c Release
dotnet run --project src/GBFRTool.SaveReader.Worker -c Release -- --self-test
```

加入正式测试框架后，再统一执行 `dotnet test`。Electron 侧执行 TypeScript 类型检查、单元/组件测试、安全测试和 Forge package smoke test。Windows CI 是正式安装包与 E2E 门槛；macOS CI/本机负责跨平台调试和可选产物，核心 .NET 测试在两端运行。
