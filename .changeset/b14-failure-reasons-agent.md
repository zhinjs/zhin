---
"@zhin.js/agent": minor
---

失败原因看得见（#1270 第 14 批）：账号准备失败与模型调用失败通过新的 `failureJournal` 端口（`InferenceFailureJournal`）写入实例的运行时失败记录，重启后在凭据版本一致时恢复显示（`preparationFailure.restored`）；新增纯函数 `subAgentPurposeEffect()` / `purposeKeyEffects()` 与 `inferencePurposeEffects()`，管理视图新增 `purposeEffects`（`agents.<key>` 是否生效及原因 `binding-name` / `ambiguous` / `no-target`），目标列表新增 `subAgents`（`readAgentPurposeTargets()`）；`HostInference` 新增 `accountAttention()` 与 `purposeEffects()`。
