# @zhin.js/command

## 1.1.10

### Patch Changes

- Updated dependencies [6da2bad]
  - @zhin.js/plugin-runtime@1.1.16
  - @zhin.js/feature-kit@1.1.8
  - @zhin.js/permission@1.1.8

## 1.1.9

### Patch Changes

- 8302701: Explain the parameter directory rule when a command path is invalid. Nested parameter directories such as `commands/term/[word]/[...definition]/index.ts`, or a static directory after a parameter directory, now fail with a message that states the rule (one parameter directory per command, and it must be the last directory), names the file and shows the corrected path and `params` declaration. A directory parameter that is not the first `params` entry now gets the reordered list in the error.
- 9943df6: Type the plugin config in convention commands and tools without losing inference (#857). `defineCommand.withConfig<Config>()({...})` fixes the config type and still infers `params`, `options` and the result; `defineAgentTool.withConfig<Config>()({...})` (or `defineAgentTool.withConfig<Config>()<Input>({...})` with a JSON Schema) does the same for tools. The returned definer can be shared across a plugin's files. The existing forms are unchanged: `defineCommand({...})`, `defineCommand<Config>({...})` (whose `params` still fall back to `Record<string, CommandParameterValue>`, because TypeScript has no partial type-argument inference) and `defineAgentTool<Input, Result, Config>({...})`. To get `params` inferred together with a typed config, change `defineCommand<Config>({` to `defineCommand.withConfig<Config>()({`.

  `zhin new` normal plugins now declare an `echoPrefix` option in `schema.json` and a matching `<Name>Config` type in `src/index.ts`, and use it in the echo command through `defineCommand.withConfig<<Name>Config>()`; the generated tests cover the typed config.

- de5b2a1: Plugin instances accept a framework-owned `disabledCommands` list (like `commandNamespace`). Listed commands, given by their local path without namespace or parameters (`fanyi`, `netease login`; a parent path covers its subcommands), are left out of routing, so an application can drop the few commands that overlap with another plugin instead of prefixing every command of the plugin.
- c5741c0: `runCommand(fake, definition, { source })`：传入命令的 `commands/.../index.ts`（路径或 `new URL(..., import.meta.url)`）时，先走运行时同一套约定路径校验（新导出的 `bindCommandSource`），`commands/term/[word]/[...definition]` 这类运行时会拒绝的布局在单测里也会报错；不传 `source` 行为不变。`zhin new` 生成的测试默认传 `source`。
- 584161e: 命令执行预算表满时，淘汰最旧的空闲（无运行中操作）条目，即使其冷却尚未结束，不再让所有新身份对带 `execution` 策略的命令一律得到 `capacity`；只有所有条目都在运行时才拒绝。
- 2a1a3d9: `CommandIndex.execute()` 不再因为没有入站来源而对声明了 `execution` 的命令一律返回 `operation_unavailable`：程序化调用按命令维度应用 `maxConcurrent` / `cooldownMs`（不做发送者预算，也不发送进度提示），并在执行结束时释放。权限 permit 检查仍保持 fail-closed，`dispatch` 行为不变。
- e40899f: Adapters now project group owners and admins onto the canonical `sender.roles` names `owner` / `admin` (Telegram creator/administrator, KOOK guild owner and admin-permission roles, Lark chat owner/managers, QQ official guild owner/admin identities). KOOK numeric role ids moved from `roles` to `permissions` (`role:<id>`). `@zhin.js/command` exports `canManageConversation` ("private chat or owner/admin/master"), now shared by the Bilibili and earthquake subscription commands; Roulette lets owners and admins toggle the mute penalty and cancel a game.
- Updated dependencies [d3563d9]
  - @zhin.js/feature-kit@1.1.7

## 1.1.8

### Patch Changes

- c407bd2: 安装 HTML 渲染能力时，内置指令菜单通过统一发送链生成菜单图；渲染失败或平台无法投递图片时保留原有文本菜单。菜单采用可自定义标题、配色与背景的三列主题，每页最多 30 项，支持根菜单与插件菜单翻页。平台同时支持原生 Markdown 与按钮时自动附加上一页、下一页控件，在边界禁用；其他平台保留文本导航。Telegram 禁用按钮映射为 Bot API 10.3 DisabledButton。补充中英文文档。
- 064b06d: 通过中立的 operation input 生命周期 hook 将真实入站运行代的退休信号传给 CommandContext.signal，使补问与确认能及时取消。
  保留旧 lease 普通操作和已开始发送的正常排空语义，不全局拦截回复。
- a50fc8a: 群欢迎可配置完整账号与会话的精确白名单，区分全部、空范围及具体会话，修正欢迎出站 requester 身份。新增只读命令权限说明与内置规则假设检查，共享真实准入的主体投影与匹配语义，不执行命令、动态默认值、平台或自定义权限检查；显式区分未知、未评估与条件匹配。
- b58548a: 为命令增加可选冷却、并发准入与一次进度提示，以真实发送者和完整会话身份隔离；Root 预算跨热更新共用，并在业务、渲染、中间件和已启动发送真正结束后释放。准入拒绝通过 limited 状态与有界原因进入消息诊断，避免回落到 AI。
- Updated dependencies [064b06d]
- Updated dependencies [a50fc8a]
- Updated dependencies [9816c18]
- Updated dependencies [064b06d]
- Updated dependencies [7edd04c]
  - @zhin.js/feature-kit@1.1.6
  - @zhin.js/permission@1.1.7
  - @zhin.js/plugin-runtime@1.1.15

## 1.1.7

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/feature-kit@1.1.5
  - @zhin.js/interaction@1.1.2
  - @zhin.js/permission@1.1.6
  - @zhin.js/plugin-runtime@1.1.14

## 1.1.6

### Patch Changes

- 386150d: Unify command parameters, options, validation and help; provide IM middleware defaults, exact persistent delivery targets and owner-scoped atomic state. Derive plugin configuration types, defaults, validation and Console metadata from one declaration, preserve plugin ownership and generation admission, and keep process database, scheduler and outbound resources private to the root. Reject inline configuration in isolated plugins inside their own realm; isolated configuration uses schema.json.

  Reject ambiguous optional/rest routes and undefined dynamic defaults, preserve optional parameter types and help handling, and validate Console edits with the Runtime configuration engine. Keep unrelated plugin entries cached during helper reloads, expose initial configuration metadata before login completes, and drain admitted Host operations while rejecting retired or failed-generation access.

  Keep schedule activation and hot reload atomic, preserving published jobs when a candidate fails; preserve immutable database query branches and path-only command parameters. Report background unhandled rejections for the Runtime Process Host, observe ICQQ heartbeat and reconnect login failures through the SDK reconnect policy, and normalize inline image data URLs before ICQQ file or base64 delivery.

- Updated dependencies [bf52b40]
- Updated dependencies [386150d]
- Updated dependencies [4778587]
- Updated dependencies [40537e3]
- Updated dependencies [681abf3]
  - @zhin.js/interaction@1.1.1
  - @zhin.js/permission@1.1.5
  - @zhin.js/plugin-runtime@1.1.13
  - @zhin.js/feature-kit@1.1.4

## 1.1.5

### Patch Changes

- badcc1f: Unify lazy JSX and HTML delivery across commands, inbound middleware and registered components. Remove the former JSX/template component runtimes, respect declared adapter HTML policies, and preserve author/generation ownership for automatic and explicit replies.

  Add the optional @zhin.js/components library with composable JSXRenderable display props, shared themes, symmetric spacing and local style/text overrides. Include tables, lists, Markdown with highlighted code blocks, and display-only checkbox, radio, switch and button states; provide a reusable preview gallery. Update scaffolds, examples and public authoring documentation together.

  Add optional official Tailwind static-utility compilation to inline styles. Consolidate raster rendering on @pixel.js/shotium, remove the Satori image toolkit, and align raster format contracts with actual PNG/JPEG/WebP results.

  Reject cascade-dependent Tailwind values including unset, track the installed Tailwind version in the bundled theme provenance, and preserve both repository and upstream MIT attribution. Keep optional gallery dependency failures visible and document asynchronous Tailwind initialization.

- Updated dependencies [badcc1f]
  - @zhin.js/feature-kit@1.1.3
  - @zhin.js/plugin-runtime@1.1.12
  - @zhin.js/permission@1.1.4

## 1.1.4

### Patch Changes

- b9b3953: Resolve command permissions and command/component contexts from the current operation snapshot when unchanged projections are reused after hot reload. Preserve old snapshots for draining operations.

## 1.1.3

### Patch Changes

- Updated dependencies [0de4836]
  - @zhin.js/permission@1.1.3

## 1.1.2

### Patch Changes

- Updated dependencies [36c2eb9]
  - @zhin.js/plugin-runtime@1.1.11
  - @zhin.js/feature-kit@1.1.2
  - @zhin.js/permission@1.1.2

## 1.1.1

### Patch Changes

- a9e4a40: Derive Command user routes only from explicit `commands/**/*/index.ts(x)` entry paths instead of prepending the plugin owner. Child plugins can now publish top-level static or dynamic commands, while duplicate routes across owners fail during generation construction. Adapter endpoint commands move to explicit paths such as `commands/qq/endpoint/list/index.ts` and are invoked as `qq endpoint list`.
- 8740059: Standardize TypeScript capabilities on named module directories such as `commands/foo/index.ts`, `middlewares/audit/index.ts`, `handlers/message-receive/index.ts`, `pages/workroom/index.tsx`, and `mcps/filesystem/index.ts`. Only the fixed `index` entry is discovered; sibling files remain private helpers.

  Command route segments come from directories, while `[name]`, `[[name]]`, `[...name]`, and `[[...name]]` directories declare dynamic parameters. Plugin owners do not enter the route unless their config explicitly sets `commandNamespace`; Endpoint `commandPrefix` remains platform-owned and defaults to an empty string.

  Migrate the built-in adapters, plugins, examples, generators, migration tooling, hot reload classification, Agent authoring surfaces, documentation, and release artifacts to the explicit entry convention.

  Make Tool ownership and progressive disclosure explicit across all four supported locations: plugin-public `tools/`, Agent-private `agents/<name>/tools/`, Skill-private `skills/<name>/tools/`, and Agent-Skill-private `agents/<name>/skills/<name>/tools/`. Move adapter and group-suite operations that require domain instructions into their owning Skills so `load_skill` is the only path that unlocks their schemas.

  Remove the package-root `agent/` convention. Public capabilities now use named package-root directories, schedules use `schedules/<name>/index.ts` or `plugin.ts` injection, MCP connections use `mcps/<name>/index.ts`, Prompt Sections use `prompt-sections/<name>/index.ts`, Agent definitions use `agents/<name>/`, and permission vocabulary is published as `PERMITS.md`.

- Updated dependencies [13f7301]
- Updated dependencies [ef92a6d]
- Updated dependencies [8740059]
- Updated dependencies [3d42fc9]
- Updated dependencies [b076eae]
- Updated dependencies [4380cf9]
- Updated dependencies [2dbbc15]
- Updated dependencies [31b42a8]
- Updated dependencies [65d0391]
- Updated dependencies [2fd8017]
- Updated dependencies [cf83528]
- Updated dependencies [df9f76b]
- Updated dependencies [0724ddd]
  - @zhin.js/plugin-runtime@1.1.10
  - @zhin.js/feature-kit@1.1.1
  - @zhin.js/permission@1.1.1

## 1.1.0

### Minor Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

### Patch Changes

- Updated dependencies [1fc6270]
  - @zhin.js/feature-kit@1.1.0
  - @zhin.js/interaction@1.1.0
  - @zhin.js/permission@1.1.0
  - @zhin.js/plugin-runtime@1.1.9

## 1.0.16

### Patch Changes

- 09b14d6: Publish clearer package and authoring API documentation for generated references and editor IntelliSense.
- 1fc78bc: Unify native platform Client access behind the literal `adapter` discriminant. Handlers infer both native events and Clients, while command, inbound/outbound middleware, and both Agent tool authoring surfaces expose the exact operation-scoped Client through a lazy `$client` getter. Definitions without `adapter` keep `$client` typed as `unknown`, and runtime dispatch rejects adapter mismatches before resolving the Client. Bundled platform tools now use this single path instead of model-provided endpoint ids and adapter-specific dependency wrappers. Every adapter registers one Client/EventMap contract, and protocol adapters including NapCat, Milky, OneBot and Satori now produce transport-independent Client objects rather than letting Endpoint instances impersonate Clients.
- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
- Updated dependencies [1fc78bc]
  - @zhin.js/plugin-runtime@1.1.8
  - @zhin.js/feature-kit@1.0.13
  - @zhin.js/permission@1.0.4

## 1.0.15

### Patch Changes

- 974772e: Replace the user-facing `Prompt` vocabulary with the `UserInteraction` authoring surface for input, confirmation, and selection. Commands and handlers now expose `interaction`; IM Runtime exposes `createInteraction`; schema-driven endpoint collection is named `SchemaInteraction`. The old prompt-named interaction types and properties are removed rather than aliased. User interactions render through one canonical Markdown and keyboard/list presentation module shared by commands and Agent `ask_user` turns.

  Extract the transport-neutral interaction contract into `@zhin.js/interaction`. A discriminated `ask()` API supports text, number, confirmation, single-select, multi-select, and typed lists with structured `title`, `description`, and `tip` content. Typed `sequence()` interactions return one result object keyed by step id, render progress, and retry invalid replies without leaking invalid values to callers.

  Preserve AI Markdown and card command actions through outbound publishing. QQ delivers Markdown with native command buttons; KOOK, Discord, Telegram, DingTalk, and Lark/Feishu now declare and encode their native Markdown dialects while retaining each adapter's interaction policy. Correct QQ callback button action encoding and button style mapping.

- Updated dependencies [67ef8c4]
- Updated dependencies [974772e]
  - @zhin.js/plugin-runtime@1.1.7
  - @zhin.js/interaction@1.0.1
  - @zhin.js/feature-kit@1.0.12
  - @zhin.js/permission@1.0.3

## 1.0.14

### Patch Changes

- Updated dependencies [d3920e9]
  - @zhin.js/feature-kit@1.0.11

## 1.0.13

### Patch Changes

- e4757a8: fix: bump
- c3c0ebf: fix: jiagouyouhau
- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/feature-kit@1.0.10

## 1.0.12

### Patch Changes

- Updated dependencies [63253bb]
  - @zhin.js/plugin-runtime@1.1.6
  - @zhin.js/feature-kit@1.0.9
  - @zhin.js/permission@1.0.2

## 1.0.11

### Patch Changes

- 7945544: fix(command): 修复 CommandSession.sender.role 缺失 master/trusted 及平台群角色

  `resolveRoles` / `resolveSender` 现在从 IM Message 的 `$sender` 读取 `isMaster`、`isTrusted` enrich 快照和平台 `role` 字段，
  而非仅依赖 duck typing 接口的 `sender` 和 `metadata`。

  fix(agent): 启动时自动清理旧版 agent_sessions 表的 NOT NULL IM 地址列

  旧版 `agent_sessions` 包含 `platform`、`endpoint_id`、`scene_id`、`scene_type`、`bot_id` 五个 NOT NULL 列（origin-neutral 重构前），
  新 model 不再包含这些列，但 `CREATE TABLE IF NOT EXISTS` 不修改已有表结构，导致 INSERT 因缺失 NOT NULL 值而失败。
  新增 `dropLegacyAgentSessionImColumns()` 在启动时检测并通过 `ALTER TABLE DROP COLUMN`（SQLite ≥ 3.35.0）自动移除。

## 1.0.10

### Patch Changes

- 2d0a622: feat(command): 支持 shortcut 和 params.default 的动态函数取值

  引入 `CommandDynamicValue` 统一类型，shortcut 预填值、`params.default`、`defaultValue` 均可接受 `(session: CommandSession) => value` 形式的函数，在分发时从运行时上下文（adapter、endpoint、scene、sender）动态解析。

  - 新增 `CommandDynamicValue` 类型和 `resolveDynamicParams()` 集中解析函数
  - 新增 `CommandSession` 和 `resolveCommandSession()` 用于从 Message 提取上下文
  - 帮助文本中函数值显示为 `<dynamic>` 而非函数源码
  - 三条分发路径（shortcut、normal、host/execute）统一调用 `resolveDynamicParams`

## 1.0.9

### Patch Changes

- ca92e03: feat(command): add alias/permit/shortcut fields and Unicode command names

  Commands can now declare alias (multi-word static segment replacements),
  permit (builtin DSL access control), and shortcut (global exact-match with
  prefilled params). Static command filenames support Unicode names
  (e.g. 赞我.ts) alongside ASCII kebab-case. Permit failures result in silent
  non-match for graceful degradation.

- Updated dependencies [c106ecc]
- Updated dependencies [daffd4c]
- Updated dependencies [e40b048]
  - @zhin.js/permission@1.0.1
  - @zhin.js/plugin-runtime@1.1.5
  - @zhin.js/feature-kit@1.0.8

## 1.0.8

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/feature-kit@1.0.7
  - @zhin.js/plugin-runtime@1.1.4

## 1.0.7

### Patch Changes

- afc0e66: feat!: IM 寻址全量统一为 ConversationRef（BREAKING，无兼容双轨）

  - `SendRequest` / `IncomingMessage` / `OutboundEnvelope` / `EndpointSendRequest` / `RuntimeMessageEvent` 全部收敛为 `conversation: ConversationRef` 单一寻址；`adapter` / `target` / `parent`（ChannelParent）/ `DeliveryMessageGateway` / `synthesizeConversation` / `parseLegacyConversationTarget`（core 侧）全部删除。
  - 20 个平台适配器入站直接构造 `ConversationRef`（endpoint/kind/id/parent，guild 容器与群临时会话归位）；`endpoint.send` 改读 `request.conversation`，legacy 字符串仅存在于平台 SDK 边界内部。
  - `Message` 类改为 conversation 原生（`adapter`/`target` 字段删除，`id` 为 `message?.id` getter）；owner 判定、interactive 频道键、CommandMessage 鸭式契约同步统一。
  - OutboundHost / sendEndpointMessage / console RPC / inbox / activity-feedback / 游戏插件全部 conversation 化；`MessageGateway.send` 返回 `DeliveryReceipt`。

  迁移：自定义适配器/插件的 `gateway.receive` 传 `{ conversation: { endpoint: { id, adapter }, kind, id }, content }`；发消息处 `conversation` 替代 `target`+`channelType`。

- 9f57124: feat!: 命令动态参数文件名改为 Next.js 风格（BREAKING）

  - 文件名不再携带类型：`[name:type=default].ts` → `[name].ts`（必需）/ `[[name]].ts`（可选）；类型与默认值统一在 `defineCommand({ params })` 中声明（`params.<name>.type` 必填，`default` 可选）。
  - 新增捕获所有段：`[...slug].ts` / `[[...slug]].ts`，运行时 `params.slug` 为数组；元素粒度随 `params.slug.type`——`text` 逐消息段，`word`/`string` 逐词切分，`number`/`integer`/`float`/`boolean` 逐词转换（任一词失败即不匹配），结构化类型逐消息段。
  - 旧格式文件名在发现期即抛 `CommandPathSyntaxError`；动态文件名缺少对应 `params` 声明、或必需文件名的 `params` 带 `default` 同样抛错。
  - `zhin new` 模板与 `zhin runtime migrate` 产物同步输出新格式；仓库内全部适配器 / 游戏 / 工具插件命令文件已迁移。

- Updated dependencies [afc0e66]
  - @zhin.js/plugin-runtime@1.1.3
  - @zhin.js/feature-kit@1.0.6

## 1.0.6

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/feature-kit@1.0.5

## 1.0.5

### Patch Changes

- 7c1e63a: feat(command)!: 命令名前缀分隔符由空格改为点号（BREAKING）

  非 root 插件命令的自动前缀从空格改为点号：`qq endpoint list` → `qq.endpoint list`，多级挂载 `b a foo` → `b.a.foo`；root 插件命令不变。点号前缀同时消除了旧规则下 root 目录段与子插件 owner 段的命名冲突（`child status` vs `child.status` 现在可共存）。配套的 endpoint 管理命令套件（`createEndpointCommands`）及 QQ/ICQQ 适配器的用户可见用法文案同步更新为新风格。迁移：用户与文档中所有 `<adapter> <command>` 形式的指令改为 `<adapter>.<command>`。

## 1.0.4

### Patch Changes

- d5cd4aa: Publish Plugin Runtime entry points and convention modules as JavaScript so
  installed npm plugins load on Node without TypeScript stripping. Workspace
  development continues to prefer TypeScript sources for local HMR.

  Remove the unconsumed legacy game hub APIs from game-kit; game navigation and
  records now use ordinary convention commands owned by the game hub plugin.

- Updated dependencies [d5cd4aa]
  - @zhin.js/feature-kit@1.0.4

## 1.0.3

### Patch Changes

- cdf64e7: 多方向审计修复批（8 面 30+ bug）：

  - **安全**：钉钉 webhook 验签绕过修复（缺 timestamp/sign 一律 403 + ±1h 防重放）；exec-policy fail-closed（换行/`$(`/反引号拒绝、管道逐段过白名单、env dump 复合拆段）；wecom 验签改 timingSafeEqual；config:set 拒绝 `__proto__` 等魔术键、host 键优先防覆写。
  - **P0 功能**：`zhin packages` scoped 包名解析为空导致 rm -rf 风险；命令数字参数解析失败炸断消息链路（dispatch 捕获 continue）；TaskQueue 监听器首个事件自摘除导致 assistant 队列挂死（+超时后完成不覆盖终态）；DatabaseHost 跨世代共享崩溃（define 幂等 + stop 改进程级）；rss 按不存在 id 列删除改业务键。
  - **Runtime/HMR**：native watcher 过滤忽略目录（lib/.zhin 不再触发重载风暴）；host 段配置 patch（http.port 等）存在 installResources 时全量重建；capability 目录非 entry 支持文件升级进程重启；documentTransaction 失败回滚。
  - **CLI 写侧**：config/setup 对 toml 静默假成功改统一 config-file（不支持格式报错）；doctor/onboard 默认配置改新形态 plugins 映射；schedule add 改 --prompt；migrate engines/中文模板误伤/覆盖前备份。
  - **适配器生命周期**：napcat/milky start 失败竞态与僵尸连接、心跳 close 清理、stop-during-connect settle；slack webhook 二次 writeHead + messageChannelMap LRU。
  - **Host/向导**：logs/stats 与 inbox 查询改 DB 侧 count/orderBy/limit 下推；save-yaml 写入前校验；zhipu/moonshot baseUrl 必填预填；.env 写入转义 + 幂等合并；setup 数据库密码不再明文落 config；60s fetch 超时与 JSON 守卫。

- 50497a5: CommandContext session fields are structured objects (scene/sender) and TInput is constrained to CommandMessage.
- fa66c4c: Add transactional setup-time Feature registration through `PluginSetupContext.addFeature`, with
  typed shortcuts for Adapter, Command, Component, Middleware, Agent, Skill, Tool, and MCP Features.
  Setup definitions now share provider validation, projections, conflicts, ownership, and generation
  lifecycle with convention-discovered capability files. Feature providers can declare their own
  shortcut through `authoring.setupMethod`.
- fa66c4c: Use `segment-matcher` as the CommandIndex engine, add typed canonical segment parameters and
  expose unmatched structured segments through CommandContext. Preserve structured command input
  while stripping adapter command prefixes in the Core message dispatcher.
- Updated dependencies [cdf64e7]
- Updated dependencies [078e3f7]
- Updated dependencies [fa66c4c]
  - @zhin.js/plugin-runtime@1.1.1
  - @zhin.js/feature-kit@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/feature-kit@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies [447f3e2]
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/feature-kit@1.0.1
