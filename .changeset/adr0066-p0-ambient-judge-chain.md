---
"@zhin.js/ai": minor
"@zhin.js/agent": minor
"@zhin.js/service-typesafe": patch
"zhin.js": patch
---

插话判断改由一条判断器链负责切换备用模型（ADR 0066 P0，配置与行为不变）。

- `@zhin.js/agent` 新增 `EngagementJudgeChain`：一次判断是一次操作，链成员（每个只是一个模型，语言模型或决策模型）按顺序尝试，共用整次判断的 15 秒预算；预算用完或调用方取消时立即停止。选型时跳过模型跳过表里的成员（不计失败），全部在跳过期时记 `judge_failed`（`all_unavailable`）。失败按 ADR 0066 D2 的表切换：配额用完、欠费、凭据被拒换下一个并写全局跳过表；超时、网络错误、5xx 只在本次判断内换，2 分钟内至少 2 次不同判断都这样放弃同一模型才全局跳过 5 分钟（超时与网络 / 5xx 分开计数）；回答无效换下一个但不写跳过表；单纯 403、限流、内容拦截、上下文超长不换。每次切换写 `ambient_judge_fallback` 日志并进入 `recentFallbacks`（`purpose: 'ambient'`）。新增 `createEngagementJudgeMember()`（按 Profile 的模型类型构造语言或决策判断器）、`engagementJudgeFailureAction()`、`engagementJudgeKindOf()`；`FallbackEngagementJudge` 标为废弃并改为链的薄包装。
- 判断结果的 `source` 改为结构化的 `{ kind, profile, model, fallbackFrom? }`（与第 47 批的 `ref` 相同，`ref` 保留到废弃期结束），显示字符串移到 `sourceLabel`；审计 payload 的 `judge*` 键名不变，改从结构化 `source` 填写。整条链失败时，`judge_failed` 的 `failure.attempts`、`ambient_silent` 结局的 `detail` 和审计的 `judgeAttempts` 列出每个成员的失败类别。语言模型成员不再套用途备用层（`resolvePurposeExecution`），只有判断器链这一层切换；链里每个成员各算一次调用（`[ai.usage] judge`）。
- `@zhin.js/ai`：`ProviderErrorKind` 新增 `invalid_response`（驱动以 `code: 'invalid-response'` 报告无法使用的回答），`ModelFallbackReason` 新增 `invalid_response`，`ModelFallbackEvent.purpose` 可为 `ambient`；新增导出 `classifyFallbackFailure()`。
- `@zhin.js/service-typesafe`：请求失败保留 HTTP 状态、`Retry-After` 与响应体的错误码（不含正文），连接失败标为网络错误，SDK 超时标为 `timeout`，`classifyProviderError` 可以据此分类。
