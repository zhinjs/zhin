---
"@zhin.js/agent": patch
"@zhin.js/host-http": patch
---

**发送链与项目文件**：自改代码试运行拦下更多绕过发送链的写法；控制台文件管理可以打开 `BOT.md`（#1250）。

- 自改代码试运行（`self_change` 的静态检查）以前只拦 `bot.$sendMessage(`，这个接口早已不存在。现在与 `check:harness-paths` 共用同一组规则：直调任何 `$sendMessage()`、`endpoint` / `lease` / `$client` / `bot` 上的发送方法（`send`、`sendMessage`、`sendGroupMsg`、`sendPhoto`、`postMessage` 等），`client` / `transport` / `sdk` 上的 IM 专用发送方法（`sendMessage`、`sendGroupMsg`、`sendPhoto`、`postMessage` 等），或 `adapterIndex.send` / `sendTarget`，都会判为 `forbidden_import` 失败；`endpoint!.send(`、`(endpoint as T).send(`、`endpoint?.send?.(`、`endpoint['send'](` 和跨行的链式调用同样算。`sendLike`、`sendPoke` 这类不发消息的平台动作，以及 `client.send(new PutObjectCommand())`、`transport.send(frame)` 这类 AWS SDK / WebSocket / MCP 调用不受影响。请改用 `message.$reply()` / `$sendTo()` 或出站端口 `outboundMessageToken`。
- 试运行的去注释改为识别字符串、模板字面量和正则的线性扫描：以前 `const u = 'a//'; await endpoint.send(req);` 或 `"/*" … "*/"` 会把后面的代码当注释藏掉，草稿因此判为通过。规则现在对去注释后的文本和原文各跑一遍，任一命中即失败，所以注释里写出禁止写法的草稿也会试跑失败。
- 试运行对已删除的 `zhin.js/node` 入口与 harness 脚本用同一个正则：反引号写法、子路径（`zhin.js/node/x`）、`require.resolve()` 和 `import.meta.resolve()` 都会被拦下。
- 项目文件白名单加入根目录的 `BOT.md`：项目有非空 `BOT.md` 时它取代 `AGENTS.md` 作为机器人的指令文件，以前却无法在控制台文件管理里打开和编辑。`data/BOT.md` 等子目录里的同名文件仍不开放。
