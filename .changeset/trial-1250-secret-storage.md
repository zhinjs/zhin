---
"@zhin.js/gateway": patch
"@zhin.js/console-protocol": patch
"@zhin.js/host-http": patch
"@zhin.js/cli": patch
---

敏感配置不再以明文写进配置文件（#1250）：经 `config:patch-project` / `config:patch` / `config:set`（`zhin config set` 与 Console 保存共用的 Host 写入路径）写入 Schema 标为敏感的字段（`x-zhin-secret`、`writeOnly`、`format: password`、`x-zhin-config.secret`，以及 token / 密码类键名）时，值写入项目 `.env`，配置里保留或改为 `${VAR}` 引用：沿用该字段原来引用的变量名，原来不是引用时按路径生成规范名（`http.token` → `HTTP_TOKEN`，重名加 `_2`）；`.env.<环境>` 已定义该变量时写到那里；配置写入失败时 `.env` 恢复原样。保存结果新增 `envSecrets: [{ path, variable }]`（只有变量名，从不含值）；补丁请求新增可选 `secretStorage: 'env' | 'plain'`（`ConsoleConfigPatchRequest`），`zhin config set --plain` 以明文写入并打印警告。
