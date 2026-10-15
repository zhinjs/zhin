# @zhin.js/workroom

Workroom, Portfolio and Data Governance for Zhin.js: the domain code plus the runtime composition that wires it to the Agent runtime.

- `src/workroom/` - Workroom kernel, journals, assignments, ingress, executors
- `src/portfolio/` - Portfolio admission, capacity control, sponsor projection (exported via the frozen `./portfolio` subpath, not the package root)
- `src/data-governance/` - payload vaults, disclosure manifests, governance authority (exported via the frozen `./data-governance` subpath, not the package root)
- `src/workroom-runtime/` - runtime composition (Plugin Runtime tokens, Agent Core adapter, providers)

## Dependency direction

`@zhin.js/workroom` -> `@zhin.js/agent` (+ `@zhin.js/plugin-runtime`, `@zhin.js/tool`, `@zhin.js/skill`, `@zhin.js/ai`, `@zhin.js/core`) -> `@zhin.js/im-contract`

**Exports**: the package root (`@zhin.js/workroom`) plus the frozen subpaths `./remote`, `./scheduler`, `./portfolio` and `./data-governance`. The deep paths (`./workroom/*.js`, `./portfolio/*.js`, `./data-governance/*.js`) were removed in A4b. These four subpaths are the only exceptions, reversing the A4b "no subpath" decision only to freeze moved-out modules. `./remote` freezes the remote dispatch / callback / assignment modules: it is an A2A extension, removed from the package root and frozen; the default assembly still creates one Remote Callback Runtime and Remote Assignment Authority (legacy Kernel/runtime dependency, C2 blocks), to be handled after C2. The root entry no longer exports those symbols; the CLI lazy-loads `./remote` for the A2A callback/executor transport only when `a2a.workroomCallbacks.enabled` is configured (the default assembly imports it statically and constructs three file repositories). They are not deleted because the Kernel, Scheduler, authority grants, data governance and acceptance still reference remote types; full removal is left to C5/C6 after C4b-C4d.

`./scheduler` (scheduler, preemption, priority authority, scheduler/portfolio route registry and runtime) and `./portfolio` (portfolio journal, admission, capacity control outbox, sponsor projection, resource bundle, portfolio control runtime) were moved out of the package root in C4b and frozen the same way. This only removes them from the root exports: the default (legacy Kernel) assembly in `@zhin.js/cli` still statically imports and creates these runtimes, so default behavior is unchanged and handling is deferred until after C2. The new Room core does not depend on them; new code must not either.

`./data-governance` (payload vault, disclosure manifest/authority, payload lifecycle repository, and the `workroom-data-*` / `workroom-payload-*` runtime composition) was moved out of the package root in C4c and frozen the same way. This only removes them from the root exports: the default (legacy Kernel) assembly in `@zhin.js/cli` still creates the data-governance runtime, so default behavior is unchanged and handling is deferred until after C2. The fail-closed `LegacyEmbeddedPayloadDetectedError` and the journal payload composition (plaintext payload rejection) stay on the root and are unchanged. There is no optional loader for it: outside `workroom/*` the CLI only uses `import type`. The new Room core does not depend on it; new code must not either.

包根之外新增 `./remote` 子路径：remote dispatch / callback / assignment 已冻结为 A2A 扩展并移出包根；默认装配仍会创建 Remote Callback Runtime 与 Remote Assignment Authority（旧 Kernel/runtime 路径依赖，C2 阻塞），留到 C2 之后处理。

**Dependencies**: `@zhin.js/agent` and `@zhin.js/plugin-runtime` stay ordinary `dependencies` on purpose. Moving them to `peerDependencies` needs a `pnpm-lock.yaml` update that cannot be produced/verified offline, and inside the workspace there is a single instance (`workspace:*`). Revisit together with the CLI optional-peer install graph.

`@zhin.js/agent` must never import `@zhin.js/workroom`. The domain directories (`workroom/`,
`portfolio/`, `data-governance/`) stay free of framework imports (only `@zhin.js/im-contract` and
Node built-ins); only `workroom-runtime/` may use `@zhin.js/agent`. Inside the package,
`data-governance/` must not import `workroom/` or `portfolio/`.

Import everything from the package root (`@zhin.js/workroom`).

## Journal / Projection Outbox

Workroom Journal 以 `src/workroom/journal/index.ts` 作为唯一领域入口。入口只公开 Journal
端口、错误、适配器和稳定的摘要函数；内部依赖保持单向：事件校验与受治理载荷引用位于
底层，存储事件编解码和控制投影建立在其上，载荷发布/回放复用控制投影，Memory、File、
Database 适配器只组合这些机制。新增存储实现应实现 `WorkroomJournal`，不应把数据库、
文件系统或载荷治理逻辑重新放进领域入口。

Workroom Projection Outbox 同样以 `src/workroom/projection-outbox/index.ts` 为唯一领域入口。
Binding 和持久 Item 必须显式携带 `audience` 与绑定代际 `cursorId`；运行时不会猜测旧
快照的默认 audience，也不会把旧 Run cursor 在线迁移到新绑定。Repository 只负责 CAS
状态，Tracer 只把权威事实投影为草稿，Governance 物化可披露内容，Delivery Worker
负责租约和外部投递，四者通过窄端口协作。

## Room 定义（新核心，B1a）

`src/room/` 提供新的 Room / Member / Role 纯定义层，与旧 Workroom Catalog 并存，不改变旧行为。该目录只依赖 TypeScript 标准库。

- `validateRoomDefinitions(raw, ctx?)`：fail-closed，任何问题抛 `RoomDefinitionError`（`issues` 汇总全部带路径的消息）；成功返回深冻结的拷贝，不修改入参。`raw == null` 视为无 Room（返回 `{}`）。
- `collectRoomDefinitionIssues(raw, ctx?)`：唯一规则来源，纯函数，不抛。
- 未知字段一律拒绝，避免拼写错误导致权限静默丢失。
- Room：`conversation`（group/channel 绑定）、`roles`、`members`、可选 `coordinator`。
- Role：`prompt`；`tools`（上限，省略=不额外授予）；`accepts`（省略=任意类别）；`handoffTo`（省略=不允许交接，不可指向自身）。
- Member：一个 Agent、一个 Role、独立的 `botEndpoint`（Room 内不得共用）、可选 `aliases`（Room 内唯一，大小写不敏感）。
- 会话以 `adapter:kind:id` 标识（不含 endpoint）：同一个群不能经不同 Bot 被两个 enabled Room 认领；disabled 的 Room 只做结构校验。每个成员的 `botEndpoint.adapter` 必须与 Room 会话的 adapter 一致；Room 内 agent 名（及别名）大小写不敏感唯一。公开常量（`ROOM_CONVERSATION_KINDS`、`ROOM_RESERVED_NAMES`）均已冻结。
