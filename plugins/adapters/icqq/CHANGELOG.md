# @zhin.js/adapter-icqq

## 1.1.17

### Patch Changes

- e23cabc: ADR 0041 slice B: the turn context now carries real scene facts. `EndpointManagement` gains `inspectGroupScene` (name, owner, admins, member count, global mute) and `inspectGroupMemberProfile` (role, card, title, mute expiry; one lookup), implemented by the ICQQ adapter from uncached group/member reads. The CLI resolves them per turn (bot role always fresh; group and sender facts reuse a 60 s, 256-entry in-memory cache scoped to the generation; failures omit fields) and the inbound actor now carries `groupNickname` / `groupTitle` / `mutedUntil` plus the platform role. The Session / Bot state blocks are replaced by one projected scene line `[scene_id:…;scene_type:…;scene_name:…;owner_id:…;admins:…;member_count:…;global_mute:…;assistant_role:…;]` (values escaped and clipped to 64 chars). No new on-disk state.
- 4d728c0: ADR 0043 §4 + §5 (H4) and the ADR 0041 actor-only amendment. Participant headers are no longer stored: user messages keep only `actor`, assistant messages keep `assistantActor` (plus the delivered `messageId`), and the header is rendered at the LLM boundary; legacy rows that still carry `name` are read as before. Headers now use session message aliases `id:m<n>` (an ordinal over the stored active path, so already-sent prefixes never change), `time:HH:mm` shown only when a minute has passed since the last shown time (the first message and the first message of a day also carry `date`), and `reply_to:m<n>` when the message replies to one inside the visible window. A reply to a message outside the window gets one `[quote id:…;user_id:…;time:…;] <first 120 chars>` line (media as placeholders, a forward expanded one level) so the model no longer needs `inspect_conversation_reference` for ordinary quotes; the quote is resolved by the ingress through the reference port (3 s timeout) and stored as structured `UserMessage.quote`. Tool arguments named `message_id` / `message_ids` / `*_message_id` / `reference` and `reply` segments accept the alias as well as the platform id; `inspect_conversation_reference` also accepts the quoted message id.
- 51f1328: 修复 icqq 群成员相关 Agent 工具：`group_member_info` 返回空对象（模型据此误判成员不在群里）、`group_invite` 永远判定"已在群里"、`set_mute` / `set_title` / `set_anonymous` 读旧缓存误判 Bot 不是管理员。统一改为实时查询群成员。
- d0e1fac: Keep stable prompt instructions ahead of turn-specific capabilities, project unchanged context without placeholder text, and retain scoped state snapshots with readable updates and compaction recovery. Preserve native conversation/tool chronology and separate participant identity from runtime guidance.

  Resolve the ICQQ bot account and current-group role before capability discovery, and support explicitly declared current-conversation bot-role requirements without changing existing requester permissions or approvals. Keep role lookup failures unknown and preserve execution-time platform checks.

- 3771f7a: 修复同一群先后两人入群时后一次入群被当重复事件丢掉：side event 去重键（core 与 icqq）加入成员与操作人。
- 4f96ad5: Fix member-join welcome display: icqq now sends the mention's display name as the `at` element text, the joining member's nickname from the notice is threaded into `target.name`, and icqq group messages populate `conversation.name` from `group_name` so `{group}` renders the group name instead of the group number.
- Updated dependencies [f67883e]
- Updated dependencies [e23cabc]
- Updated dependencies [4d728c0]
- Updated dependencies [eb8feeb]
- Updated dependencies [24a2b71]
- Updated dependencies [d0e1fac]
- Updated dependencies [3771f7a]
- Updated dependencies [4f96ad5]
  - @zhin.js/core@1.1.52
  - @zhin.js/adapter@1.1.24
  - @zhin.js/tool@1.1.11
  - @zhin.js/im-contract@1.1.8

## 1.1.16

### Patch Changes

- 334e92d: 公告：草稿 → 审批 → 发送（ADR 0037 第 1 期切片 B）。

  - 新表 `ai_announcements` 与 `AiAnnouncements`：状态只前进 `draft` → `pending` → `approved` → `sent`，旁路 `rejected` / `expired` / `failed`；`revision` 乐观并发；改正文回到 `draft` 并重算 `content_hash`；待审批默认 24 小时超时。
  - 新工具 `announcement_draft`（`risk: safe`）：模型只能建草稿，不能提交、审批或发送。
  - Console `plugin.root.announcements` / `announcement`（读）与 `announcement-create` / `-edit` / `-submit` / `-approve` / `-reject` / `-resend`（动作，暂用 `control:read` / `control:write`）。
  - 批准即发送：摘要复核 → 控制面 → 会话画像 → 硬闸以公告审批记录作批准（`ToolHardGate.checkPreApproved`，不弹第二张卡）→ `EndpointManagement.sendGroupNotice`（icqq / napcat）。被拦或失败置 `failed`，不自动重试；重发回到 `pending` 需再批一次；摘要不符拒绝（`announcement_hash_mismatch`）。
  - 审计追加 kind `announcement` 与码 `announcement_drafted` / `_submitted` / `_approved` / `_rejected` / `_expired` / `_sent` / `_send_failed` / `_resend` / `_hash_mismatch`。

- 08e64de: Expose current ICQQ conversation and bot-role inspection through a private Agent skill. Add conversation-scoped quote, merged-forward, own/member recall, and owner-approved leave-group tools with live platform checks and documented guild-channel limitations.

  Include real message IDs in the existing turn and conversation context so message operations can target actual messages without guessing.

- 53bc6a0: 适配器配置标签、端点命令和工具反馈支持中英文；复用当前操作语言，保持协议值、用户内容、身份、权限与发送链路不变。Sandbox 展示使用项目语言，QQ 绑定与交互状态保留完整会话身份。
- Updated dependencies [334e92d]
- Updated dependencies [18296cf]
- Updated dependencies [08e64de]
- Updated dependencies [9cade30]
- Updated dependencies [53bc6a0]
- Updated dependencies [7595136]
- Updated dependencies [66b6404]
- Updated dependencies [adb4af2]
- Updated dependencies [69f9ef6]
- Updated dependencies [17d1301]
  - @zhin.js/adapter@1.1.23
  - @zhin.js/core@1.1.51
  - @zhin.js/permission@1.1.9
  - @zhin.js/tool@1.1.10
  - @zhin.js/skill@1.1.10
  - @zhin.js/im-contract@1.1.7
  - @zhin.js/agent-feature@1.1.10
  - @zhin.js/feature-kit@1.1.9

## 1.1.15

### Patch Changes

- 7d68df6: 精简 Agent 内置固定提示词与消息说明，保留工具、审批和结构化回复能力。适配器 Skill 按会话场景拆分，群／频道管理仅向对应场景披露；提示段与模型消息段支持场景声明，沿用当前回合权限和 generation 投影。
- e91235e: Let the bot answer with a reaction, the way a person taps 👍 instead of typing. Adapters declare reactions with `segments.reaction` (values with meanings, optional scopes); the reply schema then has a `reaction` field limited to those values, the instruction says when a reaction alone is enough, and the reply port applies it to the message being answered before any words. icqq offers 21 QQ face reactions in groups.
- 3781f1c: 支持多模态感知备用模型和 ICQQ 原创表情识图；增强语音回复的使用指引与错误提示，让已启用的 TTS 回复无需逐次审批。ICQQ 踢人工具使用 human 策略，每次都要求独立人工审批，不能由自动审核或历史授权替代。

  内容审核支持按账号和群显式开启广告、辱骂审核：提醒、警告、10 分钟禁言，通知通过 @ 对应成员说明处理结果，30 分钟无新违规重置；提醒/警告是否撤回原消息由模型结合上下文决定。入群 10 分钟内的明确广告可直接踢出，执行前刷新权限和入群时间；审核、通知或平台操作结果不确定时不盲目重试。

  并发消息独立审核并按到达顺序保存上下文，仅处罚和通知使用成员预留；重复投递不覆盖正在等待的撤回决定。接受完整 JSON 代码块，记录无效审核结果。人工确认显示具体参数，并在等待确认时隔离参数，确保批准对象与执行对象一致。

- Updated dependencies [f98025b]
- Updated dependencies [66ec1a5]
- Updated dependencies [7d68df6]
- Updated dependencies [bf0fa9f]
- Updated dependencies [3326db3]
- Updated dependencies [e91235e]
- Updated dependencies [6da2bad]
- Updated dependencies [3781f1c]
  - @zhin.js/core@1.1.50
  - @zhin.js/adapter@1.1.22
  - @zhin.js/im-contract@1.1.6
  - @zhin.js/tool@1.1.9
  - @zhin.js/agent-feature@1.1.9
  - @zhin.js/feature-kit@1.1.8
  - @zhin.js/permission@1.1.8
  - @zhin.js/skill@1.1.9

## 1.1.14

### Patch Changes

- 860faa0: Group and private share cards are now confirmed with a real message id: ICQQ's share API returns none, so after an accepted share the adapter reads the conversation history for the bot's own newest card (once more after a short wait). When it cannot be found the delivery stays unconfirmed as before; no id is invented.
- Updated dependencies [974fa85]
- Updated dependencies [1e9b3d6]
  - @zhin.js/core@1.1.49

## 1.1.13

### Patch Changes

- Updated dependencies [db06de8]
  - @zhin.js/core@1.1.48

## 1.1.12

### Patch Changes

- a3ab153: Adapters can declare `segments.model` per segment type (extra optional string fields the model may fill, plus a prompt hint) that only that platform's Agent replies see. icqq now declares the segment types its encoder supports and a share extension, so the Agent can send music share cards from tool results.
- fe6555c: Messages mixing text with standalone ICQQ elements (share, file, voice, video, JSON card, forward) are now sent as ordered separate messages instead of failing with "must be sent as a standalone message". A failure after the first part is reported as `partial_delivery` with an unknown outcome so it is never resent.
- fbfefb7: Share segments accept `data.platform` (the song's music service: qq, netease, kugou, kuwo, migu). icqq maps it to the matching music app id when `config.appid` is absent and offers it to the Agent; adapters that cannot render share app metadata reject it like `audio` and `config`.
- Updated dependencies [1a11207]
- Updated dependencies [9943df6]
- Updated dependencies [5be09ae]
- Updated dependencies [a3ab153]
- Updated dependencies [e8f7309]
- Updated dependencies [5afc18f]
- Updated dependencies [d3563d9]
- Updated dependencies [c618eb7]
- Updated dependencies [fbfefb7]
  - @zhin.js/tool@1.1.8
  - @zhin.js/core@1.1.47
  - @zhin.js/adapter@1.1.21
  - @zhin.js/feature-kit@1.1.7
  - @zhin.js/im-contract@1.1.5
  - @zhin.js/agent-feature@1.1.8
  - @zhin.js/skill@1.1.8

## 1.1.11

### Patch Changes

- 9816c18: 将应用插件装配改为 configVersion: 2：主配置 plugins 映射实例名到包，disable_plugins 控制启停，业务配置使用顶层同名块。package.json 继续保留 features、entry、engine 等包契约，并支持静态 displayName/icon。

  这是配置格式的破坏性更新：旧配置不能继续运行，请先停止 Bot，运行 `zhin migrate instances` 预览，再使用 `--apply` 转换；提供备份与中断继续/回滚，无法无损转换的嵌套、optional 和别名碰撞需人工迁移。Runtime、Console、CLI 与创建向导统一使用新声明。

  保留框架顶层 `menuKeyword` / `menuStyle`，通过当前 generation 的 Root 配置视图供 Command Feature 消费；严格校验和配置修改不会丢失菜单设置，子实例配置保持隔离。

- Updated dependencies [c407bd2]
- Updated dependencies [064b06d]
- Updated dependencies [a50fc8a]
- Updated dependencies [b58548a]
- Updated dependencies [e914a93]
- Updated dependencies [e914a93]
- Updated dependencies [064b06d]
  - @zhin.js/core@1.1.46
  - @zhin.js/feature-kit@1.1.6
  - @zhin.js/permission@1.1.7
  - @zhin.js/adapter@1.1.20
  - @zhin.js/agent-feature@1.1.7
  - @zhin.js/skill@1.1.7
  - @zhin.js/tool@1.1.7

## 1.1.10

### Patch Changes

- Updated dependencies [dd7f25f]
  - @zhin.js/core@1.1.45

## 1.1.9

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/adapter@1.1.19
  - @zhin.js/agent-feature@1.1.6
  - @zhin.js/core@1.1.44
  - @zhin.js/feature-kit@1.1.5
  - @zhin.js/im-contract@1.1.4
  - @zhin.js/permission@1.1.6
  - @zhin.js/skill@1.1.6
  - @zhin.js/tool@1.1.6
  - @zhin.js/logger@1.1.2

## 1.1.8

### Patch Changes

- 9891e66: Endpoint 新增运行期 `selfUserId` 访问器与受保护的 `reportSelfUserId()`（`EndpointImplementation` 另可声明 `selfUserId`，`EndpointActivationContext` 提供 `reportSelfUserId`），并新增进程级 Peer Registry（`getProcessPeerRegistry()` / `createPeerRegistry()`）。账号仅在 generation active 后登记，回滚 / retire / stop 后移除；`EndpointIdentity` 保持不可变。ICQQ 在 `system.online` 上报 uin；OneBot11 ws/wss 从事件 `self_id` 与 `get_login_info` 上报；Sandbox 以配置的 bot id 作为合成账号。未上报的旧 Endpoint 不进入 Registry（fail closed），不会用配置 id 兜底。OneBot12 / napcat / milky 等其余适配器留待后续。

  Peer Registry 使用登记序号（新 generation 胜出），旧实例在新实例登记后再次上报不会覆盖新条目；空值或非字符串的读取查询返回未命中而不抛错；OneBot11 在 stop 时清空 `selfUserId`。

  登记序号在 Endpoint 激活时通过 `PeerRegistry.reserve()` 分配，新实例先上报、旧实例晚到的首次上报不会覆盖新条目。

- 386150d: Unify command parameters, options, validation and help; provide IM middleware defaults, exact persistent delivery targets and owner-scoped atomic state. Derive plugin configuration types, defaults, validation and Console metadata from one declaration, preserve plugin ownership and generation admission, and keep process database, scheduler and outbound resources private to the root. Reject inline configuration in isolated plugins inside their own realm; isolated configuration uses schema.json.

  Reject ambiguous optional/rest routes and undefined dynamic defaults, preserve optional parameter types and help handling, and validate Console edits with the Runtime configuration engine. Keep unrelated plugin entries cached during helper reloads, expose initial configuration metadata before login completes, and drain admitted Host operations while rejecting retired or failed-generation access.

  Keep schedule activation and hot reload atomic, preserving published jobs when a candidate fails; preserve immutable database query branches and path-only command parameters. Report background unhandled rejections for the Runtime Process Host, observe ICQQ heartbeat and reconnect login failures through the SDK reconnect policy, and normalize inline image data URLs before ICQQ file or base64 delivery.

- 4778587: 补齐 Console 安装配置闭环所需的精确配置路径、端点身份、平台就绪与验证计划失效语义，并保存历史消息的方向及实际投递诊断。

  修复真实 ICQQ 入站目标保存了插件 owner 而非平台标识、导致提醒投递被身份校验拒绝的问题；无关插件配置变更保留原有适配器连接。

  保证候选事件在当前代快照发布后准入，并避免安装过程中依赖文件变动提前中断插件管理操作。

  明确 Adapter/MCP 客户端创建仅提供所属 owner 的配置与资源，跨 Feature 查询由当前 operation 上下文负责；入站诊断记录接收时刻，避免慢指令的回复在历史中先于指令。

- Updated dependencies [9891e66]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [386150d]
- Updated dependencies [9891e66]
- Updated dependencies [9891e66]
- Updated dependencies [4778587]
- Updated dependencies [40537e3]
- Updated dependencies [681abf3]
- Updated dependencies [9891e66]
- Updated dependencies [9891e66]
  - @zhin.js/adapter@1.1.18
  - @zhin.js/core@1.1.43
  - @zhin.js/permission@1.1.5
  - @zhin.js/feature-kit@1.1.4
  - @zhin.js/agent-feature@1.1.5
  - @zhin.js/skill@1.1.5
  - @zhin.js/tool@1.1.5

## 1.1.7

### Patch Changes

- Updated dependencies [5ab6307]
  - @zhin.js/core@1.1.42

## 1.1.6

### Patch Changes

- badcc1f: Unify lazy JSX and HTML delivery across commands, inbound middleware and registered components. Remove the former JSX/template component runtimes, respect declared adapter HTML policies, and preserve author/generation ownership for automatic and explicit replies.

  Add the optional @zhin.js/components library with composable JSXRenderable display props, shared themes, symmetric spacing and local style/text overrides. Include tables, lists, Markdown with highlighted code blocks, and display-only checkbox, radio, switch and button states; provide a reusable preview gallery. Update scaffolds, examples and public authoring documentation together.

  Add optional official Tailwind static-utility compilation to inline styles. Consolidate raster rendering on @pixel.js/shotium, remove the Satori image toolkit, and align raster format contracts with actual PNG/JPEG/WebP results.

  Reject cascade-dependent Tailwind values including unset, track the installed Tailwind version in the bundled theme provenance, and preserve both repository and upstream MIT attribution. Keep optional gallery dependency failures visible and document asynchronous Tailwind initialization.

- Updated dependencies [badcc1f]
  - @zhin.js/core@1.1.41
  - @zhin.js/feature-kit@1.1.3
  - @zhin.js/adapter@1.1.17
  - @zhin.js/agent-feature@1.1.4
  - @zhin.js/skill@1.1.4
  - @zhin.js/tool@1.1.4
  - @zhin.js/permission@1.1.4

## 1.1.5

### Patch Changes

- b9b3953: Fix adapter connection races, transport health reporting, candidate rollback and delivery acknowledgement boundaries. Separate generation admission from locally observed connectivity, reject unconfirmed message receipts, and mark uncertain delivery results without recommending automatic replay.

  Class and compact endpoints should expose a `transportState` getter to report physical connection or local listener health. Unobserved endpoints now report an unknown transport and remain offline in diagnostics. Platform stability tiers remain unchanged until real account acceptance evidence is available.

- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
  - @zhin.js/adapter@1.1.16
  - @zhin.js/im-contract@1.1.3
  - @zhin.js/core@1.1.40
  - @zhin.js/tool@1.1.3
  - @zhin.js/skill@1.1.3
  - @zhin.js/agent-feature@1.1.3

## 1.1.4

### Patch Changes

- 43eda99: Unify Notice and Request payloads with their public types and runtime exports. Use camelCase fields, preserve native data under metadata, and bind canonical endpoint identity and request actions to the held generation. Remove legacy data aliases and from factories.

  Keep login and lifecycle signals as independent SystemEvent payloads on system.receive, without chat conversation fields or user interaction. Update built-in adapter projections and authoring guidance.

- Updated dependencies [43eda99]
- Updated dependencies [0de4836]
  - @zhin.js/core@1.1.39
  - @zhin.js/permission@1.1.3
  - @zhin.js/adapter@1.1.15

## 1.1.3

### Patch Changes

- 5b5d270: Complete the canonical share segment contract and preserve native ICQQ share delivery through Core and AI outbound pipelines.
- Updated dependencies [5b5d270]
- Updated dependencies [36c2eb9]
  - @zhin.js/im-contract@1.1.2
  - @zhin.js/core@1.1.38
  - @zhin.js/adapter@1.1.15
  - @zhin.js/agent-feature@1.1.2
  - @zhin.js/feature-kit@1.1.2
  - @zhin.js/permission@1.1.2
  - @zhin.js/skill@1.1.2
  - @zhin.js/tool@1.1.2

## 1.1.2

### Patch Changes

- 62dee52: Rename the Agent Tool policy field from `approval` to `requiresApproval`, so values such as `never` and `always` state when human approval is required. Remove the old field without a compatibility alias and migrate built-in, adapter, feature, and utility Tools to the canonical contract.
- a9e4a40: Derive Command user routes only from explicit `commands/**/*/index.ts(x)` entry paths instead of prepending the plugin owner. Child plugins can now publish top-level static or dynamic commands, while duplicate routes across owners fail during generation construction. Adapter endpoint commands move to explicit paths such as `commands/qq/endpoint/list/index.ts` and are invoked as `qq endpoint list`.
- 8740059: Standardize TypeScript capabilities on named module directories such as `commands/foo/index.ts`, `middlewares/audit/index.ts`, `handlers/message-receive/index.ts`, `pages/workroom/index.tsx`, and `mcps/filesystem/index.ts`. Only the fixed `index` entry is discovered; sibling files remain private helpers.

  Command route segments come from directories, while `[name]`, `[[name]]`, `[...name]`, and `[[...name]]` directories declare dynamic parameters. Plugin owners do not enter the route unless their config explicitly sets `commandNamespace`; Endpoint `commandPrefix` remains platform-owned and defaults to an empty string.

  Migrate the built-in adapters, plugins, examples, generators, migration tooling, hot reload classification, Agent authoring surfaces, documentation, and release artifacts to the explicit entry convention.

  Make Tool ownership and progressive disclosure explicit across all four supported locations: plugin-public `tools/`, Agent-private `agents/<name>/tools/`, Skill-private `skills/<name>/tools/`, and Agent-Skill-private `agents/<name>/skills/<name>/tools/`. Move adapter and group-suite operations that require domain instructions into their owning Skills so `load_skill` is the only path that unlocks their schemas.

  Remove the package-root `agent/` convention. Public capabilities now use named package-root directories, schedules use `schedules/<name>/index.ts` or `plugin.ts` injection, MCP connections use `mcps/<name>/index.ts`, Prompt Sections use `prompt-sections/<name>/index.ts`, Agent definitions use `agents/<name>/`, and permission vocabulary is published as `PERMITS.md`.

- eb3227a: Move Endpoint project-configuration persistence behind the root-owned `EndpointConfigurationStore` resource. The Adapter package now owns only command semantics and no longer imports Node filesystem, path, or YAML APIs; CLI owns canonical YAML and `.env` persistence, while QQ and ICQQ special binding flows use the same injected boundary. Remove the old direct persistence helpers and reject legacy `plugins` arrays instead of promoting them at runtime.
- ddbb92e: Isolate adapter Skills under platform-specific Agents and automatically select the matching platform Agent for IM ingress, preventing unrelated adapter Skills from entering another platform's prompt surface.
- 40d2c8f: Reduce the default Agent Tool surface by moving process diagnostics into a Skill and splitting broad platform Skills into focused task domains. Restore ICQQ friend and group directory tools with `on-risk` approval and explicit owner, administrator, master, or trusted access.
- 73a24b7: Reorganize the Adapter package into one-way authoring, Endpoint boundary, managed lifecycle, and Runtime projection modules without changing public imports. Extract ICQQ content resolution behind a focused module and document its source map.
- 4380cf9: Colocate adapter command definitions and Agent Skill handlers with their owning capabilities, and provide a shared validated platform permission constructor.
- 6dad65e: Require one canonical expanded ICQQ endpoint configuration. Remove nested endpoint and environment identity compatibility, replace the conflicting name-based public endpoint type with the actual direct-Client configuration contract, and delete the obsolete endpoint typing-indicator guide.
- 5c3858e: Make `@zhin.js/im-contract` the explicit zero-dependency owner of transport identities, canonical segments, media guards, conversation facts, stores, and delivery contracts. Platform adapters now read media contracts from that foundation instead of reaching through Core.
- 33ea736: Use `tools/<name>/index.ts` and `defineAgentTool` from `@zhin.js/tool` as the sole Agent Tool authoring model. Remove the duplicate `@zhin.js/tools` definition, context, bridge, export, and discovery path; migrate plugin manifests, examples, scaffolding, HMR, and prepack compilation to the generation-owned Tool Feature.
- df9f76b: Make Endpoint configuration persistence asynchronous and route it through the canonical transactional Root configuration port. Endpoint management now supports both YAML and JSON, materializes a missing Root config safely, serializes concurrent mutations, restores `.env` when the config commit fails, and restarts the development process after environment-file changes.
- Updated dependencies [c861789]
- Updated dependencies [1414ccb]
- Updated dependencies [743d470]
- Updated dependencies [62dee52]
- Updated dependencies [cd54131]
- Updated dependencies [a9e4a40]
- Updated dependencies [5855db7]
- Updated dependencies [ec921d2]
- Updated dependencies [8740059]
- Updated dependencies [63d1f7a]
- Updated dependencies [25a845a]
- Updated dependencies [9110ab8]
- Updated dependencies [eb3227a]
- Updated dependencies [b853dba]
- Updated dependencies [e561309]
- Updated dependencies [d4c6175]
- Updated dependencies [7a0e1ca]
- Updated dependencies [103b5d3]
- Updated dependencies [5a7a7f7]
- Updated dependencies [b076eae]
- Updated dependencies [535fed1]
- Updated dependencies [73a24b7]
- Updated dependencies [4380cf9]
- Updated dependencies [1cb1163]
- Updated dependencies [be3061e]
- Updated dependencies [75f8332]
- Updated dependencies [81935e2]
- Updated dependencies [f9ed01b]
- Updated dependencies [ac0ab50]
- Updated dependencies [5140ce1]
- Updated dependencies [522d75f]
- Updated dependencies [a7611b3]
- Updated dependencies [8823044]
- Updated dependencies [379439b]
- Updated dependencies [11c9352]
- Updated dependencies [135ac91]
- Updated dependencies [140cf0f]
- Updated dependencies [251e4d2]
- Updated dependencies [203ad34]
- Updated dependencies [e6c5113]
- Updated dependencies [e0f6478]
- Updated dependencies [698f16f]
- Updated dependencies [2fd8017]
- Updated dependencies [5c3858e]
- Updated dependencies [33ea736]
- Updated dependencies [df9f76b]
  - @zhin.js/core@1.1.37
  - @zhin.js/tool@1.1.1
  - @zhin.js/adapter@1.1.14
  - @zhin.js/feature-kit@1.1.1
  - @zhin.js/agent-feature@1.1.1
  - @zhin.js/skill@1.1.1
  - @zhin.js/logger@1.1.1
  - @zhin.js/im-contract@1.1.1
  - @zhin.js/permission@1.1.1

## 1.1.1

### Patch Changes

- f0f4573: Fix ICQQ share segments to use the native share protocol instead of sending them as JSON cards.
- 51df035: fix: 修复 icqq 点赞错误
- Updated dependencies [769e67f]
  - @zhin.js/adapter@1.1.13
  - @zhin.js/core@1.1.36

## 1.1.0

### Minor Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

### Patch Changes

- a34bf91: Publish internal peer dependencies as compatible caret ranges instead of exact versions, preventing compatible internal minor releases from forcing unrelated major bumps.
- Updated dependencies [1fc6270]
  - @zhin.js/adapter@1.1.12
  - @zhin.js/core@1.1.35
  - @zhin.js/feature-kit@1.1.0
  - @zhin.js/im-contract@1.1.0
  - @zhin.js/logger@1.1.0
  - @zhin.js/permission@1.1.0
  - @zhin.js/tool@1.1.0

## 10.0.1

### Patch Changes

- Updated dependencies [f7ee28d]
  - @zhin.js/adapter@1.2.2
  - @zhin.js/core@1.5.16
  - zhin.js@7.0.1
  - @zhin.js/agent@1.2.1

## 10.0.0

### Patch Changes

- Updated dependencies [12325e1]
- Updated dependencies [d19e976]
  - @zhin.js/agent@1.2.0
  - zhin.js@7.0.0

## 9.0.8

### Patch Changes

- Updated dependencies [a728a20]
  - @zhin.js/agent@1.1.22
  - zhin.js@6.0.15

## 9.0.7

### Patch Changes

- Updated dependencies [337fd05]
  - @zhin.js/agent@1.1.21
  - zhin.js@6.0.15

## 9.0.6

### Patch Changes

- Updated dependencies [882a08a]
  - @zhin.js/agent@1.1.20
  - zhin.js@6.0.15
  - @zhin.js/core@1.5.15

## 9.0.5

### Patch Changes

- Updated dependencies [d85eddd]
  - @zhin.js/agent@1.1.19
  - @zhin.js/core@1.5.15
  - zhin.js@6.0.15

## 9.0.4

### Patch Changes

- Updated dependencies [a5ee497]
- Updated dependencies [ba7e17a]
- Updated dependencies [7108d0b]
  - @zhin.js/agent@1.1.18
  - @zhin.js/core@1.5.15
  - zhin.js@6.0.15

## 9.0.3

### Patch Changes

- Updated dependencies [736fa04]
  - @zhin.js/agent@1.1.17
  - zhin.js@6.0.14

## 9.0.2

### Patch Changes

- 45d4f24: Fix direct ICQQ password configuration, keep Plugin-local JSON Schema references and UI annotations valid during runtime config composition, and make activity feedback rollback safe before generation activation.
  - zhin.js@6.0.14

## 9.0.1

### Patch Changes

- 54bfd6b: Introduce Prompt Sections as a generation-owned Plugin Runtime Feature. Projects can declare typed context under `agent/prompt-sections/`, select interactive or scheduled profiles and IM platforms, and govern presentation order separately from required/preferred/opportunistic budget retention. In-flight turns remain pinned to their original generation across hot reloads, required policy fails explicitly when it cannot fit, duplicate identities are rejected, and the previous mutable Agent-local discovery and platform contributor APIs are removed. ICQQ and GitHub platform guidance now use the same Feature instead of a module-global registry.

  Expose a content-free Prompt Section catalog through Console introspection, including owner, source, generation, profiles, and budget policy without disclosing prompt text. New AI projects mount the Feature automatically, and the full-bot example plus Chinese and English product documentation demonstrate the supported configuration.

- e9c6a73: Keep a replacement ICQQ connection alive when configuration hot reload retires the previous endpoint.
- 1fc78bc: Unify native platform Client access behind the literal `adapter` discriminant. Handlers infer both native events and Clients, while command, inbound/outbound middleware, and both Agent tool authoring surfaces expose the exact operation-scoped Client through a lazy `$client` getter. Definitions without `adapter` keep `$client` typed as `unknown`, and runtime dispatch rejects adapter mismatches before resolving the Client. Bundled platform tools now use this single path instead of model-provided endpoint ids and adapter-specific dependency wrappers. Every adapter registers one Client/EventMap contract, and protocol adapters including NapCat, Milky, OneBot and Satori now produce transport-independent Client objects rather than letting Endpoint instances impersonate Clients.
- Updated dependencies [e9c6a73]
- Updated dependencies [4e8117c]
- Updated dependencies [902fa35]
- Updated dependencies [54bfd6b]
- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
- Updated dependencies [1fc78bc]
  - @zhin.js/agent@1.1.16
  - @zhin.js/adapter@1.2.1
  - @zhin.js/prompt-section@0.0.1
  - @zhin.js/core@1.5.14
  - @zhin.js/command@1.0.16
  - @zhin.js/logger@1.0.77
  - @zhin.js/tool@1.0.13
  - zhin.js@6.0.14
  - @zhin.js/feature-kit@1.0.13
  - @zhin.js/permission@1.0.4

## 9.0.0

### Patch Changes

- Updated dependencies [f2c532f]
- Updated dependencies [3dbf990]
  - @zhin.js/adapter@1.2.0
  - @zhin.js/core@1.5.13
  - @zhin.js/agent@1.1.15
  - zhin.js@6.0.13

## 8.0.14

### Patch Changes

- 5969c5b: Remove legacy compound-string message targets and Endpoint control probing. Endpoint control and outbound Host operations now carry structured `MessageRef` identities. Endpoint send has one exact result contract (a platform message id), which IM Runtime projects into `DeliveryReceipt.message`; arbitrary result guessing is removed.
- 5969c5b: Drop ICQQ unified_inbox dual-write for request/notice; Console request.list prefers EndpointManagement.listRequests, and approval stays on $approve / management.
- 5969c5b: Wire ICQQ login challenges (QR / slider / SMS / auth) through LoginAssist so pending tasks survive Console refresh; add login.list/submit/cancel RPC and TTY stdin consumer.
- 7cd8b34: Send canonical outbound segments as native ICQQ `Sendable` elements instead of literal CQ-like text. Resolve inbound voice and video URLs while the endpoint client is active, preserve file metadata and opaque platform references, and reject unsupported mixed standalone media messages instead of silently dropping segments.
- 5969c5b: Add SideEventGateway so adapters forward notice/request/system into HandlerIndex. HandlerContext now exposes only generation-safe capabilities and prompt ports; live Endpoint escape hatches are removed.
- 2f786bd: Replace text-only IM context and metadata-based quote handling with canonical
  conversation events, scoped reference resolution, explicit Endpoint content
  ports, and typed multimedia outcomes. Conversation notices are projected as
  untrusted context data rather than model-authority system instructions.
  The process-global passive-group buffer is removed: prior inbound conversation messages
  are now consumed from the same event store and cursor, with the current Turn
  message excluded from its own context projection.
  The unused `ConversationMemory` topic-memory runtime, its timers, legacy tables,
  and topic-window configuration are removed; `ContextRepository` is the only
  Agent conversation-history authority.
- Updated dependencies [5969c5b]
- Updated dependencies [d336a3f]
- Updated dependencies [0c82a7e]
- Updated dependencies [b9217e4]
- Updated dependencies [5969c5b]
- Updated dependencies [5969c5b]
- Updated dependencies [974772e]
- Updated dependencies [5969c5b]
- Updated dependencies [5969c5b]
- Updated dependencies [2f786bd]
- Updated dependencies [63d89f9]
- Updated dependencies [71c7cdd]
- Updated dependencies [3cca0ea]
- Updated dependencies [1312ca0]
- Updated dependencies [985fa22]
- Updated dependencies [04b861d]
- Updated dependencies [a23d544]
- Updated dependencies [8cddabf]
- Updated dependencies [dbe5081]
  - @zhin.js/im-contract@1.0.4
  - @zhin.js/core@1.5.12
  - @zhin.js/adapter@1.1.11
  - @zhin.js/agent@1.1.14
  - @zhin.js/command@1.0.15
  - zhin.js@6.0.12
  - @zhin.js/permission@1.0.3
  - @zhin.js/tool@1.0.12

## 8.0.13

### Patch Changes

- @zhin.js/core@1.5.11
- @zhin.js/agent@1.1.13
- zhin.js@6.0.11

## 8.0.12

### Patch Changes

- 3556601: Declare Stable Feature packages referenced by `zhin.features` as optional `peerDependencies` on official plugins/adapters (`@zhin.js/runtime` ≥1.0.12 requires features to be declared in deps/peers). Keeps authoring via `zhin.js` facades without installing Feature implementation packages into `dependencies`, and removes the need for consumer postinstall peer-patch scripts. `zhin new` scaffolds the same peer shape.
  - @zhin.js/agent@1.1.12
  - @zhin.js/core@1.5.10
  - zhin.js@6.0.10

## 8.0.11

### Patch Changes

- eb84b77: fix: 更新文档,建立正确的依赖关系
- Updated dependencies [d3920e9]
  - @zhin.js/core@1.5.10
  - zhin.js@6.0.10
  - @zhin.js/adapter@1.1.10
  - @zhin.js/tool@1.0.11
  - @zhin.js/agent@1.1.11

## 8.0.10

### Patch Changes

- e4757a8: fix: bump
- c3c0ebf: fix: jiagouyouhau
- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/command@1.0.13
  - @zhin.js/agent@1.1.10
  - @zhin.js/core@1.5.9
  - @zhin.js/tool@1.0.10
  - @zhin.js/adapter@1.1.9
  - zhin.js@6.0.9

## 8.0.9

### Patch Changes

- Updated dependencies [63253bb]
- Updated dependencies [6fb24dd]
- Updated dependencies [d162216]
- Updated dependencies [7427818]
- Updated dependencies [90da255]
- Updated dependencies [8e973dc]
- Updated dependencies [953cfe1]
- Updated dependencies [0e73866]
  - @zhin.js/plugin-runtime@1.1.6
  - @zhin.js/core@1.5.8
  - @zhin.js/adapter@1.1.8
  - @zhin.js/agent@1.1.9
  - zhin.js@6.0.8
  - @zhin.js/command@1.0.12

## 8.0.8

### Patch Changes

- Updated dependencies [36cb1ca]
  - @zhin.js/core@1.5.7
  - @zhin.js/agent@1.1.8
  - zhin.js@6.0.7

## 8.0.7

### Patch Changes

- Updated dependencies [7945544]
  - @zhin.js/command@1.0.11
  - @zhin.js/agent@1.1.7
  - @zhin.js/adapter@1.1.7
  - @zhin.js/core@1.5.6
  - zhin.js@6.0.6

## 8.0.6

### Patch Changes

- Updated dependencies [2d0a622]
  - @zhin.js/command@1.0.10
  - @zhin.js/adapter@1.1.7
  - @zhin.js/core@1.5.5
  - @zhin.js/agent@1.1.6
  - zhin.js@6.0.5

## 8.0.5

### Patch Changes

- 36c7400: Replace `AgentPromptBuildContext.commMessage` with an authenticated platform projection and make Agent prompt assembly consume canonical Turn identity. Platform contributors and prompt hooks no longer receive a classic IM `Message`.

  Remove the unused Message field and active-context escape hatch from PromptController; turn scheduling is keyed only by canonical session identity.

- Updated dependencies [6f9c366]
- Updated dependencies [373a56b]
- Updated dependencies [0de46a8]
- Updated dependencies [c106ecc]
- Updated dependencies [ca92e03]
- Updated dependencies [b0f37ae]
- Updated dependencies [ba08a2f]
- Updated dependencies [b08f7fe]
- Updated dependencies [daffd4c]
- Updated dependencies [36c7400]
- Updated dependencies [a9fa72e]
- Updated dependencies [c8de3ef]
- Updated dependencies [60f0fc8]
- Updated dependencies [574c990]
- Updated dependencies [d096f16]
- Updated dependencies [3f29623]
- Updated dependencies [2916852]
- Updated dependencies [d047869]
- Updated dependencies [162fa34]
- Updated dependencies [e62561e]
- Updated dependencies [3eeeb46]
- Updated dependencies [85d0f82]
- Updated dependencies [61bfc1c]
- Updated dependencies [04bad47]
- Updated dependencies [e40b048]
- Updated dependencies [5a5b1bb]
- Updated dependencies [f1708c3]
- Updated dependencies [d254a81]
- Updated dependencies [7123c47]
- Updated dependencies [05befc1]
- Updated dependencies [0663b6a]
- Updated dependencies [f28f9b3]
- Updated dependencies [9f340f7]
- Updated dependencies [e53444f]
- Updated dependencies [5eedd26]
- Updated dependencies [92b0dd7]
- Updated dependencies [f919b6f]
- Updated dependencies [098e411]
- Updated dependencies [e1b7c01]
- Updated dependencies [9b94f87]
- Updated dependencies [a7df753]
  - @zhin.js/agent@1.1.5
  - @zhin.js/im-contract@1.0.3
  - @zhin.js/adapter@1.1.7
  - @zhin.js/plugin-runtime@1.1.5
  - @zhin.js/command@1.0.9
  - @zhin.js/core@1.5.4
  - zhin.js@6.0.4

## 8.0.4

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/logger@1.0.76
  - @zhin.js/adapter@1.1.6
  - @zhin.js/agent@1.1.4
  - @zhin.js/command@1.0.8
  - @zhin.js/core@1.5.3
  - @zhin.js/im-contract@1.0.2
  - @zhin.js/plugin-runtime@1.1.4
  - zhin.js@6.0.3

## 8.0.3

### Patch Changes

- Updated dependencies [afc0e66]
- Updated dependencies [2e41ad5]
- Updated dependencies [9f57124]
  - @zhin.js/core@1.5.2
  - @zhin.js/adapter@1.1.5
  - @zhin.js/im-contract@1.0.1
  - @zhin.js/plugin-runtime@1.1.3
  - @zhin.js/command@1.0.7
  - @zhin.js/agent@1.1.3
  - zhin.js@6.0.2

## 8.0.2

### Patch Changes

- Updated dependencies [696ab1b]
  - @zhin.js/agent@1.1.2
  - zhin.js@6.0.1

## 8.0.1

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/adapter@1.1.4
  - @zhin.js/agent@1.1.1
  - @zhin.js/command@1.0.6
  - @zhin.js/core@1.5.1
  - zhin.js@6.0.1

## 8.0.0

### Patch Changes

- 7c1e63a: feat(command)!: 命令名前缀分隔符由空格改为点号（BREAKING）

  非 root 插件命令的自动前缀从空格改为点号：`qq endpoint list` → `qq.endpoint list`，多级挂载 `b a foo` → `b.a.foo`；root 插件命令不变。点号前缀同时消除了旧规则下 root 目录段与子插件 owner 段的命名冲突（`child status` vs `child.status` 现在可共存）。配套的 endpoint 管理命令套件（`createEndpointCommands`）及 QQ/ICQQ 适配器的用户可见用法文案同步更新为新风格。迁移：用户与文档中所有 `<adapter> <command>` 形式的指令改为 `<adapter>.<command>`。

- 4fbff5d: feat!: 多模态双向 Segment 一贯制（BREAKING，无兼容层）

  全框架唯一媒体表达统一为 canonical `Segment` + `MediaRef{kind: url|path|base64|file, value, mime_type?, file_name?, size?}`，新增 audio/video/file 段类型；所有第二形状（legacy `data.url/file/base64` 字段、`mediaRefFromLegacyData`/`mediaRefToLegacyFields` 桥、双写）全部删除。

  - **core**：`SendContent` 一等支持 `Segment[]`；endpoint 出站载荷只含 canonical 段；`resolveOutboundMediaPolicy` 改为纯声明驱动（adapter definition `segments.outboundMedia`），内置策略表删除，未声明回退 `url-or-text`；`ImageContent` 旧桥删除。
  - **ai**：新增 `MediaContentBlock`/`MediaBlockRef`（Segment 同构）与 `UserMessage.media`（当前 turn 媒体，**不持久化**——存储层自动剥离）；`createUserMessage(text, media?)` 签名变更（`ImageContent` 删除）；provider 边界序列化器 `filterMediaBlocksForProvider` + 能力表（缺省 image-only，不支持类型降级占位文本）；ai-sdk 桥媒体块 → SDK image/file parts。
  - **agent**：入站 turn 注入（`turn/inbound-media.ts`）——commMessage 媒体段 → 当前 turn `UserMessage.media`；图片 path 物化、音频默认 STT（`@zhin.js/speech` 可选，失败降级占位）、视频/文件占位；`publishOutboundElements` 产出 canonical Segment；`transcribeAudioPayload` 导出。
  - **cli**：`bridgeRuntimeMessage` 回复链路媒体段透传，不再压平为文本（`$reply` 直达 normalize → adapter）。
  - **全部 20 个平台适配器**：出站媒体只消费 `data.media`（url 直发 / base64 直发 / 平台上传 / 读盘），入站媒体产出 canonical `data.media`；`segments.outboundMedia` 声明与实际消费逐一核对修正；QQ 入站新增 canonical segments（image/audio/video/file/mention/face/reply），图片/语音/视频不再丢失。

  迁移：适配器/插件产媒体一律用 `{ type, data: { media: MediaRef } }`；发送 legacy `data.url/file/base64` 形状的段会被 warn 丢弃。

- Updated dependencies [7c1e63a]
- Updated dependencies [4fbff5d]
- Updated dependencies [5b94d9c]
  - @zhin.js/command@1.0.5
  - @zhin.js/adapter@1.1.3
  - @zhin.js/core@1.5.0
  - @zhin.js/agent@1.1.0
  - zhin.js@6.0.0

## 7.0.5

### Patch Changes

- @zhin.js/agent@1.0.10
- @zhin.js/core@1.4.3
- zhin.js@5.0.3

## 7.0.4

### Patch Changes

- Updated dependencies [45b3256]
  - @zhin.js/core@1.4.3
  - @zhin.js/agent@1.0.9
  - zhin.js@5.0.3

## 7.0.3

### Patch Changes

- Updated dependencies [f346346]
  - @zhin.js/agent@1.0.8
  - @zhin.js/core@1.4.2
  - zhin.js@5.0.2

## 7.0.2

### Patch Changes

- d5cd4aa: Publish Plugin Runtime entry points and convention modules as JavaScript so
  installed npm plugins load on Node without TypeScript stripping. Workspace
  development continues to prefer TypeScript sources for local HMR.

  Remove the unconsumed legacy game hub APIs from game-kit; game navigation and
  records now use ordinary convention commands owned by the game hub plugin.

- Updated dependencies [d5cd4aa]
  - @zhin.js/command@1.0.4
  - zhin.js@5.0.2
  - @zhin.js/adapter@1.1.2
  - @zhin.js/core@1.4.2
  - @zhin.js/agent@1.0.7

## 7.0.1

### Patch Changes

- 74b035c: endpoint 管理命令扩展至 18/20 适配器：kook / discord / github（private_key 支持内联文件路径）/ icqq（bindFlow 登记式 add + `icqq login` 引导）/ dingtalk / lark / line / satori / wechat-mp / wecom / weixin-ilink 接入 `endpoint list/add/remove`（字段对齐各自 schema，凭据写 `.env`）。email（smtp/imap 嵌套对象）与 sandbox（无凭据）暂不接。
- 6cb6152: 统一消息元素通道（UNI-Channel）落地：

  - **入站契约**：`IncomingMessage.segments`（canonical Segment[]，与 content 纯文本视图同源双轨），Message 透传；AI 兜底链路经 `collectSegmentMedia` 把图片/语音/视频/文件 MediaRef 写入会话 extra——多模态输入不再丢失。
  - **出站协商**：`normalizeOutboundPayload` 升级全量 canonical 归一（复用 generic-segment-mapper），html→image 按端点 `segments.outboundMedia` 声明降级（base64 直发 / url-or-text / passthrough 自行物化）；`MediaRef.kind` 新增 `'file'` 承载平台不透明引用（file_id/resource_id）。
  - **能力声明**：`defineAdapter.segments` policy（outboundMedia / interactive），三道段门禁复活（探测点改 adapters/\*.ts，豁免名单渐进收敛）。
  - **首批迁移**：icqq 全保真出入站（CQ ↔ canonical，quote→reply 段）；milky/telegram/discord 入站媒体段恢复（附件/贴纸/callback action）；napcat/onebot11/onebot12 出站 canonical→OneBot 数组段；wechat-mp/wecom `/cgi-bin/media/upload` 与 lark `/im/v1/images` 上传通路（base64/URL 图片不再静默丢图，失败降级文本）。

- Updated dependencies [cdf64e7]
- Updated dependencies [2d0a159]
- Updated dependencies [5691aba]
- Updated dependencies [078e3f7]
- Updated dependencies [50497a5]
- Updated dependencies [9c997b2]
- Updated dependencies [09d4f25]
- Updated dependencies [43485a9]
- Updated dependencies [f0ec5ab]
- Updated dependencies [3e925d0]
- Updated dependencies [fa66c4c]
- Updated dependencies [fa66c4c]
- Updated dependencies [6cb6152]
  - @zhin.js/command@1.0.3
  - @zhin.js/agent@1.0.6
  - @zhin.js/plugin-runtime@1.1.1
  - zhin.js@5.0.1
  - @zhin.js/adapter@1.1.1
  - @zhin.js/core@1.4.1

## 7.0.0

### Patch Changes

- 7db69c1: 命令前缀改为适配器配置项：`MessageDispatcher` 不再硬编码 `/`，默认按消息所属适配器实例 config 的 `commandPrefix` 解析（默认 `''` 无前缀，任意文本按命令匹配），`endpoints[i].commandPrefix` 逐项覆盖；`ImRuntime({ commandPrefix })` 仍可设全局静态前缀。全部 20 个平台适配器 schema 新增 `commandPrefix` 属性。

  BREAKING（行为变化）：未配置时命令不再需要 `/` 前缀——原 `/zt` 写法不再命中，直接发 `zt` 即可；需要斜杠风格的适配器请在配置里显式设 `commandPrefix: '/'`。

- e5c84ed: Adapter 多账号：插件实例 config 支持 `endpoints: [{name, ...覆盖}]` 数组，`expandEndpointConfigs` 将一个实例展开为多个 endpoint record（id 为 `<slotId>~<name>`，顶层字段共享、逐项覆盖），替代多 `instanceKey` 方案；Console `/api/plugins` 收敛为一个插件卡片 + 多 endpoint。icqq / qq schema 与 README 补 `endpoints` 配置。

  Plugin Runtime Console Host：补 `/esm/*` React/router ESM 代理路由（legacy `consoleApiRouter` 对齐），TypeScriptClientBuilder 裸导入改写为 `/esm/<enc>.mjs`。

- 713445c: 适配器配置格式定稿（不兼容旧格式）：`plugins.<adapter>` 顶层仅共享字段 + `commandPrefix`，`endpoints[i]` 携带 endpoint 级字段（`name` + 凭据，各 schema 已类型化），`endpoints` 为必填（icqq 另需顶层 `master`）；icqq 新增 `trusted` 列表（顶层/逐项均可）。scaffold-wizard 全部字段式与自定义 configure() 产出改为新格式，examples（full-bot / qq-games-bot）与 20 个适配器 README 同步迁移。
- f32c424: 适配器配置统一为 endpoints 数组格式：`plugins.<adapter>` 为该 adapter 所有 endpoint 的通用配置，`plugins.<adapter>.endpoints[i]` 为单个 endpoint 的特殊配置（逐项覆盖，`name` 必填）。slack / github schema 新增 `endpoints` 属性；icqq / qq / slack 顶层必填改为 `anyOf`（单 endpoint 字段或 `endpoints` 数组二选一，兼容 Ajv strictRequired）。
- Updated dependencies [7db69c1]
- Updated dependencies [e5c84ed]
- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
- Updated dependencies [ac9da66]
  - @zhin.js/core@1.4.0
  - @zhin.js/adapter@1.1.0
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/agent@1.0.5
  - zhin.js@5.0.0

## 6.0.3

### Patch Changes

- cc5c94d: 约定式插件运行时迁移（breaking）：插件与适配器由 `usePlugin()` / `extends Adapter` 迁移为 `definePlugin` / `defineAdapter` + `plugin.ts` + 约定目录（`adapters/`、`commands/`、`components/`、`tools/` 等）。

  - 新增约定式运行时包：`@zhin.js/plugin-runtime`、`@zhin.js/adapter`、`@zhin.js/runtime`、`@zhin.js/host-http`（首版 1.0.0 走 init-publish，不在本 changeset 内 bump）。
  - 全部 20 个平台适配器改为约定式 `defineAdapter`，旧 `usePlugin` / `extends Adapter` / `segment-mapper` 生产入口已删除；onebot11 反向 WSS、onebot12 webhook/wss、milky sse/webhook/wss、satori webhook、kook webhook、qq webhook/middleware 等 slice 1 推迟的连接模式已补齐。
  - 游戏 / 工具 / 服务插件同步迁移到约定目录结构。
  - CLI 增加 plugin-runtime host installer（http/database/outbound/schedule/console 等）。

  后续加固（同批）：

  - CLI：`zhin runtime start --daemon`（pidfile/崩溃拉起/风暴保护），orphan watchdog 防僵尸进程；legacy `zhin dev` / `zhin start` 已移除（含 `zhin restart`），`zhin stop` 兼容新 daemon。
  - 安全：builtin 工具统一走 `security/policy-facade.ts` 的 `runToolPolicies`（声明式策略表，deny 优先）；审计日志 close flush + 背压队列；`splitCompoundCommand` 引号感知、`extractCommandName` 去引号堵绕过。
  - 日志：Logger 双堆栈修复、本地时区、`getLogger` 挂树（`setLevel` 递归生效）、第三方库（log4js/discord）桥接、启动人读总结。
  - 结构：`plugins/games/shared` 迁为 `packages/game-kit`（`@zhin.js/game-kit`）；死目录 `plugins/adapters/common` 删除。
  - 脚手架：`create-zhin-app` / `zhin new` / scaffold-wizard 生成物改为 Plugin Runtime 形态（minimal-bot 同构，新配置格式）。
  - Console：endpoint.list 真实名称与 phase、schema:get-all 按 instanceKey 映射、db:\* 接 DatabaseHost。

  注：按仓库发布惯例（见 1bb345dd2），本次 breaking 迁移统一使用 patch，避免 zhin.js 5.0 级联。

- 447f3e2: 迁移缺口修复（legacy 功能对齐）：

  - html 段出站规范化：经 `@zhin.js/html-renderer` 渲染为 image 段（sandbox 豁免、无渲染器时降级文本），修复真实平台 `[object Object]`。
  - 群聊 @ 触发 AI：适配器入站标注 `metadata.mentioned`（icqq/qq/slack/onebot11/onebot12/napcat/milky/discord/telegram/kook/dingtalk/satori），`matchAiTrigger` 补齐 ignorePrefixes/respondToAt/respondToPrivate/keywords（默认值与 legacy 对齐）。
  - im_transcripts 全量流水恢复写入（chat_history 工具可用）；群聊旁听上下文回迁。
  - `ai.trigger.timeout/thinkingMessage/errorTemplate` 生效；masters/trusted 角色解析对齐 legacy。
  - `Message.sender` 统一为用户 ID（onebot11/12、napcat、milky 原误传显示名）；quote_id 经 metadata 接入 AI 引用上下文。

- Updated dependencies [16ec4e8]
- Updated dependencies [cc5c94d]
- Updated dependencies [447f3e2]
  - @zhin.js/core@1.3.5
  - @zhin.js/agent@1.0.4
  - zhin.js@4.1.3
  - @zhin.js/logger@1.0.75
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/adapter@1.0.1

## 6.0.2

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/agent@1.0.3
  - @zhin.js/client@2.0.5
  - @zhin.js/contract@1.0.3
  - @zhin.js/core@1.3.4
  - @zhin.js/host-api@2.0.5
  - @zhin.js/host-router@2.0.3
  - zhin.js@4.1.2

## 6.0.1

### Patch Changes

- 5cc9c03: fix: ai 优化
- b9b3881: fix: 增加游戏引擎以及部分游戏
- Updated dependencies [5b08052]
- Updated dependencies [5cc9c03]
- Updated dependencies [36d6db2]
- Updated dependencies [b9b3881]
- Updated dependencies [7700903]
  - @zhin.js/agent@1.0.2
  - @zhin.js/core@1.3.3
  - @zhin.js/client@2.0.4
  - @zhin.js/contract@1.0.2
  - @zhin.js/host-api@2.0.4
  - @zhin.js/host-router@2.0.2
  - zhin.js@4.1.1

## 6.0.0

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化
- Updated dependencies [c4575c9]
- Updated dependencies [c4575c9]
  - @zhin.js/host-router@2.0.1
  - @zhin.js/host-api@2.0.3
  - @zhin.js/agent@1.0.1
  - @zhin.js/core@1.3.2
  - zhin.js@4.1.0

## 5.0.2

### Patch Changes

- Updated dependencies [384ea11]
  - @zhin.js/host-api@2.0.2
  - zhin.js@4.0.1

## 5.0.1

### Patch Changes

- ae5239c: fix: 核心包瘦身
- Updated dependencies [609da24]
- Updated dependencies [7dfafc2]
- Updated dependencies [93e58d9]
- Updated dependencies [ae5239c]
  - @zhin.js/agent@0.3.1
  - @zhin.js/core@1.3.1
  - @zhin.js/host-api@2.0.1
  - zhin.js@4.0.1
  - @zhin.js/host-router@2.0.0

## 5.0.0

### Patch Changes

- Updated dependencies [db38da4]
  - @zhin.js/agent@0.3.0
  - @zhin.js/core@1.3.0
  - zhin.js@3.0.0
  - @zhin.js/host-api@2.0.0
  - @zhin.js/host-router@2.0.0

## 4.0.1

### Patch Changes

- d8def69: fix: 性能优化
- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - @zhin.js/host-router@1.0.1
  - @zhin.js/host-api@1.0.1
  - @zhin.js/agent@0.2.1
  - @zhin.js/core@1.2.1
  - zhin.js@2.0.1
  - @zhin.js/client@2.0.3

## 4.0.0

### Patch Changes

- e62c23a: fix: update pnpm-lock.yaml and vitest configurations- Added new dependencies for the full-bot example, including multiple Zhin.js adapters and TypeScript.- Updated the test-bot example to include '@puniyu/system-info' and other necessary packages.- Modified vitest configuration to include additional module directories for better dependency resolution.- Enhanced documentation for the KOOK adapter, including new features like typing indicators and system notifications.- Removed unused test assets and scripts from the test-bot example to streamline the project.
- Updated dependencies [65f4b0a]
- Updated dependencies [e62c23a]
  - @zhin.js/core@1.2.0
  - @zhin.js/agent@0.2.0
  - @zhin.js/host-api@1.0.0
  - zhin.js@2.0.0
  - @zhin.js/host-router@1.0.0

## 3.0.11

### Patch Changes

- Updated dependencies [d8547d2]
  - @zhin.js/agent@0.1.31
  - @zhin.js/core@1.1.33
  - zhin.js@1.0.92
  - @zhin.js/host-router@0.0.3

## 3.0.10

### Patch Changes

- 3735e96: fix: 智能家居控制
- Updated dependencies [3735e96]
- Updated dependencies [238de62]
  - @zhin.js/host-api@0.0.4
  - @zhin.js/agent@0.1.30
  - @zhin.js/core@1.1.32
  - zhin.js@1.0.91
  - @zhin.js/host-router@0.0.3

## 3.0.9

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
- Updated dependencies [a26e496]
- Updated dependencies [c8f8207]
  - @zhin.js/client@2.0.2
  - @zhin.js/contract@1.0.1
  - @zhin.js/host-api@0.0.3
  - @zhin.js/host-router@0.0.3
  - @zhin.js/agent@0.1.29
  - @zhin.js/core@1.1.31
  - zhin.js@1.0.90

## 3.0.8

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新
- Updated dependencies [c78d2cd]
  - @zhin.js/client@2.0.1
  - @zhin.js/host-router@0.0.2
  - @zhin.js/agent@0.1.28
  - @zhin.js/core@1.1.30
  - zhin.js@1.0.89
  - @zhin.js/host-api@0.0.2

## 3.0.7

### Patch Changes

- Updated dependencies [ccb6e24]
  - zhin.js@1.0.88

## 3.0.6

### Patch Changes

- 90d9efd: fix: 处理包名
  - zhin.js@1.0.87
  - @zhin.js/core@1.1.29
  - @zhin.js/agent@0.1.27
  - @zhin.js/host-api@0.0.1
  - @zhin.js/host-router@0.0.1

## 3.0.5

### Patch Changes

- 6295cbd: fix: @优化
- a51d504: fix: ai 回应
- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [6295cbd]
- Updated dependencies [7e14f8d]
- Updated dependencies [996ebb3]
  - @zhin.js/agent@0.1.26
  - @zhin.js/core@1.1.28
  - @zhin.js/client@1.1.4
  - zhin.js@1.0.86
  - @zhin.js/console@3.0.5
  - @zhin.js/host-router@1.0.79

## 3.0.4

### Patch Changes

- zhin.js@1.0.85
- @zhin.js/console@3.0.4
- @zhin.js/host-router@1.0.78
- @zhin.js/core@1.1.27

## 3.0.3

### Patch Changes

- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
- Updated dependencies [2d24338]
  - @zhin.js/console@3.0.3
  - @zhin.js/core@1.1.26
  - zhin.js@1.0.84
  - @zhin.js/client@1.1.3
  - @zhin.js/host-router@1.0.77

## 3.0.2

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/console@3.0.2
  - @zhin.js/host-router@1.0.76
  - @zhin.js/client@1.1.2
  - @zhin.js/core@1.1.25
  - zhin.js@1.0.83

## 3.0.1

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/console@3.0.1
  - @zhin.js/host-router@1.0.75
  - @zhin.js/client@1.1.1
  - @zhin.js/core@1.1.24
  - zhin.js@1.0.82

## 3.0.0

### Patch Changes

- Updated dependencies
  - @zhin.js/client@1.1.0
  - @zhin.js/console@3.0.0

## 2.0.26

### Patch Changes

- 8086ccb: fix: ai 增强/优化
- Updated dependencies [8086ccb]
  - @zhin.js/core@1.1.23
  - zhin.js@1.0.81
  - @zhin.js/console@2.0.24
  - @zhin.js/host-router@1.0.74

## 2.0.25

### Patch Changes

- 3b3e49b: fix: ask 工具修复,icqq skill 优化
  - zhin.js@1.0.80
  - @zhin.js/console@2.0.23
  - @zhin.js/host-router@1.0.73
  - @zhin.js/core@1.1.22

## 2.0.24

### Patch Changes

- dc04e4a: fix: skill 优化

## 2.0.23

### Patch Changes

- 92da96d: fix skill 激活优化
  - zhin.js@1.0.79
  - @zhin.js/console@2.0.22
  - @zhin.js/host-router@1.0.72
  - @zhin.js/core@1.1.21

## 2.0.22

### Patch Changes

- Updated dependencies [88caeb2]
  - @zhin.js/console@2.0.21
  - @zhin.js/core@1.1.20
  - zhin.js@1.0.78
  - @zhin.js/host-router@1.0.71

## 2.0.21

### Patch Changes

- zhin.js@1.0.77
- @zhin.js/core@1.1.19
- @zhin.js/console@2.0.20
- @zhin.js/host-router@1.0.70

## 2.0.20

### Patch Changes

- Updated dependencies [cb9fbf1]
  - zhin.js@1.0.76
  - @zhin.js/console@2.0.19
  - @zhin.js/host-router@1.0.69
  - @zhin.js/core@1.1.18

## 2.0.19

### Patch Changes

- @zhin.js/core@1.1.17
- zhin.js@1.0.75
- @zhin.js/console@2.0.18
- @zhin.js/host-router@1.0.68

## 2.0.18

### Patch Changes

- Updated dependencies [c9dec38]
  - @zhin.js/core@1.1.16
  - zhin.js@1.0.74
  - @zhin.js/console@2.0.17
  - @zhin.js/host-router@1.0.67

## 2.0.17

### Patch Changes

- zhin.js@1.0.73
- @zhin.js/console@2.0.16
- @zhin.js/host-router@1.0.66
- @zhin.js/core@1.1.15

## 2.0.16

### Patch Changes

- Updated dependencies [21efca3]
  - @zhin.js/console@2.0.15

## 2.0.15

### Patch Changes

- abc75a4: fix: 优化,客户端构建优化
- Updated dependencies [abc75a4]
  - @zhin.js/console@2.0.14

## 2.0.14

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - @zhin.js/client@1.0.18
  - @zhin.js/core@1.1.14
  - zhin.js@1.0.72
  - @zhin.js/console@2.0.13
  - @zhin.js/host-router@1.0.65

## 2.0.13

### Patch Changes

- Updated dependencies [60b1a4d]
  - @zhin.js/console@2.0.12

## 2.0.12

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - @zhin.js/client@1.0.17
  - @zhin.js/core@1.1.13
  - zhin.js@1.0.71
  - @zhin.js/console@2.0.11
  - @zhin.js/host-router@1.0.64

## 2.0.11

### Patch Changes

- Updated dependencies [d0250e8]
  - @zhin.js/core@1.1.10
  - zhin.js@1.0.68
  - @zhin.js/console@2.0.10
  - @zhin.js/host-router@1.0.63

## 2.0.10

### Patch Changes

- Updated dependencies [0eba6d6]
  - @zhin.js/host-router@1.0.62
  - @zhin.js/core@1.1.9
  - zhin.js@1.0.67
  - @zhin.js/console@2.0.9

## 2.0.9

### Patch Changes

- zhin.js@1.0.66
- @zhin.js/core@1.1.8
- @zhin.js/console@2.0.8
- @zhin.js/host-router@1.0.61

## 2.0.8

### Patch Changes

- @zhin.js/core@1.1.7
- zhin.js@1.0.65
- @zhin.js/console@2.0.7
- @zhin.js/host-router@1.0.60

## 2.0.7

### Patch Changes

- 36c1b8f: fix: 重构 icqq\github 适配器

## 2.0.6

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - @zhin.js/client@1.0.16
  - @zhin.js/core@1.1.6
  - zhin.js@1.0.64
  - @zhin.js/console@2.0.6
  - @zhin.js/host-router@1.0.59

## 2.0.5

### Patch Changes

- ba30934: fix: web 优化
- Updated dependencies [ba30934]
  - @zhin.js/console@2.0.5
  - @zhin.js/host-router@1.0.58
  - zhin.js@1.0.63
  - @zhin.js/core@1.1.5

## 2.0.4

### Patch Changes

- zhin.js@1.0.62
- @zhin.js/console@2.0.4
- @zhin.js/host-router@1.0.57
- @zhin.js/core@1.1.4

## 2.0.3

### Patch Changes

- zhin.js@1.0.61
- @zhin.js/console@2.0.3
- @zhin.js/host-router@1.0.56
- @zhin.js/core@1.1.3

## 2.0.2

### Patch Changes

- 5073d4c: chore: chore: update TypeScript version to ^5.9.3 across all plugins and packages
  feat: enhance ai-text-as-image output registration with off handler for cleanup
  fix: remove unnecessary logging in ensureBuiltinFontsCached function
  refactor: simplify action handlers in html-renderer tools
  chore: add README files for queue-sandbox-poc and event-delivery packages
  chore: adjust pnpm workspace configuration to exclude games directory
  chore: update tsconfig to include plugins directory for TypeScript compilation
- Updated dependencies [5073d4c]
  - @zhin.js/console@2.0.2
  - @zhin.js/core@1.1.2
  - zhin.js@1.0.60
  - @zhin.js/host-router@1.0.55

## 2.0.1

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - @zhin.js/client@1.0.15
  - @zhin.js/core@1.1.1
  - zhin.js@1.0.59
  - @zhin.js/console@2.0.1
  - @zhin.js/host-router@1.0.54

## 2.0.0

### Patch Changes

- Updated dependencies [8280fe7]
  - @zhin.js/core@1.1.0
  - zhin.js@1.0.58
  - @zhin.js/console@2.0.0
  - @zhin.js/host-router@1.0.53

## 1.0.71

### Patch Changes

- Updated dependencies [c606a57]
  - @zhin.js/core@1.0.57
  - zhin.js@1.0.57
  - @zhin.js/console@1.0.59
  - @zhin.js/host-router@1.0.52

## 1.0.70

### Patch Changes

- zhin.js@1.0.56
- @zhin.js/core@1.0.56
- @zhin.js/console@1.0.58
- @zhin.js/host-router@1.0.51

## 1.0.69

### Patch Changes

- Updated dependencies [a4e3559]
  - @zhin.js/console@1.0.57

## 1.0.68

### Patch Changes

- Updated dependencies [75709e1]
  - @zhin.js/core@1.0.55
  - zhin.js@1.0.55
  - @zhin.js/console@1.0.56
  - @zhin.js/host-router@1.0.50

## 1.0.67

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - @zhin.js/client@1.0.14
  - @zhin.js/core@1.0.54
  - zhin.js@1.0.54
  - @zhin.js/console@1.0.55
  - @zhin.js/host-router@1.0.49

## 1.0.66

### Patch Changes

- @zhin.js/core@1.0.53
- zhin.js@1.0.53
- @zhin.js/console@1.0.54
- @zhin.js/host-router@1.0.48

## 1.0.65

### Patch Changes

- a3511a0: 各包内 Agent 技能说明已固定为随包发布的 `skills/*/SKILL.md`（替代已移除的运行时 `declareSkill`）。本批为 registry / 分发侧对齐的 **patch** 版本递增。
- Updated dependencies [a3511a0]
  - @zhin.js/console@1.0.53
  - @zhin.js/host-router@1.0.47

## 1.0.64

### Patch Changes

- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - @zhin.js/core@1.0.52
  - zhin.js@1.0.52
  - @zhin.js/console@1.0.52
  - @zhin.js/client@1.0.13
  - @zhin.js/host-router@1.0.46

## 1.0.63

### Patch Changes

- Updated dependencies [a451abf]
  - @zhin.js/console@1.0.51

## 1.0.62

### Patch Changes

- 607acc4: fix: 视觉模型处理
  - zhin.js@1.0.51
  - @zhin.js/console@1.0.50
  - @zhin.js/host-router@1.0.45
  - @zhin.js/core@1.0.51

## 1.0.61

### Patch Changes

- Updated dependencies [353de3d]
  - @zhin.js/client@1.0.12
  - @zhin.js/console@1.0.49

## 1.0.60

### Patch Changes

- zhin.js@1.0.50
- @zhin.js/console@1.0.48
- @zhin.js/host-router@1.0.44
- @zhin.js/core@1.0.50

## 1.0.59

### Patch Changes

- Updated dependencies [b00b6c9]
  - @zhin.js/core@1.0.49
  - zhin.js@1.0.49
  - @zhin.js/console@1.0.47
  - @zhin.js/host-router@1.0.43

## 1.0.58

### Patch Changes

- Updated dependencies [7d09e5e]
  - @zhin.js/core@1.0.48
  - zhin.js@1.0.48
  - @zhin.js/console@1.0.46
  - @zhin.js/host-router@1.0.42

## 1.0.57

### Patch Changes

- de3e352: fix: 新增 request 和 notice 抽象,新增消息过滤支持
- Updated dependencies [de3e352]
  - @zhin.js/core@1.0.47
  - zhin.js@1.0.47
  - @zhin.js/console@1.0.45
  - @zhin.js/host-router@1.0.41

## 1.0.56

### Patch Changes

- Updated dependencies [7394603]
  - @zhin.js/core@1.0.46
  - zhin.js@1.0.46
  - @zhin.js/console@1.0.44
  - @zhin.js/host-router@1.0.40

## 1.0.55

### Patch Changes

- Updated dependencies [63b83ef]
  - @zhin.js/core@1.0.45
  - zhin.js@1.0.45
  - @zhin.js/console@1.0.43
  - @zhin.js/host-router@1.0.39

## 1.0.54

### Patch Changes

- zhin.js@1.0.44
- @zhin.js/console@1.0.42
- @zhin.js/host-router@1.0.38
- @zhin.js/core@1.0.44

## 1.0.53

### Patch Changes

- Updated dependencies [72ec4ba]
  - @zhin.js/console@1.0.41
  - @zhin.js/host-router@1.0.37
  - @zhin.js/client@1.0.11
  - @zhin.js/core@1.0.43
  - zhin.js@1.0.43

## 1.0.52

### Patch Changes

- Updated dependencies [5f5127c]
  - @zhin.js/console@1.0.40

## 1.0.51

### Patch Changes

- zhin.js@1.0.42
- @zhin.js/core@1.0.42
- @zhin.js/console@1.0.39
- @zhin.js/host-router@1.0.36

## 1.0.50

### Patch Changes

- 5a68249: fix: 文档优化
- Updated dependencies [5a68249]
  - @zhin.js/core@1.0.41
  - zhin.js@1.0.41
  - @zhin.js/console@1.0.38
  - @zhin.js/host-router@1.0.35

## 1.0.49

### Patch Changes

- 7ef9057: fix: 架构调整优化
- Updated dependencies [7ef9057]
  - @zhin.js/core@1.0.40
  - zhin.js@1.0.40
  - @zhin.js/console@1.0.37
  - @zhin.js/host-router@1.0.34

## 1.0.48

### Patch Changes

- Updated dependencies [04f76ac]
  - @zhin.js/core@1.0.39
  - zhin.js@1.0.39
  - @zhin.js/console@1.0.36
  - @zhin.js/host-router@1.0.33

## 1.0.47

### Patch Changes

- ab5c54a: fix: ai 架构优化
- Updated dependencies [ab5c54a]
  - @zhin.js/core@1.0.38
  - zhin.js@1.0.38
  - @zhin.js/console@1.0.35
  - @zhin.js/host-router@1.0.32

## 1.0.46

### Patch Changes

- Updated dependencies [631da6e]
  - @zhin.js/console@1.0.34
  - @zhin.js/host-router@1.0.31

## 1.0.45

### Patch Changes

- e23e732: fix: 增强平台 AI 能力

## 1.0.44

### Patch Changes

- Updated dependencies [a8ce720]
  - @zhin.js/core@1.0.37
  - zhin.js@1.0.37
  - @zhin.js/console@1.0.33
  - @zhin.js/host-router@1.0.30

## 1.0.43

### Patch Changes

- Updated dependencies [432d0a5]
- Updated dependencies [6d94111]
  - @zhin.js/console@1.0.32
  - @zhin.js/host-router@1.0.29
  - @zhin.js/core@1.0.36
  - zhin.js@1.0.36

## 1.0.42

### Patch Changes

- Updated dependencies [8502351]
  - @zhin.js/core@1.0.35
  - zhin.js@1.0.35
  - @zhin.js/console@1.0.31
  - @zhin.js/host-router@1.0.28

## 1.0.41

### Patch Changes

- Updated dependencies [634e2d7]
  - @zhin.js/core@1.0.34
  - zhin.js@1.0.34
  - @zhin.js/console@1.0.30
  - @zhin.js/host-router@1.0.27

## 1.0.40

### Patch Changes

- Updated dependencies [4abae79]
  - @zhin.js/core@1.0.33
  - zhin.js@1.0.33
  - @zhin.js/console@1.0.29
  - @zhin.js/host-router@1.0.26

## 1.0.39

### Patch Changes

- 48481a8: fix: @zhin.js/adapter-icqq 内置点赞工具
  fix: create-zhin-app 默认增加 send 指令
  fix: @zhin.js/cli 重命名 onborading 为 onborad 并重写实现,新增 zhin send 命令，用于直接通过 send 命令发送消息
  fix: @zhin.js/host-router 新增消息发送 api
- Updated dependencies [48481a8]
  - @zhin.js/host-router@1.0.25

## 1.0.38

### Patch Changes

- Updated dependencies [10d8bdc]
  - @zhin.js/core@1.0.32
  - zhin.js@1.0.32
  - @zhin.js/console@1.0.28
  - @zhin.js/host-router@1.0.24

## 1.0.37

### Patch Changes

- Updated dependencies [771706d]
  - @zhin.js/core@1.0.31
  - zhin.js@1.0.31
  - @zhin.js/console@1.0.27
  - @zhin.js/host-router@1.0.23

## 1.0.36

### Patch Changes

- Updated dependencies [460a6c6]
  - zhin.js@1.0.30
  - @zhin.js/console@1.0.26
  - @zhin.js/host-router@1.0.22
  - @zhin.js/core@1.0.30

## 1.0.35

### Patch Changes

- Updated dependencies [4ec9176]
  - @zhin.js/core@1.0.29
  - zhin.js@1.0.29
  - @zhin.js/console@1.0.25
  - @zhin.js/host-router@1.0.21

## 1.0.34

### Patch Changes

- Updated dependencies [05a514d]
  - @zhin.js/console@1.0.24
  - @zhin.js/host-router@1.0.20
  - @zhin.js/client@1.0.10
  - @zhin.js/core@1.0.28
  - zhin.js@1.0.28

## 1.0.33

### Patch Changes

- Updated dependencies [2b44e18]
  - @zhin.js/host-router@1.0.19

## 1.0.32

### Patch Changes

- Updated dependencies [b27e633]
  - @zhin.js/host-router@1.0.18
  - @zhin.js/core@1.0.27
  - zhin.js@1.0.27
  - @zhin.js/console@1.0.23

## 1.0.31

### Patch Changes

- 106d357: fix: ai
- Updated dependencies [106d357]
  - @zhin.js/console@1.0.22
  - @zhin.js/host-router@1.0.17
  - @zhin.js/client@1.0.9
  - @zhin.js/core@1.0.26
  - zhin.js@1.0.26

## 1.0.30

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai
- Updated dependencies [26d2942]
- Updated dependencies [6b02c41]
  - @zhin.js/client@1.0.8
  - @zhin.js/core@1.0.25
  - zhin.js@1.0.25
  - @zhin.js/console@1.0.21
  - @zhin.js/host-router@1.0.16

## 1.0.29

### Patch Changes

- Updated dependencies [6108e5d]
  - @zhin.js/core@1.0.24
  - zhin.js@1.0.24
  - @zhin.js/console@1.0.20
  - @zhin.js/host-router@1.0.15

## 1.0.28

### Patch Changes

- 52ae08a: fix: 更新消息处理流程
- Updated dependencies [52ae08a]
  - @zhin.js/core@1.0.23
  - zhin.js@1.0.23
  - @zhin.js/console@1.0.19
  - @zhin.js/host-router@1.0.14

## 1.0.27

### Patch Changes

- Updated dependencies [26aba27]
  - zhin.js@1.0.22
  - @zhin.js/console@1.0.18
  - @zhin.js/host-router@1.0.13
  - @zhin.js/core@1.0.22

## 1.0.26

### Patch Changes

- Updated dependencies [3960e70]
  - @zhin.js/core@1.0.21
  - zhin.js@1.0.21
  - @zhin.js/console@1.0.17
  - @zhin.js/host-router@1.0.12

## 1.0.25

### Patch Changes

- a3b7673: fix: 调整依赖项
- 5141137: fix: 修复适配器读取配置 bug
- Updated dependencies [a3b7673]
- Updated dependencies [5141137]
  - @zhin.js/console@1.0.16
  - @zhin.js/host-router@1.0.11
  - @zhin.js/core@1.0.20
  - zhin.js@1.0.20

## 1.0.24

### Patch Changes

- f9faa1d: fix: test release
- Updated dependencies [f9faa1d]
  - @zhin.js/client@1.0.7
  - @zhin.js/core@1.0.19
  - zhin.js@1.0.19
  - @zhin.js/console@1.0.15
  - @zhin.js/host-router@1.0.10

## 1.0.23

### Patch Changes

- d16a69c: fix: test trust publish
- Updated dependencies [d16a69c]
  - @zhin.js/client@1.0.6
  - @zhin.js/core@1.0.18
  - zhin.js@1.0.18
  - @zhin.js/console@1.0.14
  - @zhin.js/host-router@1.0.9

## 1.0.22

### Patch Changes

- Updated dependencies [3bc5d56]
  - @zhin.js/console@1.0.13
  - zhin.js@1.0.17

## 1.0.21

### Patch Changes

- zhin.js@1.0.16

## 1.0.20

### Patch Changes

- f9e75ce: fix: 一致性调整,文档调整
- f9e75ce: fix: recall,文档统一,mcp,githubnotifiy
  - zhin.js@1.0.15

## 1.0.19

### Patch Changes

- Updated dependencies [9bc8dc4]
  - @zhin.js/console@1.0.12

## 1.0.18

### Patch Changes

- Updated dependencies [8f75b7f]
  - @zhin.js/console@1.0.11

## 1.0.17

### Patch Changes

- f4a7dd7: fix: force build

## 1.0.16

### Patch Changes

- 547028f: fix: 优化包结构,优化客户端支持
- Updated dependencies [547028f]
  - @zhin.js/console@1.0.10
  - @zhin.js/types@1.0.5
  - @zhin.js/host-router@1.0.7
  - zhin.js@1.0.14

## 1.0.15

### Patch Changes

- Updated dependencies [4034b94]
  - @zhin.js/console@1.0.9
  - zhin.js@1.0.13

## 1.0.14

### Patch Changes

- zhin.js@1.0.12

## 1.0.13

### Patch Changes

- zhin.js@1.0.11

## 1.0.12

### Patch Changes

- Updated dependencies [c1a539e]
- Updated dependencies [c8c3996]
  - @zhin.js/console@1.0.8
  - @zhin.js/types@1.0.4
  - zhin.js@1.0.10

## 1.0.11

### Patch Changes

- c490260: fix: 更新脚手架结构,优化包依赖
- Updated dependencies [c490260]
  - @zhin.js/console@1.0.7
  - @zhin.js/client@1.0.5
  - @zhin.js/host-router@1.0.6
  - zhin.js@1.0.9

## 1.0.10

### Patch Changes

- 551c4d2: fix: 插件支持配置文件读取,优化 test 用例
- Updated dependencies [551c4d2]
  - @zhin.js/console@1.0.6
  - @zhin.js/types@1.0.3
  - @zhin.js/client@1.0.4
  - zhin.js@1.0.8
  - @zhin.js/host-router@1.0.5

## 1.0.9

### Patch Changes

- Updated dependencies [47845fb]
  - @zhin.js/console@1.0.5
  - zhin.js@1.0.7

## 1.0.8

### Patch Changes

- Updated dependencies [c2d9047]
- Updated dependencies [c2d9047]
- Updated dependencies [b213bbc]
  - @zhin.js/console@1.0.4
  - @zhin.js/client@1.0.3
  - @zhin.js/host-router@1.0.4
  - zhin.js@1.0.6

## 1.0.7

### Patch Changes

- Updated dependencies [5e2bddc]
  - @zhin.js/console@1.0.3

## 1.0.6

### Patch Changes

- Updated dependencies [f347667]
  - @zhin.js/host-router@1.0.3
  - zhin.js@1.0.5

## 1.0.5

### Patch Changes

- Updated dependencies [d291005]
  - @zhin.js/console@1.0.2
  - @zhin.js/client@1.0.2
  - @zhin.js/host-router@1.0.2

## 1.0.4

### Patch Changes

- zhin.js@1.0.4

## 1.0.3

### Patch Changes

- 89bc676: fix: 类型反射优化
- Updated dependencies [727963c]
- Updated dependencies [89bc676]
  - @zhin.js/console@1.0.1
  - @zhin.js/client@1.0.1
  - @zhin.js/types@1.0.2
  - zhin.js@1.0.3

## 1.0.2

### Patch Changes

- 3ecd487: fix: 函数式组件,更新文档
- Updated dependencies [15fc934]
  - zhin.js@1.0.2

## 1.0.1

### Patch Changes

- efdd58a: fix: init
- Updated dependencies [efdd58a]
  - @zhin.js/types@1.0.1
  - zhin.js@1.0.1
  - @zhin.js/host-router@1.0.1
