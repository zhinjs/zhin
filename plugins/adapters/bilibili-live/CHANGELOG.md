# @zhin.js/adapter-bilibili-live

## 0.1.7

### Patch Changes

- cbf1fb1: Unify Console page blueprints (`definePageBlueprint`, `defineAdapterPage`, `defineCommentReviewPage`, `projectBlueprintToImCard`, `projectBlueprintToCliPanel`) into `@zhin.js/console-contract` and `@zhin.js/page`, add zero-esbuild pure Blueprint synthesis + static client bundle mounting to `@zhin.js/pagemanager`, remove `@zhin.js/client` (React 19) and `.tsx` from all 30 server-side plugins and adapters (including `bilibili` and `juejin`), and remove legacy Era-1 Koa `PageManager` code.
- Updated dependencies [cbf1fb1]
- Updated dependencies [008ccad]
- Updated dependencies [a1f1028]
  - @zhin.js/console-contract@1.1.4
  - @zhin.js/page@1.1.16
  - @zhin.js/core@1.1.58
  - @zhin.js/im-contract@1.1.13
  - @zhin.js/adapter@1.1.30
  - @zhin.js/feature-kit@1.1.14

## 0.1.6

### Patch Changes

- Updated dependencies [6163abc]
- Updated dependencies [fed2c27]
- Updated dependencies [bc6ccb1]
- Updated dependencies [72b5a12]
- Updated dependencies [4427e72]
- Updated dependencies [22bd14a]
  - @zhin.js/core@1.1.57
  - @zhin.js/client@1.1.25
  - @zhin.js/page@1.1.15
  - @zhin.js/im-contract@1.1.12
  - @zhin.js/adapter@1.1.29
  - @zhin.js/feature-kit@1.1.13

## 0.1.5

### Patch Changes

- 4fe49b5: 支持配置按需生效：分离保存与有效版本，独立变更先应用，账号资料更新保留连接，模型按回合使用确定版本；Console 返回结构化应用结果。监听改为仅显式 --watch 启用，开发模板显式选择源码和配置监听。

  自变更消费配置应用回执，避免已处理配置被二次重载；持久化本次写入修订和应用结果，未知结果或修订冲突时停止自动续作并保留现场，恢复不会覆盖未经本次变更确认的配置。

- Updated dependencies [b249e5e]
- Updated dependencies [57661f6]
- Updated dependencies [cbd3f14]
- Updated dependencies [299863a]
- Updated dependencies [aaa93d7]
- Updated dependencies [4fe49b5]
- Updated dependencies [cce07db]
- Updated dependencies [b652db3]
- Updated dependencies [0315ba0]
  - @zhin.js/core@1.1.56
  - @zhin.js/adapter@1.1.28
  - @zhin.js/im-contract@1.1.11
  - @zhin.js/feature-kit@1.1.12
  - @zhin.js/client@1.1.24
  - @zhin.js/page@1.1.14

## 0.1.4

### Patch Changes

- b88e988: Preserve account-profile write acknowledgements already observed before cancellation, distinguish native Discord REST rejection from unknown outcomes, and retain the last valid profile when a newer concurrent read fails. Keep scene-scoped SOUL presence consistent with the actual prompt and allow discovered URLs to pass through the existing network authorization policy.
- af8f803: Use the current Endpoint's platform profile for Agent account identity, with per-field configured fallbacks and scoped, identity-approved profile tools. Keep SOUL first-person and independent of account names. Profile ports preserve the source Client, cancellation, truthful update outcomes and private image authority.

  Adapter Feature API 2.1 and Tool Feature API 1.1 describe the additive profile requirements; new Core, official adapters and generated plugins declare the corresponding floors. Existing compatible API-2.0/API-1.0 plugins remain accepted by the newer providers. npm releases remain patch.

  Private IM assets now bind to the full canonical conversation and principal. Existing IM asset records that contain only the earlier lossy hash remain on disk until their original expiry, but cannot be safely rebound; recapture them. No automatic file deletion, platform profile mutation or workspace SOUL rewrite occurs during upgrade.

- Updated dependencies [b88e988]
- Updated dependencies [f78eb84]
- Updated dependencies [c15cef9]
- Updated dependencies [b0c02a2]
- Updated dependencies [af8f803]
- Updated dependencies [26fda97]
- Updated dependencies [976886c]
- Updated dependencies [032dc96]
  - @zhin.js/adapter@1.1.27
  - @zhin.js/client@1.1.23
  - @zhin.js/im-contract@1.1.10
  - @zhin.js/core@1.1.55
  - @zhin.js/page@1.1.13
  - @zhin.js/feature-kit@1.1.11

## 0.1.3

### Patch Changes

- Updated dependencies [5e878ba]
  - @zhin.js/page@1.1.12

## 0.1.2

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
  - @zhin.js/adapter@1.1.26
  - @zhin.js/feature-kit@1.1.10
  - @zhin.js/core@1.1.54
  - @zhin.js/client@1.1.22
  - @zhin.js/page@1.1.11

## 0.1.1

### Patch Changes

- Updated dependencies [6345a38]
- Updated dependencies [ff3efe7]
- Updated dependencies [c58c589]
  - @zhin.js/adapter@1.1.25
  - @zhin.js/client@1.1.21
  - @zhin.js/core@1.1.53
  - @zhin.js/im-contract@1.1.9
