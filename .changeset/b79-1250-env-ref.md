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
"@zhin.js/plugin-code-runner": patch
"@zhin.js/plugin-calendar": patch
---

统一 `${VAR}` / `env://` 环境变量引用的识别（#1250 第 79 批）：所有识别、提取与「缺少环境变量」检查都改用 `@zhin.js/plugin-runtime` 里与展开器共用同一解析器的函数，规则与展开完全一致。

- `@zhin.js/plugin-runtime` 新增 `parseEnvironmentReference()`（整段引用，含 `:-` / `:=` 默认值）、`isWholeEnvironmentReference()`、`environmentReferencesIn()`（提取所有引用及是否带默认值）、`parseEnvUri()`（`env://NAME`）、`isEnvironmentVariableName()`、`findUnsetEnvironmentReferences()` 与 `createEnvironmentLookup()`。
- 「缺少环境变量」只有一个实现：实例启动警告与网关配置校验的 `missingEnv` 都调用 `findUnsetEnvironmentReferences()`；带默认值的引用（`${VAR:-…}` / `${VAR:=…}`，即使默认值为空）不再被报缺失。
- `@zhin.js/host-http` 删除导出 `ENVIRONMENT_REFERENCE_PATTERN`，改用 `isWholeEnvironmentReference()`。
- 密钥字段识别（`isConfigEnvironmentReference`）只把展开器会替换的引用或合法的 `env://NAME` 当作引用：`p${ss`、`${1KEY}`、`env://bad-name` 这类文字现在按字面值密钥处理（启动警告、`zhin doctor --fix`、Console 写入 `.env`）。
- 网关：密钥字段原本是 `${HTTP_TOKEN:-默认值}` 时，写入新值会原地更新该字段自己的变量（不再另起 `_2`），配置改为 `${HTTP_TOKEN}`；数据库初始化向导里整段带默认值的引用按引用保留，不再写入 `.env`。
- AI：`${VAR:-默认值}` 凭据表达式的默认值与展开一致，可以包含 `{`；旧配置迁移只把整段 `${VAR}` / `env://VAR` 转成 `env://` 账号来源（写错的 `${…` 仍然拦下，不当作字面密钥）。
- 适配器 Console：环境变量字段只在值为不带默认值的整段 `${VAR}` 时显示原文，带默认值时按密钥遮蔽（默认值可能就是密钥）。
- 适配器账号导入（`zhin.config.yml` → 持久化账号）：含 `${` 的值仍一律作为引用存入 `secretRefs`（与旧版一致，按密钥遮蔽、不进入保存的配置），即使它不是合法引用。启动时，旧版本已存储的不合法引用（如没有闭合的 `${QQ_SECRET`，或本身含 `${` 的真实令牌）按原文作为字面值使用，并记一条警告（只含账号 ID，不含值）提示改正后重新导入；过去这类值同样按原文生效，升级后账号照常启动。
- 网关 `.env` 视图：`isReference` 只标记不带默认值的整段 `${NAME}`（与协议说明一致）；Console 配置遮蔽只遮蔽解析器认可的引用，其他含 `${` 的文字在普通字段按原文显示，密钥字段仍遮蔽。
- 脚手架数据库校验、`@zhin.js/plugin-code-runner` 与 `@zhin.js/plugin-calendar` 的「未展开占位符」判断改用同一解析器（插件经 `zhin.js` 主入口拿到 `isWholeEnvironmentReference()`）：`${1KEY}` 这类文字现在按真实值处理，`${VAR:-}` 仍视为未配置。
- 实例：`readConfiguredEndpointKeys()` 新增可选的环境查找参数，实例传入自己的 EnvStore，未生效配置里的端点 ID 能读到 `.env` 里的变量（过去只读进程环境）；`resolveAiConfig()`、Speech 与协议 Host 的配置读取不再对已展开的配置做第二次只读进程环境的展开（过去会把 `.env` 值里的 `${…}` 文字再展开一次）；`http` 配置改为与网关 / CLI 相同，从未展开的配置文档只展开一次（过去 `${B:-${C}}` 在 `B` 未设置时会被二次展开成 `C` 的值）。实例内部删除了从未被读取的 `secureCredentialProvider` 选项。
