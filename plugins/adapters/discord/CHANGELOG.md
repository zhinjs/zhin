# @zhin.js/adapter-discord

## 1.1.19

### Patch Changes

- 2c3610a: Move account lifecycle ownership into the generic Adapter base and let native Endpoints retain their SDK Client inheritance. Infer platform-specific operation Sessions from a single adapter registry while preserving command parameter, option, configuration and factory inference.

  Bind message replies, management ports, login challenges and Agent cancellation to the captured account incarnation. Persist runtime account intent with encrypted, revision-checked Host storage; keep account management independent of Root process restarts. Require explicit operator confirmation before importing existing accounts, and give replacement accounts a new identity without inheriting previous Sessions.

  Expose account save, start, stop, update and replacement through the existing adapter Console, with exact account ownership, truthful pending/unknown outcomes and no startup configuration or environment-file rewrites.

  Complete the target migration across every adapter, the public authoring API, generators, examples and Console. This intentionally removes the old create factory, inheritable Endpoint/ClientEndpoint classes, Client descriptors and file-rewrite account management; plugin authors must use createAdapter, native Client inheritance and the single AdapterRegistry. Satori and OneBot12 require explicit platform/userId selection, and WeCom requires a separate agentId.

  Verify opaque credential changes before the same configuration snapshot is committed. Drain admitted native callbacks across close/rollback, cancel target work on stop, and keep raw transport parsing, platform ACK timing and SDK native methods under their existing owners. Account metadata conceals credentials carried in URLs.

- a9f4e48: PATCH COMPATIBILITY CUTOVER: this batch intentionally changes plugin APIs. The maintainer explicitly chose patch releases with declared version boundaries. Upgrade the complete tested dependency set; patch numbering does not promise compatibility with the removed interfaces.

  The first planned floors are zhin.js 1.1.19, Core 1.1.54, Adapter 1.1.26, FeatureKit 1.1.10, Plugin Runtime 1.1.18, Runtime/Isolate 1.1.16 and Agent 1.1.45. Keep old-interface plugins with the earlier locked stack until they are migrated. Adapter's independent Feature API changes from 1.0.0 to 2.0.0; official consumers declare ^2.0.0. Existing Feature API admission rejects explicitly incompatible ranges; omitted API metadata keeps its existing behavior and does not certify compatibility. Runtime engine and patch-only release gates remain unchanged.

  Use the native-Client Adapter target contract, canonical FeatureKit AdapterRegistry augmentation and named Endpoint control/management requests. Route message controls from canonical message/conversation refs; retain exact source authority and propagate caller/account/explicit-Root-stop cancellation. Replace removed Agent activity feedback exports with source-bound feedback. HMR pause/resume belongs to concrete plugin instances; plugins choose accepted-work policy without changing Controller commit/rollback authority. Cooperative worker/process control cancellation does not kill an isolate or reopen retired business admission.

  Provide authenticated historical-data preview, exact selected binding, transactional application, authoritative inspection and explicit resumption, including active games. Preserve before-images and journals; never replay an unconfirmed effect, infer an account from an alias, or reuse historical permission grants. Owner V2 approvals remain inactive legacy data, while new writes use V3. Rollback requires matching software, lockfile and verified data; installing old code alone cannot read a new V3 approval file. Conflicting after-images are never overwritten.

  See docs/plans/adapter-operation-version-boundaries.md and the Chinese/English upgrade guide for the complete version inventory, custom-plugin changes, acceptance and recovery sequence. These code and metadata changes do not authorize merging, publication, deployment, login, production migration or removal of installed workspace patches.

- Updated dependencies [2c3610a]
- Updated dependencies [a9f4e48]
- Updated dependencies [f8505b0]
- Updated dependencies [2c3610a]
  - @zhin.js/adapter@1.1.26
  - @zhin.js/feature-kit@1.1.10
  - @zhin.js/core@1.1.54
  - @zhin.js/host-http@1.1.12
  - @zhin.js/client@1.1.22
  - @zhin.js/page@1.1.11
  - @zhin.js/agent-feature@1.1.11
  - @zhin.js/skill@1.1.11
  - @zhin.js/tool@1.1.13
  - @zhin.js/permission@1.1.10

## 1.1.18

### Patch Changes

- 6345a38: feat(adapters): add per-adapter Console pages

  Every platform adapter now ships a `pages/index` Console page backed by a shared
  `createAdapterConsolePage` component and `createAdapterConsoleRpc` server helper:

  - See running endpoints, test connectivity, and manage
    `plugins.<adapter>.endpoints` (add/remove writes `.env` references) from the
    Console instead of chat commands.
  - Surface LoginAssist pending tasks (QR / slider / SMS / device) so ICQQ login no
    longer requires the terminal.
  - QQ moves its QR binding flow (`qq endpoint add`) into Console actions with
    public/private selection.
  - Pages are permission-gated by `<adapter>:read`; writes need `<adapter>:write`.

- Updated dependencies [6345a38]
- Updated dependencies [ff3efe7]
- Updated dependencies [c58c589]
  - @zhin.js/adapter@1.1.25
  - @zhin.js/client@1.1.21
  - @zhin.js/core@1.1.53
  - @zhin.js/im-contract@1.1.9
  - @zhin.js/tool@1.1.12

## 1.1.17

### Patch Changes

- Updated dependencies [f67883e]
- Updated dependencies [e23cabc]
- Updated dependencies [4d728c0]
- Updated dependencies [eb8feeb]
- Updated dependencies [24a2b71]
- Updated dependencies [d0e1fac]
- Updated dependencies [1ca669a]
- Updated dependencies [3771f7a]
- Updated dependencies [4f96ad5]
  - @zhin.js/core@1.1.52
  - @zhin.js/adapter@1.1.24
  - @zhin.js/tool@1.1.11
  - @zhin.js/host-http@1.1.11
  - @zhin.js/im-contract@1.1.8

## 1.1.16

### Patch Changes

- 53bc6a0: 适配器配置标签、端点命令和工具反馈支持中英文；复用当前操作语言，保持协议值、用户内容、身份、权限与发送链路不变。Sandbox 展示使用项目语言，QQ 绑定与交互状态保留完整会话身份。
- 9cade30: 修复国际化调用链遗漏：Agent 审批、管理命令和错误反馈采用可信语言及实际命令前缀；游戏快捷帮助、工具反馈、平台默认卡片和后台通知贯通语言。协议即时回复复用受运行代约束的个人语言查询，业务验证支持不改变审批身份的双语展示元数据。

  AI 正文、进度与耗尽摘要统一优先遵从用户明确语言要求，再跟随实际输入；个人／项目语言仅作兜底，固定界面文案继续使用配置语言，不增加翻译调用。

  GitHub 工作区为 Git clone/pull/fetch/ls-remote 显式分隔选项与位置参数，保留仓库和分支校验；顺序写入 Bot 名称和邮箱，避免竞争同一配置文件锁。

- dcd4982: Upgrade runtime dependencies to clear security advisories: `undici` (6.29.1 / 8.12.2+), `axios` 1.20.0, and `@modelcontextprotocol/sdk` 1.32.0+ (bringing patched `hono`, `body-parser`, `proxy-addr`, `follow-redirects` and `ip-address` through the lockfile).
- Updated dependencies [334e92d]
- Updated dependencies [f3b7c9f]
- Updated dependencies [658a5fb]
- Updated dependencies [144a17b]
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
  - @zhin.js/host-http@1.1.10
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
  - @zhin.js/host-http@1.1.9
  - @zhin.js/agent-feature@1.1.9
  - @zhin.js/feature-kit@1.1.8
  - @zhin.js/permission@1.1.8
  - @zhin.js/skill@1.1.9

## 1.1.14

### Patch Changes

- Updated dependencies [974fa85]
- Updated dependencies [1e9b3d6]
  - @zhin.js/core@1.1.49

## 1.1.13

### Patch Changes

- Updated dependencies [db06de8]
  - @zhin.js/core@1.1.48

## 1.1.12

### Patch Changes

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
  - @zhin.js/host-http@1.1.8

## 1.1.11

### Patch Changes

- 9816c18: 将应用插件装配改为 configVersion: 2：主配置 plugins 映射实例名到包，disable_plugins 控制启停，业务配置使用顶层同名块。package.json 继续保留 features、entry、engine 等包契约，并支持静态 displayName/icon。

  这是配置格式的破坏性更新：旧配置不能继续运行，请先停止 Bot，运行 `zhin migrate instances` 预览，再使用 `--apply` 转换；提供备份与中断继续/回滚，无法无损转换的嵌套、optional 和别名碰撞需人工迁移。Runtime、Console、CLI 与创建向导统一使用新声明。

  保留框架顶层 `menuKeyword` / `menuStyle`，通过当前 generation 的 Root 配置视图供 Command Feature 消费；严格校验和配置修改不会丢失菜单设置，子实例配置保持隔离。

- Updated dependencies [c407bd2]
- Updated dependencies [064b06d]
- Updated dependencies [2b4d6dc]
- Updated dependencies [a50fc8a]
- Updated dependencies [b58548a]
- Updated dependencies [e914a93]
- Updated dependencies [e914a93]
- Updated dependencies [064b06d]
  - @zhin.js/core@1.1.46
  - @zhin.js/feature-kit@1.1.6
  - @zhin.js/host-http@1.1.7
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
  - @zhin.js/host-http@1.1.6
  - @zhin.js/im-contract@1.1.4
  - @zhin.js/permission@1.1.6
  - @zhin.js/skill@1.1.6
  - @zhin.js/tool@1.1.6
  - @zhin.js/logger@1.1.2

## 1.1.8

### Patch Changes

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
  - @zhin.js/host-http@1.1.5
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

- Updated dependencies [badcc1f]
  - @zhin.js/core@1.1.41
  - @zhin.js/feature-kit@1.1.3
  - @zhin.js/adapter@1.1.17
  - @zhin.js/agent-feature@1.1.4
  - @zhin.js/skill@1.1.4
  - @zhin.js/tool@1.1.4
  - @zhin.js/host-http@1.1.4
  - @zhin.js/permission@1.1.4

## 1.1.5

### Patch Changes

- b9b3953: Use the canonical media MIME type to assign a filename extension when an outbound attachment has no explicit name, allowing Discord to display image previews instead of unknown file attachments.

  Preserve canonical reply message references in Gateway sends so quote replies reference the original message rather than silently sending plain text.

- b9b3953: Project Discord Gateway readiness from the connected client's live readiness state so runtime health no longer reports an observed ready connection as offline. Loss of readiness and stop remain offline.

  Enable partial DM channels so the SDK admits messages from private channels that have not yet been cached.

- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
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
  - @zhin.js/host-http@1.1.3
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

- Updated dependencies [5b5d270]
- Updated dependencies [36c2eb9]
  - @zhin.js/im-contract@1.1.2
  - @zhin.js/core@1.1.38
  - @zhin.js/adapter@1.1.15
  - @zhin.js/host-http@1.1.2
  - @zhin.js/agent-feature@1.1.2
  - @zhin.js/feature-kit@1.1.2
  - @zhin.js/permission@1.1.2
  - @zhin.js/skill@1.1.2
  - @zhin.js/tool@1.1.2

## 1.1.2

### Patch Changes

- a9e4a40: Derive Command user routes only from explicit `commands/**/*/index.ts(x)` entry paths instead of prepending the plugin owner. Child plugins can now publish top-level static or dynamic commands, while duplicate routes across owners fail during generation construction. Adapter endpoint commands move to explicit paths such as `commands/qq/endpoint/list/index.ts` and are invoked as `qq endpoint list`.
- 8740059: Standardize TypeScript capabilities on named module directories such as `commands/foo/index.ts`, `middlewares/audit/index.ts`, `handlers/message-receive/index.ts`, `pages/workroom/index.tsx`, and `mcps/filesystem/index.ts`. Only the fixed `index` entry is discovered; sibling files remain private helpers.

  Command route segments come from directories, while `[name]`, `[[name]]`, `[...name]`, and `[[...name]]` directories declare dynamic parameters. Plugin owners do not enter the route unless their config explicitly sets `commandNamespace`; Endpoint `commandPrefix` remains platform-owned and defaults to an empty string.

  Migrate the built-in adapters, plugins, examples, generators, migration tooling, hot reload classification, Agent authoring surfaces, documentation, and release artifacts to the explicit entry convention.

  Make Tool ownership and progressive disclosure explicit across all four supported locations: plugin-public `tools/`, Agent-private `agents/<name>/tools/`, Skill-private `skills/<name>/tools/`, and Agent-Skill-private `agents/<name>/skills/<name>/tools/`. Move adapter and group-suite operations that require domain instructions into their owning Skills so `load_skill` is the only path that unlocks their schemas.

  Remove the package-root `agent/` convention. Public capabilities now use named package-root directories, schedules use `schedules/<name>/index.ts` or `plugin.ts` injection, MCP connections use `mcps/<name>/index.ts`, Prompt Sections use `prompt-sections/<name>/index.ts`, Agent definitions use `agents/<name>/`, and permission vocabulary is published as `PERMITS.md`.

- 25a845a: Unify Skills on `skills/<name>/SKILL.md`, support Agent-private Skills and nested Skill-private Tools, publish and mount existing plugin Skills, add governed Skill metadata and Turn access filtering, unlock only already-admitted same-owner Tools, and make `on-risk` and `once` approval behavior precise.
- ddbb92e: Isolate adapter Skills under platform-specific Agents and automatically select the matching platform Agent for IM ingress, preventing unrelated adapter Skills from entering another platform's prompt surface.
- 4380cf9: Colocate adapter command definitions and Agent Skill handlers with their owning capabilities, and provide a shared validated platform permission constructor.
- bc0df3c: Require the canonical expanded Discord endpoint configuration. The protocol no longer reinterprets nested `endpoints` or reads endpoint identity and token from `process.env`. The public config type is now `DiscordEndpointConfig`, and each schema entry uses `id` as its identity.
- 5c3858e: Make `@zhin.js/im-contract` the explicit zero-dependency owner of transport identities, canonical segments, media guards, conversation facts, stores, and delivery contracts. Platform adapters now read media contracts from that foundation instead of reaching through Core.
- 33ea736: Use `tools/<name>/index.ts` and `defineAgentTool` from `@zhin.js/tool` as the sole Agent Tool authoring model. Remove the duplicate `@zhin.js/tools` definition, context, bridge, export, and discovery path; migrate plugin manifests, examples, scaffolding, HMR, and prepack compilation to the generation-owned Tool Feature.
- Updated dependencies [c861789]
- Updated dependencies [1414ccb]
- Updated dependencies [743d470]
- Updated dependencies [62dee52]
- Updated dependencies [cd54131]
- Updated dependencies [244e475]
- Updated dependencies [a9e4a40]
- Updated dependencies [5855db7]
- Updated dependencies [ec921d2]
- Updated dependencies [8740059]
- Updated dependencies [63d1f7a]
- Updated dependencies [25a845a]
- Updated dependencies [103f2c3]
- Updated dependencies [9110ab8]
- Updated dependencies [cd2a888]
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
- Updated dependencies [2dbbc15]
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
- Updated dependencies [6b70e46]
- Updated dependencies [135ac91]
- Updated dependencies [140cf0f]
- Updated dependencies [251e4d2]
- Updated dependencies [203ad34]
- Updated dependencies [e6c5113]
- Updated dependencies [e0f6478]
- Updated dependencies [baef56b]
- Updated dependencies [698f16f]
- Updated dependencies [da0a8e3]
- Updated dependencies [2fd8017]
- Updated dependencies [5c3858e]
- Updated dependencies [33ea736]
- Updated dependencies [507d602]
- Updated dependencies [df9f76b]
  - @zhin.js/core@1.1.37
  - @zhin.js/tool@1.1.1
  - @zhin.js/host-http@1.1.1
  - @zhin.js/adapter@1.1.14
  - @zhin.js/feature-kit@1.1.1
  - @zhin.js/agent-feature@1.1.1
  - @zhin.js/skill@1.1.1
  - @zhin.js/logger@1.1.1
  - @zhin.js/im-contract@1.1.1
  - @zhin.js/permission@1.1.1

## 1.1.1

### Patch Changes

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
  - @zhin.js/host-http@1.1.0
  - @zhin.js/im-contract@1.1.0
  - @zhin.js/logger@1.1.0
  - @zhin.js/permission@1.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [f7ee28d]
  - @zhin.js/adapter@1.2.2
  - @zhin.js/core@1.5.16
  - zhin.js@7.0.1
  - @zhin.js/agent@1.2.1

## 9.0.0

### Patch Changes

- Updated dependencies [12325e1]
- Updated dependencies [d19e976]
  - @zhin.js/agent@1.2.0
  - zhin.js@7.0.0

## 8.0.8

### Patch Changes

- Updated dependencies [a728a20]
  - @zhin.js/host-http@1.0.17
  - @zhin.js/agent@1.1.22
  - zhin.js@6.0.15

## 8.0.7

### Patch Changes

- Updated dependencies [337fd05]
  - @zhin.js/agent@1.1.21
  - zhin.js@6.0.15

## 8.0.6

### Patch Changes

- Updated dependencies [fcbff21]
  - @zhin.js/host-http@1.0.16
  - zhin.js@6.0.15

## 8.0.5

### Patch Changes

- Updated dependencies [882a08a]
  - @zhin.js/agent@1.1.20
  - zhin.js@6.0.15
  - @zhin.js/core@1.5.15

## 8.0.4

### Patch Changes

- Updated dependencies [d85eddd]
  - @zhin.js/agent@1.1.19
  - @zhin.js/host-http@1.0.15
  - @zhin.js/core@1.5.15
  - zhin.js@6.0.15

## 8.0.3

### Patch Changes

- Updated dependencies [a5ee497]
- Updated dependencies [a5ee497]
- Updated dependencies [ba7e17a]
- Updated dependencies [7108d0b]
  - @zhin.js/agent@1.1.18
  - @zhin.js/host-http@1.0.14
  - @zhin.js/core@1.5.15
  - zhin.js@6.0.15

## 8.0.2

### Patch Changes

- Updated dependencies [736fa04]
  - @zhin.js/agent@1.1.17
  - zhin.js@6.0.14

## 8.0.1

### Patch Changes

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
  - @zhin.js/core@1.5.14
  - @zhin.js/host-http@1.0.13
  - @zhin.js/command@1.0.16
  - @zhin.js/logger@1.0.77
  - zhin.js@6.0.14
  - @zhin.js/feature-kit@1.0.13
  - @zhin.js/permission@1.0.4

## 8.0.0

### Patch Changes

- f2c532f: Expose exact per-Endpoint message operations through one validated Adapter capability model, route Core control calls through declared active capabilities, and connect existing recall, edit, reaction, and typing implementations across platform adapters.
- Updated dependencies [b10d058]
- Updated dependencies [f2c532f]
- Updated dependencies [3dbf990]
  - @zhin.js/host-http@1.0.12
  - @zhin.js/adapter@1.2.0
  - @zhin.js/core@1.5.13
  - @zhin.js/agent@1.1.15
  - zhin.js@6.0.13

## 7.0.14

### Patch Changes

- 5969c5b: Remove legacy compound-string message targets and Endpoint control probing. Endpoint control and outbound Host operations now carry structured `MessageRef` identities. Endpoint send has one exact result contract (a platform message id), which IM Runtime projects into `DeliveryReceipt.message`; arbitrary result guessing is removed.
- 9a64283: Add canonical scoped Discord message resolution with structured attachment media references.
- 974772e: Replace the user-facing `Prompt` vocabulary with the `UserInteraction` authoring surface for input, confirmation, and selection. Commands and handlers now expose `interaction`; IM Runtime exposes `createInteraction`; schema-driven endpoint collection is named `SchemaInteraction`. The old prompt-named interaction types and properties are removed rather than aliased. User interactions render through one canonical Markdown and keyboard/list presentation module shared by commands and Agent `ask_user` turns.

  Extract the transport-neutral interaction contract into `@zhin.js/interaction`. A discriminated `ask()` API supports text, number, confirmation, single-select, multi-select, and typed lists with structured `title`, `description`, and `tip` content. Typed `sequence()` interactions return one result object keyed by step id, render progress, and retry invalid replies without leaking invalid values to callers.

  Preserve AI Markdown and card command actions through outbound publishing. QQ delivers Markdown with native command buttons; KOOK, Discord, Telegram, DingTalk, and Lark/Feishu now declare and encode their native Markdown dialects while retaining each adapter's interaction policy. Correct QQ callback button action encoding and button style mapping.

- 5969c5b: Add SideEventGateway so adapters forward notice/request/system into HandlerIndex. HandlerContext now exposes only generation-safe capabilities and prompt ports; live Endpoint escape hatches are removed.
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
  - @zhin.js/host-http@1.0.11
  - @zhin.js/command@1.0.15
  - zhin.js@6.0.12
  - @zhin.js/permission@1.0.3

## 7.0.13

### Patch Changes

- @zhin.js/core@1.5.11
- @zhin.js/agent@1.1.13
- zhin.js@6.0.11

## 7.0.12

### Patch Changes

- 3556601: Declare Stable Feature packages referenced by `zhin.features` as optional `peerDependencies` on official plugins/adapters (`@zhin.js/runtime` ≥1.0.12 requires features to be declared in deps/peers). Keeps authoring via `zhin.js` facades without installing Feature implementation packages into `dependencies`, and removes the need for consumer postinstall peer-patch scripts. `zhin new` scaffolds the same peer shape.
  - @zhin.js/agent@1.1.12
  - @zhin.js/core@1.5.10
  - zhin.js@6.0.10

## 7.0.11

### Patch Changes

- eb84b77: fix: 更新文档,建立正确的依赖关系
- Updated dependencies [d3920e9]
  - @zhin.js/core@1.5.10
  - zhin.js@6.0.10
  - @zhin.js/adapter@1.1.10
  - @zhin.js/agent@1.1.11

## 7.0.10

### Patch Changes

- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/command@1.0.13
  - @zhin.js/host-http@1.0.10
  - @zhin.js/agent@1.1.10
  - @zhin.js/core@1.5.9
  - @zhin.js/adapter@1.1.9
  - zhin.js@6.0.9

## 7.0.9

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
  - @zhin.js/host-http@1.0.9
  - @zhin.js/agent@1.1.9
  - zhin.js@6.0.8
  - @zhin.js/command@1.0.12
  - @zhin.js/permission@1.0.2

## 7.0.8

### Patch Changes

- Updated dependencies [36cb1ca]
  - @zhin.js/core@1.5.7
  - @zhin.js/agent@1.1.8
  - zhin.js@6.0.7

## 7.0.7

### Patch Changes

- Updated dependencies [7945544]
  - @zhin.js/command@1.0.11
  - @zhin.js/agent@1.1.7
  - @zhin.js/adapter@1.1.7
  - @zhin.js/core@1.5.6
  - zhin.js@6.0.6

## 7.0.6

### Patch Changes

- Updated dependencies [2d0a622]
  - @zhin.js/command@1.0.10
  - @zhin.js/adapter@1.1.7
  - @zhin.js/core@1.5.5
  - @zhin.js/agent@1.1.6
  - zhin.js@6.0.5

## 7.0.5

### Patch Changes

- 51015d6: refactor(adapters): migrate platform-permit to PermissionSubject

  All adapter platform-permit checkers now accept PermissionSubject
  (duck-typed from Message/CommandSession) instead of Message directly.
  registerPlatformPermitChecker is replaced by host.registerPlatform in
  the adapter plugin setup. activity-feedback service updated for new
  PermissionHost integration.

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
  - @zhin.js/host-http@1.0.8
  - @zhin.js/permission@1.0.1
  - @zhin.js/im-contract@1.0.3
  - @zhin.js/adapter@1.1.7
  - @zhin.js/plugin-runtime@1.1.5
  - @zhin.js/command@1.0.9
  - @zhin.js/core@1.5.4
  - zhin.js@6.0.4

## 7.0.4

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/logger@1.0.76
  - @zhin.js/host-http@1.0.7
  - @zhin.js/adapter@1.1.6
  - @zhin.js/agent@1.1.4
  - @zhin.js/command@1.0.8
  - @zhin.js/core@1.5.3
  - @zhin.js/im-contract@1.0.2
  - @zhin.js/plugin-runtime@1.1.4
  - zhin.js@6.0.3

## 7.0.3

### Patch Changes

- Updated dependencies [afc0e66]
- Updated dependencies [2e41ad5]
- Updated dependencies [9f57124]
  - @zhin.js/core@1.5.2
  - @zhin.js/adapter@1.1.5
  - @zhin.js/im-contract@1.0.1
  - @zhin.js/plugin-runtime@1.1.3
  - @zhin.js/command@1.0.7
  - @zhin.js/host-http@1.0.6
  - @zhin.js/agent@1.1.3
  - zhin.js@6.0.2

## 7.0.2

### Patch Changes

- Updated dependencies [696ab1b]
  - @zhin.js/agent@1.1.2
  - zhin.js@6.0.1

## 7.0.1

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/host-http@1.0.5
  - @zhin.js/adapter@1.1.4
  - @zhin.js/agent@1.1.1
  - @zhin.js/command@1.0.6
  - @zhin.js/core@1.5.1
  - zhin.js@6.0.1

## 7.0.0

### Patch Changes

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

## 6.0.6

### Patch Changes

- d52f3c5: fix: QQ 适配器群聊误识别为私聊、game-kit 启动崩溃、全面补齐 recallMessage

  - fix(cli): `resolveChannelType` 增加 `metadata.channelKind` 检查，修复 QQ/Discord/KOOK 群聊消息被误分类为私聊
  - fix(game-kit): `createHostGameDb` 改用延迟代理模型，避免数据库启动前解析模型导致崩溃
  - feat(qq): 实现 `recallMessage`，解析复合 messageId 路由到对应 SDK 撤回方法；`normalizeQqMessage` 增加 `message_type` 缺失时的回退检测
  - feat(slack): 实现 `recallMessage`，利用已有 compound ref 和 `chat.delete` API
  - feat(onebot11): 两个 endpoint 类实现 `recallMessage`（`delete_msg`）
  - feat(onebot12): 两个 endpoint 类实现 `recallMessage`（`delete_message`）
  - feat(napcat): 三个 endpoint 类实现 `recallMessage`（`delete_msg`）
  - feat(discord): 两个 endpoint 类实现 `recallMessage`；`send()` 改为返回 `channelId:snowflake` 复合 ID
  - feat(telegram): 实现 `recallMessage`（`deleteMessage`）；`send()` 改为返回 `chatId:messageId` 复合 ID
  - feat(kook): 两个 endpoint 类实现 `recallMessage`，利用 kook-client `recallMsg` API
  - feat(lark): 实现 `recallMessage`（`DELETE /im/v1/messages/{id}`）
  - feat(wecom): 实现 `recallMessage`（`POST /cgi-bin/message/recall`）

## 6.0.5

### Patch Changes

- Updated dependencies [d8bf702]
  - @zhin.js/host-http@1.0.4
  - @zhin.js/agent@1.0.10
  - @zhin.js/core@1.4.3
  - zhin.js@5.0.3

## 6.0.4

### Patch Changes

- Updated dependencies [45b3256]
  - @zhin.js/core@1.4.3
  - @zhin.js/agent@1.0.9
  - zhin.js@5.0.3

## 6.0.3

### Patch Changes

- Updated dependencies [f346346]
  - @zhin.js/agent@1.0.8
  - @zhin.js/core@1.4.2
  - zhin.js@5.0.2

## 6.0.2

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

## 6.0.1

### Patch Changes

- 5691aba: 第二轮全量审计修复批（8 面 ~60 bug）：

  - **安全**：email 附件路径穿越修复（basename + downloadPath 约束）；lark/telegram/satori webhook 鉴权（缺密钥告警、timingSafeEqual、±5min 时效窗、chat_type 修正）；onebot wss/webhook 缺 token 告警；qq webhook 改原始字节验签；renderJsx/JSX 转义注入修复；console runtime token 401 死循环。
  - **P0 功能**：sandbox 多 endpoint 解析 + WS 路径隔离；short-url expand（undici opaqueredirect）改 follow；AI 压缩摘要失败不再静默丢历史（熔断恢复生效）；console-ui 实时推送事件名归一化 + IndexedDB schema 对齐；process-monitor 热重载不再误判崩溃。
  - **生命周期**：email IMAP 断线重连 + 在飞锁；onebot11/12 start 失败清理；line replyToken TTL + push 兜底；wechat-mp token 过期重试 + MsgId 去重；weixin-ilink buf 推进/防抖写盘/媒体 TTL/QR abort；satori PONG 看门狗；退避自毁修复。
  - **游戏**：text-adventure 终局 restart 复活 + requires 服务端校验；tic-tac-toe PvP 占用/restart/队列清理/TTL；idiom-chain/word-riddle 闲聊不扣失误；别名中间件不劫持普通聊天。
  - **共享库**：schema falsy 默认值/date/tuple/union 修复；database parseCondition Date/未知操作符、sqlite TEXT 往返、query 分派、belongsToMany 方言、migration dry-run；schedule DST 回拨死循环、重复 id 去重、flush 串行化；game-kit fallback 编号/onboarding 提示/尾缀边界/活引用拷贝。
  - **渲染语音**：fetch 全部超时 + 渲染并发闸；sanitizeHtml form 保文本；STT 扩展名映射 + 删临时文件；TTS 未知 provider 报错；emojiCache LRU 负缓存/fontCache style/clearFonts 恢复；register 错误分类收窄。

- 74b035c: endpoint 管理命令扩展至 18/20 适配器：kook / discord / github（private_key 支持内联文件路径）/ icqq（bindFlow 登记式 add + `icqq login` 引导）/ dingtalk / lark / line / satori / wechat-mp / wecom / weixin-ilink 接入 `endpoint list/add/remove`（字段对齐各自 schema，凭据写 `.env`）。email（smtp/imap 嵌套对象）与 sandbox（无凭据）暂不接。
- 09d4f25: Console 社交读取面（management 语义端口）多平台落地：napcat/onebot11/onebot12/milky（好友+群+群成员，OneBot 标准动作）；discord/kook/satori（guild+频道+成员，分页聚合，id 保精度留字符串）；slack（workspace 成员+public channels+conversations.members）；line（群/room 成员分页+profile 回退）；wechat-mp（followers openid）；weixin-ilink（context_token 对端推导）；lark（chats+members 全分页）。`EndpointFriend.user_id`/`EndpointGroup.group_id` 放宽为 `number | string`（雪花 id 不丢精度）。telegram/wecom/dingtalk/github/email/sandbox 注明平台无列表面暂不接。
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
  - @zhin.js/host-http@1.0.3
  - zhin.js@5.0.1
  - @zhin.js/adapter@1.1.1
  - @zhin.js/core@1.4.1

## 6.0.0

### Patch Changes

- 7db69c1: 命令前缀改为适配器配置项：`MessageDispatcher` 不再硬编码 `/`，默认按消息所属适配器实例 config 的 `commandPrefix` 解析（默认 `''` 无前缀，任意文本按命令匹配），`endpoints[i].commandPrefix` 逐项覆盖；`ImRuntime({ commandPrefix })` 仍可设全局静态前缀。全部 20 个平台适配器 schema 新增 `commandPrefix` 属性。

  BREAKING（行为变化）：未配置时命令不再需要 `/` 前缀——原 `/zt` 写法不再命中，直接发 `zt` 即可；需要斜杠风格的适配器请在配置里显式设 `commandPrefix: '/'`。

- 713445c: 适配器配置格式定稿（不兼容旧格式）：`plugins.<adapter>` 顶层仅共享字段 + `commandPrefix`，`endpoints[i]` 携带 endpoint 级字段（`name` + 凭据，各 schema 已类型化），`endpoints` 为必填（icqq 另需顶层 `master`）；icqq 新增 `trusted` 列表（顶层/逐项均可）。scaffold-wizard 全部字段式与自定义 configure() 产出改为新格式，examples（full-bot / qq-games-bot）与 20 个适配器 README 同步迁移。
- Updated dependencies [7db69c1]
- Updated dependencies [e5c84ed]
- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
- Updated dependencies [ac9da66]
  - @zhin.js/core@1.4.0
  - @zhin.js/adapter@1.1.0
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/agent@1.0.5
  - @zhin.js/host-http@1.0.2
  - zhin.js@5.0.0

## 5.0.3

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
  - @zhin.js/host-http@1.0.1
  - zhin.js@4.1.3
  - @zhin.js/logger@1.0.75
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/adapter@1.0.1

## 5.0.2

### Patch Changes

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/agent@1.0.3
  - @zhin.js/client@2.0.5
  - @zhin.js/contract@1.0.3
  - @zhin.js/host-api@2.0.5
  - @zhin.js/host-router@2.0.3
  - zhin.js@4.1.2

## 5.0.1

### Patch Changes

- 5cc9c03: fix: ai 优化
- b9b3881: fix: 增加游戏引擎以及部分游戏
- 7700903: fix: 游戏强化
- Updated dependencies [5cc9c03]
- Updated dependencies [7700903]
  - @zhin.js/client@2.0.4
  - @zhin.js/contract@1.0.2
  - @zhin.js/host-api@2.0.4
  - @zhin.js/host-router@2.0.2
  - zhin.js@4.1.1

## 5.0.0

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化
- Updated dependencies [c4575c9]
- Updated dependencies [c4575c9]
  - @zhin.js/host-router@2.0.1
  - @zhin.js/host-api@2.0.3
  - zhin.js@4.1.0

## 4.0.2

### Patch Changes

- Updated dependencies [384ea11]
  - @zhin.js/host-api@2.0.2
  - zhin.js@4.0.1

## 4.0.1

### Patch Changes

- Updated dependencies [93e58d9]
- Updated dependencies [ae5239c]
  - @zhin.js/host-api@2.0.1
  - zhin.js@4.0.1
  - @zhin.js/host-router@2.0.0

## 4.0.0

### Patch Changes

- zhin.js@3.0.0
- @zhin.js/host-api@2.0.0
- @zhin.js/host-router@2.0.0

## 3.0.1

### Patch Changes

- d8def69: fix: 性能优化
- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - @zhin.js/host-router@1.0.1
  - @zhin.js/host-api@1.0.1
  - zhin.js@2.0.1
  - @zhin.js/client@2.0.3

## 3.0.0

### Patch Changes

- Updated dependencies [65f4b0a]
  - @zhin.js/host-api@1.0.0
  - zhin.js@2.0.0
  - @zhin.js/host-router@1.0.0

## 2.0.11

### Patch Changes

- Updated dependencies [d8547d2]
  - zhin.js@1.0.92
  - @zhin.js/host-router@0.0.3

## 2.0.10

### Patch Changes

- Updated dependencies [3735e96]
- Updated dependencies [238de62]
  - @zhin.js/host-api@0.0.4
  - zhin.js@1.0.91
  - @zhin.js/host-router@0.0.3

## 2.0.9

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - @zhin.js/client@2.0.2
  - @zhin.js/contract@1.0.1
  - @zhin.js/host-api@0.0.3
  - @zhin.js/host-router@0.0.3
  - zhin.js@1.0.90

## 2.0.8

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新
- Updated dependencies [c78d2cd]
  - @zhin.js/client@2.0.1
  - @zhin.js/host-router@0.0.2
  - zhin.js@1.0.89
  - @zhin.js/host-api@0.0.2

## 2.0.7

### Patch Changes

- Updated dependencies [ccb6e24]
  - zhin.js@1.0.88

## 2.0.6

### Patch Changes

- 90d9efd: fix: 处理包名
  - zhin.js@1.0.87
  - @zhin.js/host-api@0.0.1
  - @zhin.js/host-router@0.0.1

## 2.0.5

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [7e14f8d]
  - @zhin.js/client@1.1.4
  - zhin.js@1.0.86
  - @zhin.js/console@3.0.5
  - @zhin.js/host-router@1.0.79

## 2.0.4

### Patch Changes

- zhin.js@1.0.85
- @zhin.js/console@3.0.4
- @zhin.js/host-router@1.0.78

## 2.0.3

### Patch Changes

- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
  - @zhin.js/console@3.0.3
  - zhin.js@1.0.84
  - @zhin.js/client@1.1.3
  - @zhin.js/host-router@1.0.77

## 2.0.2

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/console@3.0.2
  - @zhin.js/host-router@1.0.76
  - @zhin.js/client@1.1.2
  - zhin.js@1.0.83

## 2.0.1

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/console@3.0.1
  - @zhin.js/host-router@1.0.75
  - @zhin.js/client@1.1.1
  - zhin.js@1.0.82

## 2.0.0

### Patch Changes

- Updated dependencies
  - @zhin.js/client@1.1.0
  - @zhin.js/console@3.0.0

## 1.0.87

### Patch Changes

- Updated dependencies [8086ccb]
  - zhin.js@1.0.81
  - @zhin.js/console@2.0.24
  - @zhin.js/host-router@1.0.74

## 1.0.86

### Patch Changes

- zhin.js@1.0.80
- @zhin.js/console@2.0.23
- @zhin.js/host-router@1.0.73

## 1.0.85

### Patch Changes

- zhin.js@1.0.79
- @zhin.js/console@2.0.22
- @zhin.js/host-router@1.0.72

## 1.0.84

### Patch Changes

- Updated dependencies [88caeb2]
  - @zhin.js/console@2.0.21
  - zhin.js@1.0.78
  - @zhin.js/host-router@1.0.71

## 1.0.83

### Patch Changes

- zhin.js@1.0.77
- @zhin.js/console@2.0.20
- @zhin.js/host-router@1.0.70

## 1.0.82

### Patch Changes

- Updated dependencies [cb9fbf1]
  - zhin.js@1.0.76
  - @zhin.js/console@2.0.19
  - @zhin.js/host-router@1.0.69

## 1.0.81

### Patch Changes

- zhin.js@1.0.75
- @zhin.js/console@2.0.18
- @zhin.js/host-router@1.0.68

## 1.0.80

### Patch Changes

- Updated dependencies [c9dec38]
  - zhin.js@1.0.74
  - @zhin.js/console@2.0.17
  - @zhin.js/host-router@1.0.67

## 1.0.79

### Patch Changes

- f1e9a76: fix: 提高 skill 质量
  - zhin.js@1.0.73
  - @zhin.js/console@2.0.16
  - @zhin.js/host-router@1.0.66

## 1.0.78

### Patch Changes

- Updated dependencies [21efca3]
  - @zhin.js/console@2.0.15

## 1.0.77

### Patch Changes

- abc75a4: fix: 优化,客户端构建优化
- Updated dependencies [abc75a4]
  - @zhin.js/console@2.0.14

## 1.0.76

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - @zhin.js/client@1.0.18
  - zhin.js@1.0.72
  - @zhin.js/console@2.0.13
  - @zhin.js/host-router@1.0.65

## 1.0.75

### Patch Changes

- Updated dependencies [60b1a4d]
  - @zhin.js/console@2.0.12

## 1.0.74

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - @zhin.js/client@1.0.17
  - zhin.js@1.0.71
  - @zhin.js/console@2.0.11
  - @zhin.js/host-router@1.0.64

## 1.0.73

### Patch Changes

- zhin.js@1.0.68
- @zhin.js/console@2.0.10
- @zhin.js/host-router@1.0.63

## 1.0.72

### Patch Changes

- Updated dependencies [0eba6d6]
  - @zhin.js/host-router@1.0.62
  - zhin.js@1.0.67
  - @zhin.js/console@2.0.9

## 1.0.71

### Patch Changes

- zhin.js@1.0.66
- @zhin.js/console@2.0.8
- @zhin.js/host-router@1.0.61

## 1.0.70

### Patch Changes

- zhin.js@1.0.65
- @zhin.js/console@2.0.7
- @zhin.js/host-router@1.0.60

## 1.0.69

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - @zhin.js/client@1.0.16
  - zhin.js@1.0.64
  - @zhin.js/console@2.0.6
  - @zhin.js/host-router@1.0.59

## 1.0.68

### Patch Changes

- ba30934: fix: web 优化
- Updated dependencies [ba30934]
  - @zhin.js/console@2.0.5
  - @zhin.js/host-router@1.0.58
  - zhin.js@1.0.63

## 1.0.67

### Patch Changes

- zhin.js@1.0.62
- @zhin.js/host-router@1.0.57

## 1.0.66

### Patch Changes

- zhin.js@1.0.61
- @zhin.js/host-router@1.0.56

## 1.0.65

### Patch Changes

- 5073d4c: chore: chore: update TypeScript version to ^5.9.3 across all plugins and packages
  feat: enhance ai-text-as-image output registration with off handler for cleanup
  fix: remove unnecessary logging in ensureBuiltinFontsCached function
  refactor: simplify action handlers in html-renderer tools
  chore: add README files for queue-sandbox-poc and event-delivery packages
  chore: adjust pnpm workspace configuration to exclude games directory
  chore: update tsconfig to include plugins directory for TypeScript compilation
- Updated dependencies [5073d4c]
  - zhin.js@1.0.60
  - @zhin.js/host-router@1.0.55

## 1.0.64

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - zhin.js@1.0.59
  - @zhin.js/host-router@1.0.54

## 1.0.63

### Patch Changes

- zhin.js@1.0.58
- @zhin.js/host-router@1.0.53

## 1.0.62

### Patch Changes

- zhin.js@1.0.57
- @zhin.js/host-router@1.0.52

## 1.0.61

### Patch Changes

- zhin.js@1.0.56
- @zhin.js/host-router@1.0.51

## 1.0.60

### Patch Changes

- zhin.js@1.0.55
- @zhin.js/host-router@1.0.50

## 1.0.59

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - zhin.js@1.0.54
  - @zhin.js/host-router@1.0.49

## 1.0.58

### Patch Changes

- zhin.js@1.0.53
- @zhin.js/host-router@1.0.48

## 1.0.57

### Patch Changes

- a3511a0: 各包内 Agent 技能说明已固定为随包发布的 `skills/*/SKILL.md`（替代已移除的运行时 `declareSkill`）。本批为 registry / 分发侧对齐的 **patch** 版本递增。
- Updated dependencies [a3511a0]
  - @zhin.js/host-router@1.0.47

## 1.0.56

### Patch Changes

- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - zhin.js@1.0.52
  - @zhin.js/host-router@1.0.46

## 1.0.55

### Patch Changes

- zhin.js@1.0.51
- @zhin.js/host-router@1.0.45

## 1.0.54

### Patch Changes

- zhin.js@1.0.50
- @zhin.js/host-router@1.0.44

## 1.0.53

### Patch Changes

- zhin.js@1.0.49
- @zhin.js/host-router@1.0.43

## 1.0.52

### Patch Changes

- zhin.js@1.0.48
- @zhin.js/host-router@1.0.42

## 1.0.51

### Patch Changes

- Updated dependencies [de3e352]
  - zhin.js@1.0.47
  - @zhin.js/host-router@1.0.41

## 1.0.50

### Patch Changes

- Updated dependencies [7394603]
  - zhin.js@1.0.46
  - @zhin.js/host-router@1.0.40

## 1.0.49

### Patch Changes

- zhin.js@1.0.45
- @zhin.js/host-router@1.0.39

## 1.0.48

### Patch Changes

- zhin.js@1.0.44
- @zhin.js/host-router@1.0.38

## 1.0.47

### Patch Changes

- Updated dependencies [72ec4ba]
  - @zhin.js/host-router@1.0.37
  - zhin.js@1.0.43

## 1.0.46

### Patch Changes

- zhin.js@1.0.42
- @zhin.js/host-router@1.0.36

## 1.0.45

### Patch Changes

- zhin.js@1.0.41
- @zhin.js/host-router@1.0.35

## 1.0.44

### Patch Changes

- 7ef9057: fix: 架构调整优化
- Updated dependencies [7ef9057]
  - zhin.js@1.0.40
  - @zhin.js/host-router@1.0.34

## 1.0.43

### Patch Changes

- zhin.js@1.0.39
- @zhin.js/host-router@1.0.33

## 1.0.42

### Patch Changes

- ab5c54a: fix: ai 架构优化
- Updated dependencies [ab5c54a]
  - zhin.js@1.0.38
  - @zhin.js/host-router@1.0.32

## 1.0.41

### Patch Changes

- Updated dependencies [631da6e]
  - @zhin.js/host-router@1.0.31

## 1.0.40

### Patch Changes

- bb0be4c: fix: 平台能力增强

## 1.0.39

### Patch Changes

- zhin.js@1.0.37
- @zhin.js/host-router@1.0.30

## 1.0.38

### Patch Changes

- Updated dependencies [432d0a5]
- Updated dependencies [6d94111]
  - @zhin.js/host-router@1.0.29
  - zhin.js@1.0.36

## 1.0.37

### Patch Changes

- zhin.js@1.0.35
- @zhin.js/host-router@1.0.28

## 1.0.36

### Patch Changes

- zhin.js@1.0.34
- @zhin.js/host-router@1.0.27

## 1.0.35

### Patch Changes

- zhin.js@1.0.33
- @zhin.js/host-router@1.0.26

## 1.0.34

### Patch Changes

- Updated dependencies [48481a8]
  - @zhin.js/host-router@1.0.25

## 1.0.33

### Patch Changes

- zhin.js@1.0.32
- @zhin.js/host-router@1.0.24

## 1.0.32

### Patch Changes

- zhin.js@1.0.31
- @zhin.js/host-router@1.0.23

## 1.0.31

### Patch Changes

- Updated dependencies [460a6c6]
  - zhin.js@1.0.30
  - @zhin.js/host-router@1.0.22

## 1.0.30

### Patch Changes

- zhin.js@1.0.29
- @zhin.js/host-router@1.0.21

## 1.0.29

### Patch Changes

- Updated dependencies [05a514d]
  - @zhin.js/host-router@1.0.20
  - zhin.js@1.0.28

## 1.0.28

### Patch Changes

- Updated dependencies [2b44e18]
  - @zhin.js/host-router@1.0.19

## 1.0.27

### Patch Changes

- Updated dependencies [b27e633]
  - @zhin.js/host-router@1.0.18
  - zhin.js@1.0.27

## 1.0.26

### Patch Changes

- 106d357: fix: ai
- Updated dependencies [106d357]
  - @zhin.js/host-router@1.0.17
  - zhin.js@1.0.26

## 1.0.25

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai
- Updated dependencies [26d2942]
- Updated dependencies [6b02c41]
  - zhin.js@1.0.25
  - @zhin.js/host-router@1.0.16

## 1.0.24

### Patch Changes

- zhin.js@1.0.24
- @zhin.js/host-router@1.0.15

## 1.0.23

### Patch Changes

- 52ae08a: fix: 更新消息处理流程
- Updated dependencies [52ae08a]
  - zhin.js@1.0.23
  - @zhin.js/host-router@1.0.14

## 1.0.22

### Patch Changes

- Updated dependencies [26aba27]
  - zhin.js@1.0.22
  - @zhin.js/host-router@1.0.13

## 1.0.21

### Patch Changes

- zhin.js@1.0.21
- @zhin.js/host-router@1.0.12

## 1.0.20

### Patch Changes

- a3b7673: fix: 调整依赖项
- 5141137: fix: 修复适配器读取配置 bug
- Updated dependencies [a3b7673]
- Updated dependencies [5141137]
  - @zhin.js/host-router@1.0.11
  - zhin.js@1.0.20

## 1.0.19

### Patch Changes

- f9faa1d: fix: test release
- Updated dependencies [f9faa1d]
  - zhin.js@1.0.19
  - @zhin.js/host-router@1.0.10

## 1.0.18

### Patch Changes

- d16a69c: fix: test trust publish
- Updated dependencies [d16a69c]
  - zhin.js@1.0.18
  - @zhin.js/host-router@1.0.9

## 1.0.17

### Patch Changes

- zhin.js@1.0.17

## 1.0.16

### Patch Changes

- zhin.js@1.0.16

## 1.0.15

### Patch Changes

- f9e75ce: fix: 一致性调整,文档调整
- f9e75ce: fix: recall,文档统一,mcp,githubnotifiy
  - zhin.js@1.0.15

## 1.0.14

### Patch Changes

- 547028f: fix: 优化包结构,优化客户端支持
- Updated dependencies [547028f]
  - @zhin.js/types@1.0.5
  - zhin.js@1.0.14

## 1.0.13

### Patch Changes

- zhin.js@1.0.13

## 1.0.12

### Patch Changes

- zhin.js@1.0.12

## 1.0.11

### Patch Changes

- zhin.js@1.0.11

## 1.0.10

### Patch Changes

- Updated dependencies [c8c3996]
  - @zhin.js/types@1.0.4
  - zhin.js@1.0.10

## 1.0.9

### Patch Changes

- c490260: fix: 更新脚手架结构,优化包依赖
  - zhin.js@1.0.9

## 1.0.8

### Patch Changes

- 551c4d2: fix: 插件支持配置文件读取,优化 test 用例
- Updated dependencies [551c4d2]
  - @zhin.js/types@1.0.3
  - zhin.js@1.0.8

## 1.0.7

### Patch Changes

- zhin.js@1.0.7

## 1.0.6

### Patch Changes

- c2d9047: fix: 优化中间件逻辑
  - zhin.js@1.0.6

## 1.0.5

### Patch Changes

- zhin.js@1.0.5

## 1.0.4

### Patch Changes

- zhin.js@1.0.4

## 1.0.3

### Patch Changes

- 89bc676: fix: 类型反射优化
- Updated dependencies [89bc676]
  - @zhin.js/types@1.0.2
  - zhin.js@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies [15fc934]
  - zhin.js@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies [efdd58a]
  - @zhin.js/types@1.0.1
  - zhin.js@1.0.1
