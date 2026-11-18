---
"@zhin.js/agent": minor
"@zhin.js/cli": patch
"zhin.js": patch
---

Console 只显示真正生效的插话判断，`zhin doctor` 检查插话判断迁移与废弃配置项（ADR 0066 P3）。

- 管理视图（`GET {base}/agent/inference`）的 `purposeEffects` 新增 `ambient`：实际使用的判断器链（成员与模型类型，跟随聊天时标 `inheritedFrom: 'chat'`）、对照模型，以及插话根本不运行时的忽略原因 `ambient-not-configured`（配置里没有 `ai.trigger.ambient`）/ `no-conversations`（没有任何群开启、也没有功能开关打开）；新增 `decisions.<task>`，关闭的决策用途标 `mode-off`。`PurposeIgnoredReason` 新增这三个值（新增类型 `AgentPurposeIgnoredReason`、`AmbientDeploymentView`，导出 `ambientPurposeEffects()`）。
- Console 群聊插话状态的 `judges` 改为实际判断器链（决策模型判断时不再显示从未被调用的语言模型），新增结构化的 `judgeChain`（成员、类型、角色、是否在跳过期）和 `minConfidence`；`mode` 读 `purposes.ambient.mode`。`HostInference.ambientModels()` 返回 `AmbientJudgeStatusView`，新增导出 `ambientJudgeStatusView()`。
- `zhin doctor`：迁移结果只提示一次（`--verbose` 可再看），迁移失败报错并给出要修正的位置，`ai.trigger.ambient.minConfidence` / `mode` 给出警告并可用 `--fix` 删除（其他键和注释保留），`purposes.ambient.minConfidence < 0.5` 时提示它对决策模型不起作用。
- 文档：`docs/ai/index.md` 的「群聊旁听」改为「插话」，「判断模型」改写为「插话判断」（含切换表和置信度说明）；结构化决策改为五个用途；`provider-upgrade` 补废弃键；新增迁移说明 `docs/migrations/ambient-judge.md`（含英文版）。
