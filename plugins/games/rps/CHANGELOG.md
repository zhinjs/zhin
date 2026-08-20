# @zhin.js/plugin-rps

## 1.0.19

### Patch Changes

- 3556601: Declare Stable Feature packages referenced by `zhin.features` as optional `peerDependencies` on official plugins/adapters (`@zhin.js/runtime` ≥1.0.12 requires features to be declared in deps/peers). Keeps authoring via `zhin.js` facades without installing Feature implementation packages into `dependencies`, and removes the need for consumer postinstall peer-patch scripts. `zhin new` scaffolds the same peer shape.
  - @zhin.js/core@1.5.10
  - zhin.js@6.0.10

## 1.0.18

### Patch Changes

- eb84b77: fix: 更新文档,建立正确的依赖关系
- Updated dependencies [d3920e9]
  - @zhin.js/core@1.5.10
  - zhin.js@6.0.10
  - @zhin.js/game-kit@3.0.10

## 1.0.17

### Patch Changes

- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/command@1.0.13
  - @zhin.js/core@1.5.9
  - @zhin.js/middleware@1.0.10
  - @zhin.js/game-kit@3.0.9

## 1.0.16

### Patch Changes

- Updated dependencies [63253bb]
- Updated dependencies [953cfe1]
- Updated dependencies [0e73866]
  - @zhin.js/plugin-runtime@1.1.6
  - @zhin.js/core@1.5.8
  - @zhin.js/game-kit@3.0.8
  - @zhin.js/command@1.0.12
  - @zhin.js/middleware@1.0.9

## 1.0.15

### Patch Changes

- Updated dependencies [36cb1ca]
  - @zhin.js/core@1.5.7
  - @zhin.js/game-kit@3.0.7

## 1.0.14

### Patch Changes

- Updated dependencies [7945544]
  - @zhin.js/command@1.0.11
  - @zhin.js/core@1.5.6
  - @zhin.js/game-kit@3.0.6

## 1.0.13

### Patch Changes

- Updated dependencies [2d0a622]
  - @zhin.js/command@1.0.10
  - @zhin.js/core@1.5.5
  - @zhin.js/game-kit@3.0.5

## 1.0.12

### Patch Changes

- Updated dependencies [c106ecc]
- Updated dependencies [ca92e03]
- Updated dependencies [b0f37ae]
- Updated dependencies [daffd4c]
- Updated dependencies [36c7400]
- Updated dependencies [162fa34]
- Updated dependencies [e40b048]
- Updated dependencies [f1708c3]
- Updated dependencies [e53444f]
- Updated dependencies [92b0dd7]
- Updated dependencies [a7df753]
  - @zhin.js/plugin-runtime@1.1.5
  - @zhin.js/command@1.0.9
  - @zhin.js/core@1.5.4
  - @zhin.js/game-kit@3.0.4
  - @zhin.js/middleware@1.0.8

## 1.0.11

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/game-kit@3.0.3
  - @zhin.js/command@1.0.8
  - @zhin.js/core@1.5.3
  - @zhin.js/middleware@1.0.7
  - @zhin.js/plugin-runtime@1.1.4

## 1.0.10

### Patch Changes

- Updated dependencies [afc0e66]
- Updated dependencies [9f57124]
  - @zhin.js/core@1.5.2
  - @zhin.js/plugin-runtime@1.1.3
  - @zhin.js/command@1.0.7
  - @zhin.js/game-kit@3.0.2
  - @zhin.js/middleware@1.0.6

## 1.0.9

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/game-kit@3.0.1
  - @zhin.js/command@1.0.6
  - @zhin.js/core@1.5.1
  - @zhin.js/middleware@1.0.5

## 1.0.8

### Patch Changes

- Updated dependencies [7c1e63a]
- Updated dependencies [4fbff5d]
- Updated dependencies [5b94d9c]
  - @zhin.js/command@1.0.5
  - @zhin.js/core@1.5.0
  - @zhin.js/game-kit@3.0.0

## 1.0.7

### Patch Changes

- Updated dependencies [d52f3c5]
  - @zhin.js/game-kit@2.0.4

## 1.0.6

### Patch Changes

- Updated dependencies [45b3256]
  - @zhin.js/core@1.4.3
  - @zhin.js/game-kit@2.0.3

## 1.0.5

### Patch Changes

- d5cd4aa: Publish Plugin Runtime entry points and convention modules as JavaScript so
  installed npm plugins load on Node without TypeScript stripping. Workspace
  development continues to prefer TypeScript sources for local HMR.

  Remove the unconsumed legacy game hub APIs from game-kit; game navigation and
  records now use ordinary convention commands owned by the game hub plugin.

- Updated dependencies [d5cd4aa]
  - @zhin.js/game-kit@2.0.2
  - @zhin.js/command@1.0.4
  - @zhin.js/middleware@1.0.4
  - @zhin.js/core@1.4.2

## 1.0.4

### Patch Changes

- 5691aba: 第二轮全量审计修复批（8 面 ~60 bug）：

  - **安全**：email 附件路径穿越修复（basename + downloadPath 约束）；lark/telegram/satori webhook 鉴权（缺密钥告警、timingSafeEqual、±5min 时效窗、chat_type 修正）；onebot wss/webhook 缺 token 告警；qq webhook 改原始字节验签；renderJsx/JSX 转义注入修复；console runtime token 401 死循环。
  - **P0 功能**：sandbox 多 endpoint 解析 + WS 路径隔离；short-url expand（undici opaqueredirect）改 follow；AI 压缩摘要失败不再静默丢历史（熔断恢复生效）；console-ui 实时推送事件名归一化 + IndexedDB schema 对齐；process-monitor 热重载不再误判崩溃。
  - **生命周期**：email IMAP 断线重连 + 在飞锁；onebot11/12 start 失败清理；line replyToken TTL + push 兜底；wechat-mp token 过期重试 + MsgId 去重；weixin-ilink buf 推进/防抖写盘/媒体 TTL/QR abort；satori PONG 看门狗；退避自毁修复。
  - **游戏**：text-adventure 终局 restart 复活 + requires 服务端校验；tic-tac-toe PvP 占用/restart/队列清理/TTL；idiom-chain/word-riddle 闲聊不扣失误；别名中间件不劫持普通聊天。
  - **共享库**：schema falsy 默认值/date/tuple/union 修复；database parseCondition Date/未知操作符、sqlite TEXT 往返、query 分派、belongsToMany 方言、migration dry-run；schedule DST 回拨死循环、重复 id 去重、flush 串行化；game-kit fallback 编号/onboarding 提示/尾缀边界/活引用拷贝。
  - **渲染语音**：fetch 全部超时 + 渲染并发闸；sanitizeHtml form 保文本；STT 扩展名映射 + 删临时文件；TTS 未知 provider 报错；emojiCache LRU 负缓存/fontCache style/clearFonts 恢复；register 错误分类收窄。

- 20f5d6c: 游戏迁移到 Plugin Runtime（首个游戏 rps + game-kit 共享支撑）：

  - **game-kit**：`GameMessageLike`（`command-message.ts`）的 `$sender.name` 放宽为可选，使其成为 core `Message` 的结构兼容超集；`channelKey`（`board-sender.ts`）与 `recordGameOutcome`（`game-records.ts`）的消息参数类型改用 `GameMessageLike`。这样共享 helper 同时接受运行时桥接的 `GameMessageLike` 与迁移过渡期仍传入的 legacy core `Message`，让游戏可逐个迁移而不破坏未迁移游戏的类型。
  - **rps**：游戏逻辑（`game-flow.ts` / `rps-command.ts` / `session-service.ts`）不再依赖 `@zhin.js/core` 的 `Plugin` / `Adapter` 类型；消息类型改用 `GameMessageLike`。移除恒为 `null` 的 legacy host `plugin` 参数与 `Adapter.editMessage` 交互分支（Runtime 下从不执行），命令与 choice 中间件返回文本视图；`runRpsCommandText` 合并进 `runRpsCommand`。

  行为等价（移除的是 Runtime 下恒 null 的死分支）；rps 构建与 10/10 测试通过，未迁移游戏（blackjack）构建仍通过，验证向后兼容。

- Updated dependencies [cdf64e7]
- Updated dependencies [5691aba]
- Updated dependencies [078e3f7]
- Updated dependencies [50497a5]
- Updated dependencies [f0ec5ab]
- Updated dependencies [20f5d6c]
- Updated dependencies [fa66c4c]
- Updated dependencies [fa66c4c]
- Updated dependencies [6cb6152]
  - @zhin.js/command@1.0.3
  - @zhin.js/plugin-runtime@1.1.1
  - @zhin.js/game-kit@2.0.1
  - @zhin.js/core@1.4.1
  - @zhin.js/middleware@1.0.3

## 1.0.3

### Patch Changes

- Updated dependencies [7db69c1]
- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
- Updated dependencies [ac9da66]
  - @zhin.js/core@1.4.0
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/game-kit@2.0.0
  - @zhin.js/command@1.0.2
  - @zhin.js/middleware@1.0.2

## 1.0.2

### Patch Changes

- 16ec4e8: Harden Plugin Runtime migration boundaries: make process-level registries, the game
  catalog, and game-record storage generation-owned so HMR replacement cannot unregister the
  active generation, discover workspace agents without mutating `process.cwd()`, and
  require authentication for production A2A endpoints.

  Game SessionServices and Group Suite mutable state now live in owner-scoped
  resources. Lottery database, Agent dependencies, and outbound push bindings use
  generation registrations with rollback-safe disposal.

  The Plugin Runtime Console demo scope now follows ADR 0016 and rejects project
  file, environment, and database RPCs, closing both direct and file-manager paths
  that could expose `.env` values.

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

- Updated dependencies [16ec4e8]
- Updated dependencies [cc5c94d]
- Updated dependencies [447f3e2]
  - @zhin.js/core@1.3.5
  - @zhin.js/game-kit@1.0.2
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/command@1.0.1
  - @zhin.js/middleware@1.0.1

## 1.0.1

### Patch Changes

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - zhin.js@4.1.2
  - @zhin.js/game-shared@1.0.1
