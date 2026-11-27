---
"@zhin.js/agent": patch
"@zhin.js/host-http": patch
---

**发送链与项目文件**：自改代码试运行拦下更多绕过发送链的写法；控制台文件管理可以打开 `BOT.md`（#1250）。

- 自改代码试运行（`self_change` 的静态检查）以前只拦 `bot.$sendMessage(`，这个接口早已不存在。现在与 `check:harness-paths` 共用同一组规则：直调任何 `$sendMessage()`、`endpoint` / `lease` / `transport` / `client` / `$client` / `bot` / `sdk` 上的发送方法（`send`、`sendMessage`、`sendGroupMsg`、`sendPhoto`、`postMessage` 等），或 `adapterIndex.send` / `sendTarget`，都会判为 `forbidden_import` 失败。`sendLike`、`sendPoke` 这类不发消息的平台动作不受影响。请改用 `message.$reply()` / `$sendTo()` 或出站端口 `outboundMessageToken`。
- 项目文件白名单加入根目录的 `BOT.md`：项目有非空 `BOT.md` 时它取代 `AGENTS.md` 作为机器人的指令文件，以前却无法在控制台文件管理里打开和编辑。`data/BOT.md` 等子目录里的同名文件仍不开放。
