---
"@zhin.js/ai": minor
"@zhin.js/agent": minor
"@zhin.js/cli": minor
"@zhin.js/service-typesafe": patch
"@zhin.js/scaffold-wizard": patch
"zhin.js": patch
---

插话判断（ADR 0066）审查修复：yml 的「只观察」和门槛在所有路径上都不丢，回退能完整还原。

**BREAKING（已批准的 minor）与迁移路径**

- `EngagementJudgment.source` 由字符串改为对象 `{ kind, profile, model, fallbackFrom? }`：读显示文字改用 `sourceLabel`，判断模型类型改用 `source.kind`，按模型分组改用 `source.profile` / `source.model`。无法在不破坏类型的前提下同时保留字符串；`ref`（与 `source` 同一对象）和字符串 `fallbackFrom` 保留到废弃期结束。`EngagementJudgeCall` / `EngagementJudgeFailure` 的字符串 `source` 不变。
- `DecisionPurpose`、`InferencePurpose` 的 `decision:ambient`、`DecisionTask` / `DECISION_TASKS` 去掉 `ambient`：改用 `PurposePolicy.ambient`（插话判断）。存储里的旧 `decisions.ambient` 仍会读取并自动迁移。
- 联合类型新增成员：`PurposeIgnoredReason`（`ambient-not-configured` / `no-conversations` / `mode-off`）、`ProviderErrorKind` 与 `ModelFallbackReason`（`invalid_response`）。对这些类型做穷举（`switch`、`Record<…>`）的代码需要补上分支。

**行为变更**

- 判断结果没有 `gate`（自定义判断器）时，`AmbientEngagement` 回退读已废弃的 `ai.trigger.ambient.minConfidence` / `mode`，不会比以前多插话；直接构造 `DecisionEngagementJudge({ policy: { minConfidence } })` 时仍在判断器内按它把关（判断器链不设，门槛只判一次）。
- 迁移完成后再写 `ai.trigger.ambient.mode` / `minConfidence`（旧版 Console、手工编辑、导入的配置）会在下次加载时转到 `purposes.ambient`，记 info 日志 `ambient_trigger_write_converted`，不再静默失效。
- 空库首次启动从 `ai.plan.yml` seed 的 `purposes.ambient`，以及旧键仍生效时（未迁移、迁移失败、已回退）写入的 `purposes.ambient`，都会补上 yml 里仍生效的 `mode` / `minConfidence`；管理视图、`purposeEffects`、导出和插话状态按实际生效的值显示。
- 废弃期内的旧写法：`purposes.decisions.ambient` 的 `off` / `null` 撤销决策模型与原「仅评估」的对照模型，恢复原来的旁听语言模型；字符串写法 `purposes.ambient: <profile>` 只替换语言模型，保留 `mode`、`compare`、`minConfidence`。
- `zhin doctor`：只有运行中实例的迁移记录为 `migrated`、键已被迁移读入且值未再改动时，才提示 `ai.trigger.ambient.minConfidence` / `mode` 不再生效并允许 `--fix` 删除；实例未运行、未迁移、迁移失败或已回退时只给警告，拒绝 `--fix`。启动日志 `ambient_trigger_keys_retired` 只在已迁移时出现。
- `zhin ai purposes revert ambient-judge`：先经配置写锁把迁移读入、之后被删掉的 yml 旧键写回，写不回则不回退并给出手工步骤，回退被拒时撤销写回；旧形状已不成立时拒绝并给出路径。
- 迁移记录的 `noticedAt` 用 CAS 写入，与回退并发时回退优先。`FallbackEngagementJudge`（已废弃）恢复原有退避：成功清除退避，取消不记退避。插话状态的判断器链读请求所在 generation 的模型配置。判断器链和对照模型使用合并了 generation 停止信号的 `signal`。
- `@zhin.js/service-typesafe`：失败请求只保留 `Retry-After` 响应头。`@zhin.js/scaffold-wizard`：决策用途检查改为五个，`purposes.decisions.ambient` 提示已废弃。
