---
"@zhin.js/ai": patch
"@zhin.js/agent": minor
"zhin.js": patch
---

AI 订阅账号接入（#1250）：Antigravity「完成准备」按官方开源客户端的方式向 `loadCodeAssist` 发送客户端 `metadata`，账号还没有 Code Assist 项目时用默认档位调用 `onboardUser` 开通并轮询长任务（有次数上限），失败时 `ProviderPreparationError` 带上游 HTTP 状态、原因码与步骤（不含响应正文与令牌）。账号没有默认档位时与官方客户端一致改用 `legacy-tier`；上游要求账号验证（`VALIDATION_REQUIRED`）时以原因 `validation-required` 结束、不尝试开通（不返回验证链接）；长任务名只接受单段 `operations/<id>`。整个准备过程有 90 秒总时限、每个上游请求有 15 秒时限，超时以原因 `preparation-timeout` / `request-timeout` 报告。准备失败不再被吞掉：日志写出代码与上游状态；`/login/complete` 仍返回 200，但账号状态视图新增 `preparationFailure`（`code` / `reason` / `upstreamStatus` / `step`，仅当前凭据修订、进程内保存），Console 无需再次调用准备即可显示原因。**客户端可见的变化**：准备失败原先一律是 503 `unavailable`，现在 `/login/prepare` 返回 424，`code` 固定为 `preparation-failed`，驱动给出的代码放在 `preparationCode`，另带 `reason` / `upstreamStatus` / `step`；机密 OAuth 客户端缺少 client secret 时 `/login/begin` 由 503 改为 428 `client-secret-required`；模型目录请求被限流（上游 429）时 `/discover` 由 503 改为 429 `discovery-rate-limited`，带 `upstreamStatus` 与解析后的 `retryAfterMs`（401/403 仍按拒绝处理）。驱动元数据新增 `requiresClientSecret` 与 `modelSuggestions`（仅为建议）；Codex 订阅支持「从服务读取模型」（Codex CLI 使用的 `/models` 目录），Claude 订阅给出带「suggestion」标记的模型 ID 建议。
