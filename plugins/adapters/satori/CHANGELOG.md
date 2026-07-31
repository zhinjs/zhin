# @zhin.js/adapter-satori

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

- Updated dependencies [d5cd4aa]
  - @zhin.js/command@1.0.4
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

- 078e3f7: 架构统一批（AURA）：

  - **EndpointLifecycle 基座**（@zhin.js/adapter 新增 `createEndpointLifecycle`）：WS/SSE 端点的 start 失败复位、仅曾 open 才退避重连（指数+jitter 可配）、stop 不重连、PONG 看门狗、定时器集中清理、陈旧事件防叠套；napcat/milky/onebot11/onebot12/satori 已迁移（删除各自手写状态机），从此同类竞态在结构上不可能再犯。
  - **Generation-store**（@zhin.js/plugin-runtime 新增 `createGenerationStore`）：模块级运行时状态的一等能力，provide 自动挂 lifecycle 反注册（代际结束自动清理）；lottery deps 与 rss db 已迁移，公开 API 兼容。
  - **Resolver 管线收敛**（@zhin.js/runtime）：解析规则统一为 local path → workspace → node_modules 单管线；optional 引用对所有 PackageResolutionError 容错（消除 message 前缀补丁）。
  - **工具目录准入统一**（@zhin.js/agent）：RegisteredToolSource 与 ExternalToolSource 共用同一 `canAccessTool` 准入（platforms/scopes/permissions/hidden 四元组全链路透传），同名覆盖 warn；AgentToolRegistration 补 platforms/scopes。两条注册通道（静态约定 vs 动态注册）职责边界已文档化。

- 74b035c: endpoint 管理命令扩展至 18/20 适配器：kook / discord / github（private_key 支持内联文件路径）/ icqq（bindFlow 登记式 add + `icqq login` 引导）/ dingtalk / lark / line / satori / wechat-mp / wecom / weixin-ilink 接入 `endpoint list/add/remove`（字段对齐各自 schema，凭据写 `.env`）。email（smtp/imap 嵌套对象）与 sandbox（无凭据）暂不接。
- 09d4f25: Console 社交读取面（management 语义端口）多平台落地：napcat/onebot11/onebot12/milky（好友+群+群成员，OneBot 标准动作）；discord/kook/satori（guild+频道+成员，分页聚合，id 保精度留字符串）；slack（workspace 成员+public channels+conversations.members）；line（群/room 成员分页+profile 回退）；wechat-mp（followers openid）；weixin-ilink（context_token 对端推导）；lark（chats+members 全分页）。`EndpointFriend.user_id`/`EndpointGroup.group_id` 放宽为 `number | string`（雪花 id 不丢精度）。telegram/wecom/dingtalk/github/email/sandbox 注明平台无列表面暂不接。
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
  - @zhin.js/plugin-runtime@1.1.1
  - @zhin.js/host-http@1.0.3
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
  - @zhin.js/host-http@1.0.2
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
  - @zhin.js/host-http@1.0.1
  - zhin.js@4.1.3
  - @zhin.js/logger@1.0.75
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/adapter@1.0.1

## 3.0.2

### Patch Changes

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/host-router@2.0.3
  - zhin.js@4.1.2

## 3.0.1

### Patch Changes

- 5cc9c03: fix: ai 优化
- b9b3881: fix: 增加游戏引擎以及部分游戏
- Updated dependencies [5cc9c03]
- Updated dependencies [7700903]
  - @zhin.js/host-router@2.0.2
  - zhin.js@4.1.1

## 3.0.0

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化
- Updated dependencies [c4575c9]
- Updated dependencies [c4575c9]
  - @zhin.js/host-router@2.0.1
  - zhin.js@4.1.0

## 2.0.1

### Patch Changes

- Updated dependencies [ae5239c]
  - zhin.js@4.0.1
  - @zhin.js/host-router@2.0.0

## 2.0.0

### Patch Changes

- zhin.js@3.0.0
- @zhin.js/host-router@2.0.0

## 1.0.1

### Patch Changes

- d8def69: fix: 性能优化
- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - @zhin.js/host-router@1.0.1
  - zhin.js@2.0.1

## 1.0.0

### Patch Changes

- zhin.js@2.0.0
- @zhin.js/host-router@1.0.0

## 0.0.42

### Patch Changes

- Updated dependencies [d8547d2]
  - zhin.js@1.0.92
  - @zhin.js/host-router@0.0.3

## 0.0.41

### Patch Changes

- Updated dependencies [3735e96]
  - zhin.js@1.0.91
  - @zhin.js/host-router@0.0.3

## 0.0.40

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - @zhin.js/host-router@0.0.3
  - zhin.js@1.0.90

## 0.0.39

### Patch Changes

- Updated dependencies [c78d2cd]
  - @zhin.js/host-router@0.0.2
  - zhin.js@1.0.89

## 0.0.38

### Patch Changes

- Updated dependencies [ccb6e24]
  - zhin.js@1.0.88

## 0.0.37

### Patch Changes

- 90d9efd: fix: 处理包名
  - zhin.js@1.0.87
  - @zhin.js/host-router@0.0.1

## 0.0.36

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [7e14f8d]
  - zhin.js@1.0.86
  - @zhin.js/host-router@1.0.79

## 0.0.35

### Patch Changes

- zhin.js@1.0.85
- @zhin.js/host-router@1.0.78

## 0.0.34

### Patch Changes

- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
  - zhin.js@1.0.84
  - @zhin.js/host-router@1.0.77

## 0.0.33

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/host-router@1.0.76
  - zhin.js@1.0.83

## 0.0.32

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/host-router@1.0.75
  - zhin.js@1.0.82

## 0.0.31

### Patch Changes

- Updated dependencies [8086ccb]
  - zhin.js@1.0.81
  - @zhin.js/host-router@1.0.74

## 0.0.30

### Patch Changes

- zhin.js@1.0.80
- @zhin.js/host-router@1.0.73

## 0.0.29

### Patch Changes

- zhin.js@1.0.79
- @zhin.js/host-router@1.0.72

## 0.0.28

### Patch Changes

- zhin.js@1.0.78
- @zhin.js/host-router@1.0.71

## 0.0.27

### Patch Changes

- zhin.js@1.0.77
- @zhin.js/host-router@1.0.70

## 0.0.26

### Patch Changes

- Updated dependencies [cb9fbf1]
  - zhin.js@1.0.76
  - @zhin.js/host-router@1.0.69

## 0.0.25

### Patch Changes

- zhin.js@1.0.75
- @zhin.js/host-router@1.0.68

## 0.0.24

### Patch Changes

- Updated dependencies [c9dec38]
  - zhin.js@1.0.74
  - @zhin.js/host-router@1.0.67

## 0.0.23

### Patch Changes

- f1e9a76: fix: 提高 skill 质量
  - zhin.js@1.0.73
  - @zhin.js/host-router@1.0.66

## 0.0.22

### Patch Changes

- abc75a4: fix: 优化,客户端构建优化

## 0.0.21

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - zhin.js@1.0.72
  - @zhin.js/host-router@1.0.65

## 0.0.20

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - zhin.js@1.0.71
  - @zhin.js/host-router@1.0.64

## 0.0.19

### Patch Changes

- zhin.js@1.0.68
- @zhin.js/host-router@1.0.63

## 0.0.18

### Patch Changes

- Updated dependencies [0eba6d6]
  - @zhin.js/host-router@1.0.62
  - zhin.js@1.0.67

## 0.0.17

### Patch Changes

- zhin.js@1.0.66
- @zhin.js/host-router@1.0.61

## 0.0.16

### Patch Changes

- zhin.js@1.0.65
- @zhin.js/host-router@1.0.60

## 0.0.15

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - zhin.js@1.0.64
  - @zhin.js/host-router@1.0.59

## 0.0.14

### Patch Changes

- Updated dependencies [ba30934]
  - @zhin.js/host-router@1.0.58
  - zhin.js@1.0.63

## 0.0.13

### Patch Changes

- zhin.js@1.0.62
- @zhin.js/host-router@1.0.57

## 0.0.12

### Patch Changes

- zhin.js@1.0.61
- @zhin.js/host-router@1.0.56

## 0.0.11

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

## 0.0.10

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - zhin.js@1.0.59
  - @zhin.js/host-router@1.0.54

## 0.0.9

### Patch Changes

- zhin.js@1.0.58
- @zhin.js/host-router@1.0.53

## 0.0.8

### Patch Changes

- zhin.js@1.0.57
- @zhin.js/host-router@1.0.52

## 0.0.7

### Patch Changes

- zhin.js@1.0.56
- @zhin.js/host-router@1.0.51

## 0.0.6

### Patch Changes

- zhin.js@1.0.55
- @zhin.js/host-router@1.0.50

## 0.0.5

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - zhin.js@1.0.54
  - @zhin.js/host-router@1.0.49

## 0.0.4

### Patch Changes

- zhin.js@1.0.53
- @zhin.js/host-router@1.0.48

## 0.0.3

### Patch Changes

- a3511a0: 各包内 Agent 技能说明已固定为随包发布的 `skills/*/SKILL.md`（替代已移除的运行时 `declareSkill`）。本批为 registry / 分发侧对齐的 **patch** 版本递增。
- Updated dependencies [a3511a0]
  - @zhin.js/host-router@1.0.47

## 0.0.2

### Patch Changes

- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - zhin.js@1.0.52
  - @zhin.js/host-router@1.0.46

## 0.0.1

### Patch Changes

- zhin.js@1.0.51
- @zhin.js/host-router@1.0.45
