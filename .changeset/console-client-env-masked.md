---
"@zhin.js/client": minor
---

`useEnvFiles` 适配打码后的 `env:get`（#1250）：新增 `getView(filename)`（返回 `ConsoleEnvFileView`，旧 Host 返回 `null`）、`reveal(filename, key)`（`env:reveal`，单变量原值，Host 侧校验 `ops.env.write` + `ops.env.read` 并审计）与按键保存 `saveChanges(filename, changes)`（`env:save { changes }`，提交前拒绝打码占位值）；`getFile` 保持可用，在打码 Host 上返回打码后的文本；`saveFile` 改为显式整文件替换（`mode: 'replace'`），含打码占位时会被 Host 拒绝。`ConsoleTransport` 新增 `revealEnvValue` / `saveEnvChanges`，`getEnvFile` 的返回类型改为两种形状的联合。
