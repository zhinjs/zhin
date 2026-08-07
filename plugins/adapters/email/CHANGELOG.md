# @zhin.js/adapter-email

## 5.0.3

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/logger@1.0.76
  - @zhin.js/adapter@1.1.6
  - @zhin.js/core@1.5.3
  - @zhin.js/im-contract@1.0.2
  - @zhin.js/plugin-runtime@1.1.4
  - zhin.js@6.0.3

## 5.0.2

### Patch Changes

- Updated dependencies [afc0e66]
- Updated dependencies [2e41ad5]
- Updated dependencies [9f57124]
  - @zhin.js/core@1.5.2
  - @zhin.js/adapter@1.1.5
  - @zhin.js/im-contract@1.0.1
  - @zhin.js/plugin-runtime@1.1.3
  - zhin.js@6.0.2

## 5.0.1

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/adapter@1.1.4
  - @zhin.js/core@1.5.1
  - zhin.js@6.0.1

## 5.0.0

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
  - @zhin.js/adapter@1.1.3
  - @zhin.js/core@1.5.0
  - zhin.js@6.0.0

## 4.0.3

### Patch Changes

- Updated dependencies [45b3256]
  - @zhin.js/core@1.4.3
  - zhin.js@5.0.3

## 4.0.2

### Patch Changes

- d5cd4aa: Publish Plugin Runtime entry points and convention modules as JavaScript so
  installed npm plugins load on Node without TypeScript stripping. Workspace
  development continues to prefer TypeScript sources for local HMR.

  Remove the unconsumed legacy game hub APIs from game-kit; game navigation and
  records now use ordinary convention commands owned by the game hub plugin.

  - zhin.js@5.0.2
  - @zhin.js/adapter@1.1.2
  - @zhin.js/core@1.4.2

## 4.0.1

### Patch Changes

- 5691aba: 第二轮全量审计修复批（8 面 ~60 bug）：

  - **安全**：email 附件路径穿越修复（basename + downloadPath 约束）；lark/telegram/satori webhook 鉴权（缺密钥告警、timingSafeEqual、±5min 时效窗、chat_type 修正）；onebot wss/webhook 缺 token 告警；qq webhook 改原始字节验签；renderJsx/JSX 转义注入修复；console runtime token 401 死循环。
  - **P0 功能**：sandbox 多 endpoint 解析 + WS 路径隔离；short-url expand（undici opaqueredirect）改 follow；AI 压缩摘要失败不再静默丢历史（熔断恢复生效）；console-ui 实时推送事件名归一化 + IndexedDB schema 对齐；process-monitor 热重载不再误判崩溃。
  - **生命周期**：email IMAP 断线重连 + 在飞锁；onebot11/12 start 失败清理；line replyToken TTL + push 兜底；wechat-mp token 过期重试 + MsgId 去重；weixin-ilink buf 推进/防抖写盘/媒体 TTL/QR abort；satori PONG 看门狗；退避自毁修复。
  - **游戏**：text-adventure 终局 restart 复活 + requires 服务端校验；tic-tac-toe PvP 占用/restart/队列清理/TTL；idiom-chain/word-riddle 闲聊不扣失误；别名中间件不劫持普通聊天。
  - **共享库**：schema falsy 默认值/date/tuple/union 修复；database parseCondition Date/未知操作符、sqlite TEXT 往返、query 分派、belongsToMany 方言、migration dry-run；schedule DST 回拨死循环、重复 id 去重、flush 串行化；game-kit fallback 编号/onboarding 提示/尾缀边界/活引用拷贝。
  - **渲染语音**：fetch 全部超时 + 渲染并发闸；sanitizeHtml form 保文本；STT 扩展名映射 + 删临时文件；TTS 未知 provider 报错；emojiCache LRU 负缓存/fontCache style/clearFonts 恢复；register 错误分类收窄。

- Updated dependencies [cdf64e7]
- Updated dependencies [5691aba]
- Updated dependencies [078e3f7]
- Updated dependencies [9c997b2]
- Updated dependencies [09d4f25]
- Updated dependencies [43485a9]
- Updated dependencies [f0ec5ab]
- Updated dependencies [3e925d0]
- Updated dependencies [fa66c4c]
- Updated dependencies [fa66c4c]
- Updated dependencies [6cb6152]
  - @zhin.js/plugin-runtime@1.1.1
  - zhin.js@5.0.1
  - @zhin.js/adapter@1.1.1
  - @zhin.js/core@1.4.1

## 4.0.0

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
  - zhin.js@5.0.0

## 3.0.3

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

- Updated dependencies [16ec4e8]
- Updated dependencies [cc5c94d]
- Updated dependencies [447f3e2]
  - @zhin.js/core@1.3.5
  - zhin.js@4.1.3
  - @zhin.js/logger@1.0.75
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/adapter@1.0.1

## 3.0.2

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - zhin.js@4.1.2

## 3.0.1

### Patch Changes

- 5cc9c03: fix: ai 优化
- b9b3881: fix: 增加游戏引擎以及部分游戏
- Updated dependencies [5cc9c03]
- Updated dependencies [7700903]
  - zhin.js@4.1.1

## 3.0.0

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化
- Updated dependencies [c4575c9]
- Updated dependencies [c4575c9]
  - zhin.js@4.1.0

## 2.0.1

### Patch Changes

- Updated dependencies [ae5239c]
  - zhin.js@4.0.1

## 2.0.0

### Patch Changes

- zhin.js@3.0.0

## 1.0.1

### Patch Changes

- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - zhin.js@2.0.1

## 1.0.0

### Patch Changes

- zhin.js@2.0.0

## 0.1.79

### Patch Changes

- Updated dependencies [d8547d2]
  - zhin.js@1.0.92

## 0.1.78

### Patch Changes

- Updated dependencies [3735e96]
  - zhin.js@1.0.91

## 0.1.77

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - zhin.js@1.0.90

## 0.1.76

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新
- Updated dependencies [c78d2cd]
  - zhin.js@1.0.89

## 0.1.75

### Patch Changes

- Updated dependencies [ccb6e24]
  - zhin.js@1.0.88

## 0.1.74

### Patch Changes

- 90d9efd: fix: 处理包名
  - zhin.js@1.0.87

## 0.1.73

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [7e14f8d]
  - zhin.js@1.0.86

## 0.1.72

### Patch Changes

- zhin.js@1.0.85

## 0.1.71

### Patch Changes

- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
  - zhin.js@1.0.84

## 0.1.70

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - zhin.js@1.0.83

## 0.1.69

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - zhin.js@1.0.82

## 0.1.68

### Patch Changes

- Updated dependencies [8086ccb]
  - zhin.js@1.0.81

## 0.1.67

### Patch Changes

- zhin.js@1.0.80

## 0.1.66

### Patch Changes

- zhin.js@1.0.79

## 0.1.65

### Patch Changes

- zhin.js@1.0.78

## 0.1.64

### Patch Changes

- zhin.js@1.0.77

## 0.1.63

### Patch Changes

- Updated dependencies [cb9fbf1]
  - zhin.js@1.0.76

## 0.1.62

### Patch Changes

- zhin.js@1.0.75

## 0.1.61

### Patch Changes

- Updated dependencies [c9dec38]
  - zhin.js@1.0.74

## 0.1.60

### Patch Changes

- f1e9a76: fix: 提高 skill 质量
  - zhin.js@1.0.73

## 0.1.59

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - zhin.js@1.0.72

## 0.1.58

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - zhin.js@1.0.71

## 0.1.57

### Patch Changes

- zhin.js@1.0.68

## 0.1.56

### Patch Changes

- zhin.js@1.0.67

## 0.1.55

### Patch Changes

- zhin.js@1.0.66

## 0.1.54

### Patch Changes

- zhin.js@1.0.65

## 0.1.53

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - zhin.js@1.0.64

## 0.1.52

### Patch Changes

- ba30934: fix: web 优化
  - zhin.js@1.0.63

## 0.1.51

### Patch Changes

- zhin.js@1.0.62

## 0.1.50

### Patch Changes

- zhin.js@1.0.61

## 0.1.49

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

## 0.1.48

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - zhin.js@1.0.59

## 0.1.47

### Patch Changes

- zhin.js@1.0.58

## 0.1.46

### Patch Changes

- zhin.js@1.0.57

## 0.1.45

### Patch Changes

- zhin.js@1.0.56

## 0.1.44

### Patch Changes

- zhin.js@1.0.55

## 0.1.43

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - zhin.js@1.0.54

## 0.1.42

### Patch Changes

- zhin.js@1.0.53

## 0.1.41

### Patch Changes

- a3511a0: 各包内 Agent 技能说明已固定为随包发布的 `skills/*/SKILL.md`（替代已移除的运行时 `declareSkill`）。本批为 registry / 分发侧对齐的 **patch** 版本递增。

## 0.1.40

### Patch Changes

- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - zhin.js@1.0.52

## 0.1.39

### Patch Changes

- zhin.js@1.0.51

## 0.1.38

### Patch Changes

- zhin.js@1.0.50

## 0.1.37

### Patch Changes

- zhin.js@1.0.49

## 0.1.36

### Patch Changes

- zhin.js@1.0.48

## 0.1.35

### Patch Changes

- Updated dependencies [de3e352]
  - zhin.js@1.0.47

## 0.1.34

### Patch Changes

- Updated dependencies [7394603]
  - zhin.js@1.0.46

## 0.1.33

### Patch Changes

- zhin.js@1.0.45

## 0.1.32

### Patch Changes

- zhin.js@1.0.44

## 0.1.31

### Patch Changes

- Updated dependencies [72ec4ba]
  - zhin.js@1.0.43

## 0.1.30

### Patch Changes

- zhin.js@1.0.42

## 0.1.29

### Patch Changes

- zhin.js@1.0.41

## 0.1.28

### Patch Changes

- 7ef9057: fix: 架构调整优化
- Updated dependencies [7ef9057]
  - zhin.js@1.0.40

## 0.1.27

### Patch Changes

- zhin.js@1.0.39

## 0.1.26

### Patch Changes

- Updated dependencies [ab5c54a]
  - zhin.js@1.0.38

## 0.1.25

### Patch Changes

- zhin.js@1.0.37

## 0.1.24

### Patch Changes

- zhin.js@1.0.36

## 0.1.23

### Patch Changes

- zhin.js@1.0.35

## 0.1.22

### Patch Changes

- zhin.js@1.0.34

## 0.1.21

### Patch Changes

- zhin.js@1.0.33

## 0.1.20

### Patch Changes

- zhin.js@1.0.32

## 0.1.19

### Patch Changes

- zhin.js@1.0.31

## 0.1.18

### Patch Changes

- Updated dependencies [460a6c6]
  - zhin.js@1.0.30

## 0.1.17

### Patch Changes

- zhin.js@1.0.29

## 0.1.16

### Patch Changes

- zhin.js@1.0.28

## 0.1.15

### Patch Changes

- Updated dependencies [b27e633]
  - zhin.js@1.0.27

## 0.1.14

### Patch Changes

- 106d357: fix: ai
- Updated dependencies [106d357]
  - zhin.js@1.0.26

## 0.1.13

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai
- Updated dependencies [26d2942]
- Updated dependencies [6b02c41]
  - zhin.js@1.0.25

## 0.1.12

### Patch Changes

- zhin.js@1.0.24

## 0.1.11

### Patch Changes

- 52ae08a: fix: 更新消息处理流程
- Updated dependencies [52ae08a]
  - zhin.js@1.0.23

## 0.1.10

### Patch Changes

- Updated dependencies [26aba27]
  - zhin.js@1.0.22

## 0.1.9

### Patch Changes

- zhin.js@1.0.21

## 0.1.8

### Patch Changes

- a3b7673: fix: 调整依赖项
- 5141137: fix: 修复适配器读取配置 bug
- Updated dependencies [5141137]
  - zhin.js@1.0.20

## 0.1.7

### Patch Changes

- f9faa1d: fix: test release
- Updated dependencies [f9faa1d]
  - zhin.js@1.0.19

## 0.1.6

### Patch Changes

- d16a69c: fix: test trust publish
- Updated dependencies [d16a69c]
  - zhin.js@1.0.18

## 0.1.5

### Patch Changes

- f9e75ce: fix: 一致性调整,文档调整
- f9e75ce: fix: recall,文档统一,mcp,githubnotifiy
  - zhin.js@1.0.15

## 0.1.4

### Patch Changes

- 547028f: fix: 优化包结构,优化客户端支持
- Updated dependencies [547028f]
  - @zhin.js/types@1.0.5
  - zhin.js@1.0.14

## 0.1.3

### Patch Changes

- c490260: fix: 更新脚手架结构,优化包依赖
  - zhin.js@1.0.9

## 0.1.2

### Patch Changes

- 551c4d2: fix: 插件支持配置文件读取,优化 test 用例
- Updated dependencies [551c4d2]
  - @zhin.js/types@1.0.3
  - zhin.js@1.0.8

## 0.1.1

### Patch Changes

- 89bc676: fix: 类型反射优化
- Updated dependencies [89bc676]
  - @zhin.js/types@1.0.2
  - zhin.js@1.0.3
