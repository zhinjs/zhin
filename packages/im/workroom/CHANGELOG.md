# @zhin.js/workroom

## 0.0.13

### Patch Changes

- Updated dependencies [c58c589]
  - @zhin.js/agent@1.1.44
  - @zhin.js/ai@1.1.48
  - @zhin.js/core@1.1.53
  - @zhin.js/im-contract@1.1.9
  - @zhin.js/tool@1.1.12

## 0.0.12

### Patch Changes

- Updated dependencies [e0f991c]
- Updated dependencies [8846d5d]
- Updated dependencies [8c85a2b]
- Updated dependencies [f67883e]
- Updated dependencies [2cc80df]
- Updated dependencies [97bf337]
- Updated dependencies [43560d0]
- Updated dependencies [1bf0253]
- Updated dependencies [ee9d38a]
- Updated dependencies [eb306e1]
- Updated dependencies [b76317d]
- Updated dependencies [c9775fb]
- Updated dependencies [5efb4e9]
- Updated dependencies [b5071e7]
- Updated dependencies [e23cabc]
- Updated dependencies [3c4178d]
- Updated dependencies [3fd758c]
- Updated dependencies [16896fe]
- Updated dependencies [825e4dc]
- Updated dependencies [f1eb75c]
- Updated dependencies [5621f75]
- Updated dependencies [88c82d0]
- Updated dependencies [e37f30f]
- Updated dependencies [2b8b408]
- Updated dependencies [4d728c0]
- Updated dependencies [eb8feeb]
- Updated dependencies [f0e1df7]
- Updated dependencies [7f34293]
- Updated dependencies [d9672ec]
- Updated dependencies [42e630d]
- Updated dependencies [1096173]
- Updated dependencies [24a2b71]
- Updated dependencies [119e9e6]
- Updated dependencies [8ce6cd2]
- Updated dependencies [f2bbab5]
- Updated dependencies [44eb3f8]
- Updated dependencies [ab2263a]
- Updated dependencies [dfa14b5]
- Updated dependencies [1bdbc08]
- Updated dependencies [df6442c]
- Updated dependencies [b223a51]
- Updated dependencies [d0e1fac]
- Updated dependencies [1ca669a]
- Updated dependencies [3771f7a]
- Updated dependencies [945303c]
- Updated dependencies [4f96ad5]
  - @zhin.js/agent@1.1.43
  - @zhin.js/core@1.1.52
  - @zhin.js/ai@1.1.47
  - @zhin.js/tool@1.1.11
  - @zhin.js/im-contract@1.1.8

## 0.0.11

### Patch Changes

- Updated dependencies [5be6f3a]
- Updated dependencies [334e92d]
- Updated dependencies [0bdd5df]
- Updated dependencies [08e64de]
- Updated dependencies [0fc0219]
- Updated dependencies [560c549]
- Updated dependencies [144a17b]
- Updated dependencies [291cf6e]
- Updated dependencies [ff87195]
- Updated dependencies [d6158d5]
- Updated dependencies [d507e5f]
- Updated dependencies [18296cf]
- Updated dependencies [cffaa8f]
- Updated dependencies [a3b636d]
- Updated dependencies [08e64de]
- Updated dependencies [9cade30]
- Updated dependencies [53bc6a0]
- Updated dependencies [7595136]
- Updated dependencies [e7b72a4]
- Updated dependencies [b8e594e]
- Updated dependencies [66b6404]
- Updated dependencies [adb4af2]
- Updated dependencies [dcd4982]
- Updated dependencies [69f9ef6]
- Updated dependencies [9dfdaf4]
- Updated dependencies [a5f0381]
- Updated dependencies [17d1301]
- Updated dependencies [f821029]
  - @zhin.js/agent@1.1.42
  - @zhin.js/plugin-runtime@1.1.17
  - @zhin.js/ai@1.1.46
  - @zhin.js/core@1.1.51
  - @zhin.js/tool@1.1.10
  - @zhin.js/skill@1.1.10
  - @zhin.js/im-contract@1.1.7

## 0.0.10

### Patch Changes

- Updated dependencies [0dd657d]
- Updated dependencies [5d099f5]
- Updated dependencies [f9ab410]
  - @zhin.js/agent@1.1.41
  - @zhin.js/ai@1.1.45
  - @zhin.js/core@1.1.50

## 0.0.9

### Patch Changes

- Updated dependencies [f98025b]
- Updated dependencies [9e21404]
- Updated dependencies [de39053]
- Updated dependencies [66ec1a5]
- Updated dependencies [7d68df6]
- Updated dependencies [250b026]
- Updated dependencies [bff8e31]
- Updated dependencies [bf0fa9f]
- Updated dependencies [9bc3285]
- Updated dependencies [3326db3]
- Updated dependencies [e91235e]
- Updated dependencies [6da2bad]
- Updated dependencies [3781f1c]
  - @zhin.js/agent@1.1.40
  - @zhin.js/ai@1.1.44
  - @zhin.js/core@1.1.50
  - @zhin.js/plugin-runtime@1.1.16
  - @zhin.js/im-contract@1.1.6
  - @zhin.js/tool@1.1.9
  - @zhin.js/skill@1.1.9

## 0.0.8

### Patch Changes

- Updated dependencies [974fa85]
- Updated dependencies [deeb964]
- Updated dependencies [1e9b3d6]
- Updated dependencies [d9cc732]
- Updated dependencies [d3fc1a6]
- Updated dependencies [070bb6b]
  - @zhin.js/ai@1.1.43
  - @zhin.js/core@1.1.49
  - @zhin.js/agent@1.1.39

## 0.0.7

### Patch Changes

- Updated dependencies [db06de8]
  - @zhin.js/core@1.1.48
  - @zhin.js/agent@1.1.38

## 0.0.6

### Patch Changes

- a383380: 修复 source map：这些包之前的 `.js.map` / `.d.ts.map` 指向没有发布的 `src/`，调试和"跳转到定义"都找不到源码。现在 `.js.map` 内联了源码（`inlineSources`），也不再生成指不到源码的 `.d.ts.map`。运行时行为不变。

  预告：下一个大版本会移除发布包里冗余的 `.ts` 源码（很多包里的 `src/**/*.ts`，以及插件约定目录里与 `index.js` 并排的 `index.ts`），本次不做改动。深导入 `.ts` 文件的代码请改用包的 `exports` 入口，详见根目录 `CHANGELOG.md`。

  Source maps now embed their sources (`inlineSources`); dangling `.d.ts.map` files are no longer emitted. Heads-up: redundant published `.ts` sources will be removed in the next major. Switch any deep `.ts` imports to the package's `exports` entry.

- Updated dependencies [6fdd30b]
- Updated dependencies [1a11207]
- Updated dependencies [9943df6]
- Updated dependencies [5be09ae]
- Updated dependencies [a3ab153]
- Updated dependencies [61cca0b]
- Updated dependencies [e8f7309]
- Updated dependencies [5afc18f]
- Updated dependencies [ade0f33]
- Updated dependencies [d3563d9]
- Updated dependencies [b15c86b]
- Updated dependencies [3224ba3]
- Updated dependencies [f91cc89]
- Updated dependencies [1148821]
- Updated dependencies [4dd081c]
- Updated dependencies [c618eb7]
- Updated dependencies [a383380]
- Updated dependencies [b3bbada]
- Updated dependencies [12d9a03]
- Updated dependencies [fbfefb7]
  - @zhin.js/agent@1.1.37
  - @zhin.js/tool@1.1.8
  - @zhin.js/core@1.1.47
  - @zhin.js/ai@1.1.42
  - @zhin.js/im-contract@1.1.5
  - @zhin.js/skill@1.1.8

## 0.0.5

### Patch Changes

- Updated dependencies [c407bd2]
- Updated dependencies [064b06d]
- Updated dependencies [b58548a]
- Updated dependencies [e914a93]
- Updated dependencies [e914a93]
- Updated dependencies [9816c18]
- Updated dependencies [064b06d]
- Updated dependencies [7edd04c]
- Updated dependencies [18de875]
  - @zhin.js/core@1.1.46
  - @zhin.js/plugin-runtime@1.1.15
  - @zhin.js/agent@1.1.36
  - @zhin.js/skill@1.1.7
  - @zhin.js/tool@1.1.7

## 0.0.4

### Patch Changes

- Updated dependencies [d033076]
  - @zhin.js/ai@1.1.41
  - @zhin.js/agent@1.1.35
  - @zhin.js/core@1.1.45

## 0.0.3

### Patch Changes

- Updated dependencies [dd7f25f]
  - @zhin.js/agent@1.1.34
  - @zhin.js/ai@1.1.40
  - @zhin.js/core@1.1.45

## 0.0.2

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [a64716a]
- Updated dependencies [75e26a6]
- Updated dependencies [75e26a6]
- Updated dependencies [cc9959e]
- Updated dependencies [fdc2148]
  - @zhin.js/agent@1.1.33
  - @zhin.js/ai@1.1.39
  - @zhin.js/core@1.1.44
  - @zhin.js/im-contract@1.1.4
  - @zhin.js/plugin-runtime@1.1.14
  - @zhin.js/skill@1.1.6
  - @zhin.js/tool@1.1.6

## 0.0.1

### Patch Changes

- 9891e66: 新增 Room / Member / Role 定义类型与 fail-closed 校验 `validateRoomDefinitions`（与旧 Workroom Catalog 并存，不改变旧行为）。

  会话归属以 adapter:kind:id 为键（不含 endpoint），成员 Bot 的 adapter 必须与 Room 会话一致，agent 名大小写不敏感唯一。

- 9891e66: Extract the Workroom, Portfolio and Data Governance domain code from `@zhin.js/agent` into the new `@zhin.js/workroom` package. Compatibility stubs at the old internal agent paths were removed in A4b (see `move-workroom-runtime`), together with the `./workroom/*.js`-style deep exports; `@zhin.js/workroom` exposes only its package root. Import from `@zhin.js/workroom`.
- 9891e66: 修正 `RoomTaskExecuteInput` 类型：对 `RoomTaskCommand` 联合类型做分配式 `Omit`，使 `execute()` 在 `tsc` 下可以传入各命令自己的字段（`result` / `to` / `title` 等），而不再退化为只含公共字段。仅类型修正，无运行期变更。
- 9891e66: Move the Workroom runtime composition (`workroom-runtime`) from `@zhin.js/agent` into `@zhin.js/workroom`; the dependency direction is now `@zhin.js/workroom` -> `@zhin.js/agent`.

  - Workroom exports were removed from `@zhin.js/agent`, `@zhin.js/agent/runtime` and `zhin.js/agent`; the `zhin.js/agent` re-export surface shrank, so users who imported Workroom exports through `zhin.js/agent` must import them from `@zhin.js/workroom` instead (the export names are unchanged). `@zhin.js/agent` no longer depends on `@zhin.js/workroom`.
  - The `Local*` assignment authority types declared by the authority provider module (`WorkroomLocalAssignmentAuthorityInput`, `WorkroomLocalAssignmentResolvedAuthority`, `WorkroomLocalAssignmentAuthorityPort`) clash with the domain contracts of the same name in a single barrel; the provider variants are exported with a `WorkroomProvider` prefix.
  - Compatibility stubs at the old internal agent paths and the `./workroom/*.js`, `./portfolio/*.js`, `./data-governance/*.js` deep exports of `@zhin.js/workroom` are removed. Use the package root.
  - `@zhin.js/agent` gains three narrow host-integration exports: `collectAgentLoopTurnRun` and type `ZhinAgentPrivate` (`@zhin.js/agent/core`; `ZhinAgentPrivate` is an internal host-integration type, not a stable API), and `runWithAgentTurnConfiguration` (`@zhin.js/agent/turn`).
  - `@zhin.js/cli` and `@zhin.js/a2a` declare `@zhin.js/workroom` as an optional/dev + peer dependency (like `@zhin.js/agent`), so installing the core no longer pulls in agent/workroom.

- 9891e66: 删除 legacy 迁移代码：移除 `zhin agent legacy-runs` / `legacy-payloads` 子命令，以及 `@zhin.js/workroom` 导出的 `scanLegacyEmbeddedPayloads`、`buildLegacyRunOfflineReport`、`createLegacyRunMigrationProposal` 及相关类型。旧格式 Journal 在读取和激活时仍然 fail-closed，报错信息改为说明旧格式不再受支持。

  Projector 遇到旧明文 Projection 快照时的报错同步改为‘不再受支持’，不再引导 offline export / purge；Journal legacy guard 恢复 recordRef 重复检查。

- 9891e66: createRoomRoleAssignAuthorizer now refuses assign for another room id when given a RoomEntry without roomId, and createRoomRoleAuthorizer refuses unknown command types (fail-closed).
- 9891e66: Workroom B4 fail-closed fixes.

  - `createRoomTaskAuthorizer` is now fail-closed for `assign`: every `assign` is refused unless an `authorizeAssign` role check (lead / coordinator) allows it, since `assign` skips the handoff depth and ping-pong limits. It is composable through `next` for the other commands (membership / `handoffTo` stay with C1). It only covers `cancel` and `assign`.
  - `guards.cancelRoom`: any human may still interrupt the running turn, but rejecting and clearing the queue requires an `authorizeSensitive('room.cancel_queue')` account (new `RoomSensitiveOperation`).
  - `checkHandoff` now requires `history`; a call without it is refused with `guard_error` and `escalateToHuman` instead of skipping the ping-pong check.
  - `admitTurn` is removed from the public `RoomGuards` interface; `runExclusive` is the only admission path (one slot per turn).
  - Send limiter: new `createRoomSendLimiter` returns one shared instance with a `send` form and an outbound `middleware` form (`RoomSendRateLimitedError` on refusal); `createRateLimitedOutbound` stays as a wrapper.
    **C1 must make every outbound of a member Endpoint (`$reply`, generation output and the Room Bus projection) share this one limiter instance**, as an outbound middleware or by wrapping the shared `OutboundMessageService`. Wrapping only the Room Bus outbound under-counts the account.

- 9891e66: Workroom B4 review follow-up.

  - `createRoomTaskAuthorizer`: `next` is required for C1 to enforce role checks on start / block / handoff (and `handoffTo`). The missing-`next` pass-through is no longer a tested contract.
  - New `limiter.outboundMiddleware()` returns an outbound middleware definition (`{ target: 'outbound', handle(ctx, next) }`, structural types, no new dependency); wrap it with `defineMiddleware(...)` in plugins. Manual adaptation: `handle: (ctx, next) => limiter.middleware(ctx.input, next)`. Never pass the context to `middleware` directly: it takes the envelope, and the limiter fails closed on every send otherwise.
  - One outbound path uses exactly one form (middleware, or `send` wrapping the OutboundMessageService); mixing them double-counts. Share the instance across different paths of the same account.
  - `createRateLimitedOutbound` is for tests / standalone use only.
  - `RoomCancelResult.queueRefused` plus a warn log when a human without `room.cancel_queue` cannot clear a non-empty queue.

- 9891e66: Harden the `@zhin.js/agent` -> `@zhin.js/workroom` boundary and tidy Workroom packaging (no runtime behavior change).

  - The architecture check now delegates the agent -> workroom source and manifest rules to pure functions (`scripts/lib/agent-workroom-boundary.mjs`) with unit tests covering bare/sub-path specifiers, barrels, type-only and dynamic imports, relative paths into Workroom directories, and all four manifest dependency sections.
  - CLI Workroom tests use the public `module.js` entry where it is reachable; the remaining internal-coordinator tests are kept (with a documented reason each) and guarded by an allowlist in `module-boundary.test.ts`. The a2a path now has tests for "package missing -> install hint with `cause`" and "other errors rethrown unchanged".
  - `@zhin.js/workroom` keeps `@zhin.js/agent` and `@zhin.js/plugin-runtime` as regular dependencies (single workspace instance; a peer-dependency move needs a lockfile update to be evaluated with the CLI peer graph).
  - The `@zhin.js/workroom` deep-path exports were fully removed in A4b; only the package root is exported.

- 9891e66: data-governance（payload vault、disclosure manifest/authority、payload lifecycle）与 `workroom-data-*`、`workroom-payload-*` 运行时装配导出从 `@zhin.js/workroom` 包根移到冻结的 `./data-governance` 子路径（C4c）。这是仅移出包根导出：默认 Workroom 装配（旧 Kernel 路径）仍然创建它们，行为不变，留到 C2 之后处理；新 Room 核心不依赖它们。`LegacyEmbeddedPayloadDetectedError` 与明文载荷拒绝（journal payload composition）仍在包根且行为不变。`@zhin.js/cli` 的导入方改为从子路径导入；没有新增可选加载器（`workroom/*` 目录外只有 type 导入）。
- 9891e66: Room Router 不再把只 @ 了非成员账号的消息交给 coordinator 或按 role 匹配：此时不产生目标（返回 undefined），成员副本保持原有的 mentioned 语义，退化为先到先得去重。
- 9891e66: remote dispatch / callback / assignment 导出从 `@zhin.js/workroom` 包根移到 `@zhin.js/workroom/remote` 子路径并冻结（A2A 扩展）。默认 Workroom 装配仍会创建 Remote Callback Runtime 与 Remote Assignment Authority（旧 Kernel/runtime 路径依赖），留到 C2 之后处理；仅 A2A callback/executor HTTP transport 接线在配置 `a2a.workroomCallbacks.enabled` 时懒加载该子路径。内核事件格式与历史事件校验（fail-closed）不变。
- 9891e66: 新增 `createRoomRoleAuthorizer` / `createRoomRoleAssignAuthorizer`（基于 RoomDefinition 的角色授权，fail-closed，可作为 `createRoomTaskAuthorizer` 的 `next` / `authorizeAssign`）与 `createRoomEventSequencer`（订阅者按 `event.sequence` 排序、去重的水位 helper）。
- 9891e66: 新增 Room 护栏组件：handoff 深度与 ping-pong 上限、每分钟 turn 上限、同 Room 串行与人类取消、敏感操作仅限配置的人类账号、每账号发送频率限制（装饰 `OutboundMessageService.send`，不绕过出站链）。当前未接入运行时，行为不变，由后续条目接线。
- 9891e66: Room Router 与 Room Bus（B2b）。`@zhin.js/core`：`RoomMembershipPort` 新增可选 `route(input)`，必须与 `hasRoom` 成对实现（同步、无副作用，按消息缓存决策，返回目标 Endpoint 与按优先级排序的 `fallbackEndpointIds`）；Room 会话中处理消息的目标 Endpoint 改由 Router 决定，目标副本强制 `mentioned=true`，其余副本只记录。core 无法预知哪个 Endpoint 会收到副本（例如隐私模式），目标没收到副本时，非目标成员副本在宽限期（默认 2s）后按 fallback 优先级接管，保证消息恰好处理一次、不静默丢失；`route` 抛错退化为先到先得。带 action 段的平台按钮回调只由接收它的 Endpoint 处理，绕过 Room 路由和去重；无消息 id / 无发送者 / 私聊（unkeyed）保持逐 Endpoint 处理；待回答探测仅在本条消息能解析到该 Endpoint 的按钮或有该发送者的待回答 claim 时为 true。没有 `route` 时保持 B2 的先到先得去重。`ImRuntimeOptions` 新增 `inboundClaimPending`。`@zhin.js/workroom`：新增 Room Registry、Room Router（待回答 > @ > 回复 > coordinator > 按角色匹配，@alias 使用 Unicode 边界）、`createRoomMembershipPort`、Room Bus（handoff 事件 + 经正常发送链的群内可见投影）。

  `hasRoom` 按“会话 + 接收 Endpoint”判定，只对成员 Endpoint 的副本为 true，非成员 Bot 按普通群处理（不 claim、不强制 mentioned）；decision 之外已投递副本的成员作为最低优先级接管候选（带 `room_unlisted_member_takeover` 告警），不再静默丢弃。

- 9891e66: 新增 Room Task 事件溯源状态机（`created → assigned → in_progress → done / blocked / cancelled`，外加 `handoff`）、内存与 `@zhin.js/database` 两种 journal，以及串行化的命令服务 `createRoomTaskService`。

  与旧 Workroom 并存，尚未接入运行时；表 `room_task_events` 尚未自动注册（`defineRoomTaskDatabaseModel` 由 C1 接线）。

- 9891e66: scheduler / preemption / priority authority 与 portfolio（journal、admission、capacity control outbox、sponsor、runtime 装配）导出从 `@zhin.js/workroom` 包根移到 `./scheduler`、`./portfolio` 子路径并冻结（C4b）。这是仅移出包根导出：默认 Workroom 装配（旧 Kernel 路径）仍然创建它们，行为不变，留到 C2 之后处理；新 Room 核心不依赖它们。`@zhin.js/cli` 的导入方改为从子路径导入，并新增 `loadWorkroomSchedulerPackage`。
- 9891e66: Room Task: subscribers are dispatched after the Room serial section so re-entrant `execute` no longer deadlocks; the DB journal validates `expectedSequence` for empty batches (matching the memory journal); assigning a Task to its current assignee is rejected.
- Updated dependencies [9891e66]
- Updated dependencies [c829031]
- Updated dependencies [0c17e0b]
- Updated dependencies [bf52b40]
- Updated dependencies [1f24fbf]
- Updated dependencies [55811d1]
- Updated dependencies [9b8b586]
- Updated dependencies [a6ea7b4]
- Updated dependencies [9486586]
- Updated dependencies [2b5e5ae]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [fc75499]
- Updated dependencies [bf52b40]
- Updated dependencies [2a9d08b]
- Updated dependencies [e4fbfb2]
- Updated dependencies [4ce55db]
- Updated dependencies [ba56e74]
- Updated dependencies [56bafda]
- Updated dependencies [7d2263c]
- Updated dependencies [1ea299a]
- Updated dependencies [27da0e8]
- Updated dependencies [7d2263c]
- Updated dependencies [dbc1456]
- Updated dependencies [d91d21a]
- Updated dependencies [a62acca]
- Updated dependencies [9ab9ffb]
- Updated dependencies [1280631]
- Updated dependencies [bd78a94]
- Updated dependencies [acfaaef]
- Updated dependencies [57ea5f7]
- Updated dependencies [6e035e5]
- Updated dependencies [57ea5f7]
- Updated dependencies [55db42d]
- Updated dependencies [f48ba72]
- Updated dependencies [386150d]
- Updated dependencies [417ec5b]
- Updated dependencies [7f0f8ca]
- Updated dependencies [3237f63]
- Updated dependencies [d38d38c]
- Updated dependencies [8e26cf1]
- Updated dependencies [9891e66]
- Updated dependencies [f768296]
- Updated dependencies [9891e66]
- Updated dependencies [9891e66]
- Updated dependencies [bc09928]
- Updated dependencies [779750f]
- Updated dependencies [4778587]
- Updated dependencies [40537e3]
- Updated dependencies [681abf3]
- Updated dependencies [9891e66]
- Updated dependencies [b3fea8c]
- Updated dependencies [9891e66]
- Updated dependencies [9891e66]
  - @zhin.js/agent@1.1.32
  - @zhin.js/ai@1.1.38
  - @zhin.js/core@1.1.43
  - @zhin.js/plugin-runtime@1.1.13
  - @zhin.js/skill@1.1.5
  - @zhin.js/tool@1.1.5
