# ADR-0004：求解结果必须可复现

- 状态：Accepted
- 日期：2026-07-22

## 背景

原需求要求业务键完全一致时随机排序。不可控随机会让用户无法找回方案，也无法复现缺陷。

## 决策

每次分析生成并持久化 run seed。最终 tie-break 使用 `runSeed + canonicalBuildSignature` 生成稳定键。结果记录 snapshot ID、request hash、比较器版本和 seed。

## 后果

- 用户可重放同一次分析。
- 自动测试能比较完整 Top-K 顺序。
- “重新随机”必须显式生成新 seed，而不是依赖线程调度或 CP-SAT 内部顺序。
