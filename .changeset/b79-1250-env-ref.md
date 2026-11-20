---
"@zhin.js/plugin-runtime": minor
"@zhin.js/host-http": minor
"@zhin.js/runtime": patch
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"@zhin.js/adapter": patch
"zhin.js": patch
"@zhin.js/gateway": patch
"@zhin.js/scaffold-wizard": patch
"@zhin.js/cli": patch
---

统一 `${VAR}` / `env://` 环境变量引用的识别（#1250 第 79 批）：所有识别、提取与「缺少环境变量」检查都改用 `@zhin.js/plugin-runtime` 里与展开器共用同一解析器的函数，规则与展开完全一致。

- `@zhin.js/plugin-runtime` 新增 `parseEnvironmentReference()`（整段引用，含 `:-` / `:=` 默认值）、`isWholeEnvironmentReference()`、`environmentReferencesIn()`（提取所有引用及是否带默认值）、`parseEnvUri()`（`env://NAME`）、`isEnvironmentVariableName()`、`findUnsetEnvironmentReferences()` 与 `createEnvironmentLookup()`。
- 「缺少环境变量」只有一个实现：实例启动警告与网关配置校验的 `missingEnv` 都调用 `findUnsetEnvironmentReferences()`；带默认值的引用（`${VAR:-…}` / `${VAR:=…}`，即使默认值为空）不再被报缺失。
- `@zhin.js/host-http` 删除导出 `ENVIRONMENT_REFERENCE_PATTERN`，改用 `isWholeEnvironmentReference()`。
- 密钥字段识别（`isConfigEnvironmentReference`）只把展开器会替换的引用或合法的 `env://NAME` 当作引用：`p${ss`、`${1KEY}`、`env://bad-name` 这类文字现在按字面值密钥处理（启动警告、`zhin doctor --fix`、Console 写入 `.env`）。
- 网关：密钥字段原本是 `${HTTP_TOKEN:-默认值}` 时，写入新值会原地更新该字段自己的变量（不再另起 `_2`），配置改为 `${HTTP_TOKEN}`；数据库初始化向导里整段带默认值的引用按引用保留，不再写入 `.env`。
- AI：`${VAR:-默认值}` 凭据表达式的默认值与展开一致，可以包含 `{`；旧配置迁移只把整段 `${VAR}` / `env://VAR` 转成 `env://` 账号来源（写错的 `${…` 仍然拦下，不当作字面密钥）；`env://` 名称统一允许小写（实例的 `secureCredentialProvider` 过去只认大写）。
- 适配器 Console：环境变量字段只在值为不带默认值的整段 `${VAR}` 时显示原文，带默认值时按密钥遮蔽（默认值可能就是密钥）。
- 实例：`readConfiguredEndpointKeys()` 新增可选的环境查找参数，实例传入自己的 EnvStore，未生效配置里的端点 ID 能读到 `.env` 里的变量（过去只读进程环境）；`resolveAiConfig()`、Speech 与协议 Host 的配置读取不再对已展开的配置做第二次只读进程环境的展开（过去会把 `.env` 值里的 `${…}` 文字再展开一次）。
