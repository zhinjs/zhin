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
- 复审修复：yml 里写回迁移时读入的原值（或已处理过的值）不再被当成新写入，`purposes.ambient` 不变、回退仍可成功；回退命令执行期间在迁移记录上标记 `revertPending`（CAS 写入，10 分钟后失效），期间暂停转换，结束时无论成败都清除。迁移前 seed 过的 `purposes.ambient` 回退时按 D5 表反向换成旧字段，门槛和模式写入 yml；旧版本表达不了的部分逐条列出，此时 CLI 不再提示「可以降级」并以非零状态退出。`zhin doctor` 比较 yml 值时两边都按运行时规则规范化，并按 `triggerSeen` 判断是否已处理。新增路由 `POST {base}/agent/inference/cli/purposes/revert-ambient-judge/pending`（本机 CLI）。
- 第三次复审修复：旧 Console 先关「只观察」再打开时，写回的原值按新写入转换，最终仍是 shadow（只有存储的插话判断该键仍是迁移写下的值时，原值才不算新写入；`zhin doctor` 同样判断）。回退顺序改为：取得 `revertPending` 标记 → 干跑（`dryRun`，返回 yml 应有的值和旧版本表达不了的项）→ 写 yml（与现有值不同时以当前实际运行的值为准覆盖，并列出覆盖项；写不了就不回退）→ 提交回退（被拒时撤销 yml 写入）→ 清除标记；取不到标记时中止。回退相关路由写审计。
- 第四次复审修复：回退时如果配置文件里有实例还没转换的旧键写入，拒绝回退（`pending-trigger-writes`，列出键），提示先重新加载实例，避免用迁移原值覆盖新写入；CLI 写入前再按同一规则检查一次文件。已从 yml 转换的门槛 / 模式不阻止回退，回退后按当前值运行。回退请求没有回应时先重读迁移状态再决定保留还是撤销 yml，读不到时不动 yml 并给出手工步骤；提交返回的 yml 与干跑不一致时撤销；撤销失败时列出原值和恢复步骤。回退进行中 `zhin doctor --fix` 不删旧键。

