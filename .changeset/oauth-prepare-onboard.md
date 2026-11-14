---
"@zhin.js/ai": patch
"@zhin.js/agent": minor
"zhin.js": patch
---

AI 订阅账号接入（#1250）：Antigravity「完成准备」按官方开源客户端的方式向 `loadCodeAssist` 发送客户端 `metadata`，账号还没有 Code Assist 项目时用默认档位调用 `onboardUser` 开通并轮询长任务（有次数上限），失败时 `ProviderPreparationError` 带上游 HTTP 状态、原因码与步骤（不含响应正文与令牌）。准备失败不再被吞掉：日志写出代码与上游状态，`/login/prepare` 返回 424 和具体 `code` / `reason` / `upstreamStatus`；机密 OAuth 客户端缺少 client secret 时 `/login/begin` 返回 428 `client-secret-required`。驱动元数据新增 `requiresClientSecret` 与 `modelSuggestions`（仅为建议）；Codex 订阅支持「从服务读取模型」（Codex CLI 使用的 `/models` 目录），Claude 订阅给出带「suggestion」标记的模型 ID 建议。
