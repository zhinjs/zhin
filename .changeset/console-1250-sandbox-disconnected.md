---
"@zhin.js/pagemanager": patch
"zhin.js": patch
---

独立 Sandbox 页面（`/sandbox`）在 Console 初始化后不再「看起来能用、发了却没反应」（#1250）：

- 未连接时禁用输入框、发送按钮和快捷指令，并在输入框上方说明原因：需要有「操作账号」权限的 Console API 令牌（顶栏用户名 →「个人设置」`/account` 签发，粘贴到右上角后重连），初始化之前才可用 `.env` 的 `HTTP_TOKEN`，或者直接用 Console 的「会话 → 沙盒」。连接中途断开时单独提示；未连接时按回车不再清空输入、不再静默丢弃。
- 页面右上角的令牌框占位文字改为「Console API 令牌」，不再写 `HTTP_TOKEN（可选）`；`--standalone` 启动时打印的 Sandbox 提示同步改写。
- README 与快速开始文档（中英）第 2 / 3 步改为优先在 Console 的「会话 → 沙盒」里发 `/hello`，并说明独立页面在初始化后需要 API 令牌。
