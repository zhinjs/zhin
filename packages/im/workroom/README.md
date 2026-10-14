# @zhin.js/workroom

Workroom, Portfolio and Data Governance for Zhin.js: the domain code plus the runtime composition that wires it to the Agent runtime.

- `src/workroom/` - Workroom kernel, journals, assignments, ingress, executors
- `src/portfolio/` - Portfolio admission, capacity control, sponsor projection
- `src/data-governance/` - payload vaults, disclosure manifests, governance authority
- `src/workroom-runtime/` - runtime composition (Plugin Runtime tokens, Agent Core adapter, providers)

## Dependency direction

`@zhin.js/workroom` -> `@zhin.js/agent` (+ `@zhin.js/plugin-runtime`, `@zhin.js/tool`, `@zhin.js/skill`, `@zhin.js/ai`, `@zhin.js/core`) -> `@zhin.js/im-contract`

**Exports**: only the package root (`@zhin.js/workroom`). The deep paths (`./workroom/*.js`, `./portfolio/*.js`, `./data-governance/*.js`) were removed in A4b; there is no transitional subpath export.

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
