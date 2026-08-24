# @zhin.js/plugin-music

## 8.0.1

### Patch Changes

- Updated dependencies [54bfd6b]
- Updated dependencies [e9c6a73]
- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
- Updated dependencies [1fc78bc]
  - @zhin.js/core@1.5.14
  - @zhin.js/adapter-icqq@9.0.1
  - @zhin.js/command@1.0.16
  - @zhin.js/component@1.0.13
  - @zhin.js/middleware@1.0.13
  - @zhin.js/tool@1.0.13
  - zhin.js@6.0.14

## 8.0.0

### Patch Changes

- Updated dependencies [f2c532f]
  - @zhin.js/core@1.5.13
  - @zhin.js/adapter-icqq@9.0.0
  - zhin.js@6.0.13

## 7.0.14

### Patch Changes

- Updated dependencies [5969c5b]
- Updated dependencies [5969c5b]
- Updated dependencies [5969c5b]
- Updated dependencies [7cd8b34]
- Updated dependencies [974772e]
- Updated dependencies [5969c5b]
- Updated dependencies [2f786bd]
- Updated dependencies [1312ca0]
  - @zhin.js/core@1.5.12
  - @zhin.js/adapter-icqq@8.0.14
  - @zhin.js/command@1.0.15
  - zhin.js@6.0.12
  - @zhin.js/component@1.0.12
  - @zhin.js/middleware@1.0.12
  - @zhin.js/tool@1.0.12

## 7.0.13

### Patch Changes

- @zhin.js/core@1.5.11
- zhin.js@6.0.11
- @zhin.js/adapter-icqq@8.0.13

## 7.0.12

### Patch Changes

- 3556601: Declare Stable Feature packages referenced by `zhin.features` as optional `peerDependencies` on official plugins/adapters (`@zhin.js/runtime` ≥1.0.12 requires features to be declared in deps/peers). Keeps authoring via `zhin.js` facades without installing Feature implementation packages into `dependencies`, and removes the need for consumer postinstall peer-patch scripts. `zhin new` scaffolds the same peer shape.
- Updated dependencies [3556601]
  - @zhin.js/adapter-icqq@8.0.12
  - @zhin.js/core@1.5.10
  - zhin.js@6.0.10

## 7.0.11

### Patch Changes

- eb84b77: fix: 更新文档,建立正确的依赖关系
- Updated dependencies [d3920e9]
- Updated dependencies [eb84b77]
  - @zhin.js/core@1.5.10
  - zhin.js@6.0.10
  - @zhin.js/adapter-icqq@8.0.11
  - @zhin.js/tool@1.0.11

## 7.0.10

### Patch Changes

- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/adapter-icqq@8.0.10
  - @zhin.js/command@1.0.13
  - @zhin.js/core@1.5.9
  - @zhin.js/tool@1.0.10
  - @zhin.js/component@1.0.10
  - @zhin.js/middleware@1.0.10

## 7.0.9

### Patch Changes

- Updated dependencies [63253bb]
- Updated dependencies [7427818]
- Updated dependencies [953cfe1]
- Updated dependencies [0e73866]
  - @zhin.js/plugin-runtime@1.1.6
  - @zhin.js/core@1.5.8
  - @zhin.js/tool@1.0.9
  - @zhin.js/command@1.0.12
  - @zhin.js/component@1.0.9
  - @zhin.js/middleware@1.0.9
  - @zhin.js/adapter-icqq@8.0.9

## 7.0.8

### Patch Changes

- @zhin.js/adapter-icqq@8.0.8

## 7.0.7

### Patch Changes

- @zhin.js/adapter-icqq@8.0.7

## 7.0.6

### Patch Changes

- @zhin.js/adapter-icqq@8.0.6

## 7.0.5

### Patch Changes

- Updated dependencies [c106ecc]
- Updated dependencies [daffd4c]
- Updated dependencies [36c7400]
- Updated dependencies [3f29623]
- Updated dependencies [2916852]
- Updated dependencies [162fa34]
- Updated dependencies [e40b048]
- Updated dependencies [f1708c3]
- Updated dependencies [d254a81]
  - @zhin.js/plugin-runtime@1.1.5
  - @zhin.js/tool@1.0.8
  - @zhin.js/adapter-icqq@8.0.5
  - @zhin.js/component@1.0.8

## 7.0.4

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/component@1.0.7
  - @zhin.js/plugin-runtime@1.1.4
  - @zhin.js/tool@1.0.7
  - @zhin.js/adapter-icqq@8.0.4

## 7.0.3

### Patch Changes

- Updated dependencies [afc0e66]
  - @zhin.js/plugin-runtime@1.1.3
  - @zhin.js/adapter-icqq@8.0.3
  - @zhin.js/component@1.0.6
  - @zhin.js/tool@1.0.6

## 7.0.2

### Patch Changes

- @zhin.js/adapter-icqq@8.0.2

## 7.0.1

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/component@1.0.5
  - @zhin.js/tool@1.0.5
  - @zhin.js/adapter-icqq@8.0.1

## 7.0.0

### Patch Changes

- Updated dependencies [7c1e63a]
- Updated dependencies [4fbff5d]
  - @zhin.js/adapter-icqq@8.0.0

## 6.0.5

### Patch Changes

- @zhin.js/adapter-icqq@7.0.5

## 6.0.4

### Patch Changes

- @zhin.js/adapter-icqq@7.0.4

## 6.0.3

### Patch Changes

- @zhin.js/adapter-icqq@7.0.3

## 6.0.2

### Patch Changes

- d5cd4aa: Publish Plugin Runtime entry points and convention modules as JavaScript so
  installed npm plugins load on Node without TypeScript stripping. Workspace
  development continues to prefer TypeScript sources for local HMR.

  Remove the unconsumed legacy game hub APIs from game-kit; game navigation and
  records now use ordinary convention commands owned by the game hub plugin.

- Updated dependencies [d5cd4aa]
  - @zhin.js/adapter-icqq@7.0.2
  - @zhin.js/component@1.0.4
  - @zhin.js/tool@1.0.4

## 6.0.1

### Patch Changes

- 5691aba: 第二轮全量审计修复批（8 面 ~60 bug）：

  - **安全**：email 附件路径穿越修复（basename + downloadPath 约束）；lark/telegram/satori webhook 鉴权（缺密钥告警、timingSafeEqual、±5min 时效窗、chat_type 修正）；onebot wss/webhook 缺 token 告警；qq webhook 改原始字节验签；renderJsx/JSX 转义注入修复；console runtime token 401 死循环。
  - **P0 功能**：sandbox 多 endpoint 解析 + WS 路径隔离；short-url expand（undici opaqueredirect）改 follow；AI 压缩摘要失败不再静默丢历史（熔断恢复生效）；console-ui 实时推送事件名归一化 + IndexedDB schema 对齐；process-monitor 热重载不再误判崩溃。
  - **生命周期**：email IMAP 断线重连 + 在飞锁；onebot11/12 start 失败清理；line replyToken TTL + push 兜底；wechat-mp token 过期重试 + MsgId 去重；weixin-ilink buf 推进/防抖写盘/媒体 TTL/QR abort；satori PONG 看门狗；退避自毁修复。
  - **游戏**：text-adventure 终局 restart 复活 + requires 服务端校验；tic-tac-toe PvP 占用/restart/队列清理/TTL；idiom-chain/word-riddle 闲聊不扣失误；别名中间件不劫持普通聊天。
  - **共享库**：schema falsy 默认值/date/tuple/union 修复；database parseCondition Date/未知操作符、sqlite TEXT 往返、query 分派、belongsToMany 方言、migration dry-run；schedule DST 回拨死循环、重复 id 去重、flush 串行化；game-kit fallback 编号/onboarding 提示/尾缀边界/活引用拷贝。
  - **渲染语音**：fetch 全部超时 + 渲染并发闸；sanitizeHtml form 保文本；STT 扩展名映射 + 删临时文件；TTS 未知 provider 报错；emojiCache LRU 负缓存/fontCache style/clearFonts 恢复；register 错误分类收窄。

- Updated dependencies [cdf64e7]
- Updated dependencies [2d0a159]
- Updated dependencies [078e3f7]
- Updated dependencies [74b035c]
- Updated dependencies [fa66c4c]
- Updated dependencies [6cb6152]
  - @zhin.js/plugin-runtime@1.1.1
  - @zhin.js/tool@1.0.3
  - @zhin.js/adapter-icqq@7.0.1
  - @zhin.js/component@1.0.3

## 6.0.0

### Patch Changes

- Updated dependencies [7db69c1]
- Updated dependencies [e5c84ed]
- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
- Updated dependencies [713445c]
- Updated dependencies [f32c424]
  - @zhin.js/adapter-icqq@7.0.0
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/component@1.0.2
  - @zhin.js/tool@1.0.2

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

- Updated dependencies [cc5c94d]
- Updated dependencies [447f3e2]
  - @zhin.js/adapter-icqq@6.0.3
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/component@1.0.1
  - @zhin.js/tool@1.0.1

## 5.0.2

### Patch Changes

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/adapter-icqq@6.0.2
  - zhin.js@4.1.2

## 5.0.1

### Patch Changes

- 5cc9c03: fix: ai 优化
- Updated dependencies [5cc9c03]
- Updated dependencies [b9b3881]
- Updated dependencies [7700903]
  - zhin.js@4.1.1
  - @zhin.js/adapter-icqq@6.0.1

## 5.0.0

### Patch Changes

- Updated dependencies [c4575c9]
- Updated dependencies [c4575c9]
  - @zhin.js/adapter-icqq@6.0.0
  - zhin.js@4.1.0

## 4.0.2

### Patch Changes

- zhin.js@4.0.1
- @zhin.js/adapter-icqq@5.0.2

## 4.0.1

### Patch Changes

- Updated dependencies [ae5239c]
  - @zhin.js/adapter-icqq@5.0.1
  - zhin.js@4.0.1

## 4.0.0

### Patch Changes

- zhin.js@3.0.0
- @zhin.js/adapter-icqq@5.0.0

## 3.0.1

### Patch Changes

- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - @zhin.js/adapter-icqq@4.0.1
  - zhin.js@2.0.1

## 3.0.0

### Patch Changes

- Updated dependencies [e62c23a]
  - @zhin.js/adapter-icqq@4.0.0
  - zhin.js@2.0.0

## 2.0.11

### Patch Changes

- Updated dependencies [d8547d2]
  - zhin.js@1.0.92
  - @zhin.js/adapter-icqq@3.0.11

## 2.0.10

### Patch Changes

- Updated dependencies [3735e96]
  - @zhin.js/adapter-icqq@3.0.10
  - zhin.js@1.0.91

## 2.0.9

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - zhin.js@1.0.90
  - @zhin.js/adapter-icqq@3.0.9

## 2.0.8

### Patch Changes

- Updated dependencies [c78d2cd]
  - @zhin.js/adapter-icqq@3.0.8
  - zhin.js@1.0.89

## 2.0.7

### Patch Changes

- Updated dependencies [ccb6e24]
  - zhin.js@1.0.88
  - @zhin.js/adapter-icqq@3.0.7

## 2.0.6

### Patch Changes

- Updated dependencies [90d9efd]
  - @zhin.js/adapter-icqq@3.0.6
  - zhin.js@1.0.87

## 2.0.5

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [6295cbd]
- Updated dependencies [a51d504]
- Updated dependencies [7e14f8d]
  - @zhin.js/adapter-icqq@3.0.5
  - zhin.js@1.0.86

## 2.0.4

### Patch Changes

- zhin.js@1.0.85
- @zhin.js/adapter-icqq@3.0.4

## 2.0.3

### Patch Changes

- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
  - zhin.js@1.0.84
  - @zhin.js/adapter-icqq@3.0.3

## 2.0.2

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/adapter-icqq@3.0.2
  - zhin.js@1.0.83

## 2.0.1

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - zhin.js@1.0.82
  - @zhin.js/adapter-icqq@3.0.1

## 2.0.0

### Patch Changes

- @zhin.js/adapter-icqq@3.0.0

## 1.0.26

### Patch Changes

- Updated dependencies [8086ccb]
  - @zhin.js/adapter-icqq@2.0.26
  - zhin.js@1.0.81

## 1.0.25

### Patch Changes

- Updated dependencies [3b3e49b]
  - @zhin.js/adapter-icqq@2.0.25
  - zhin.js@1.0.80

## 1.0.24

### Patch Changes

- Updated dependencies [dc04e4a]
  - @zhin.js/adapter-icqq@2.0.24

## 1.0.23

### Patch Changes

- Updated dependencies [92da96d]
  - @zhin.js/adapter-icqq@2.0.23
  - zhin.js@1.0.79

## 1.0.22

### Patch Changes

- @zhin.js/adapter-icqq@2.0.22
- zhin.js@1.0.78

## 1.0.21

### Patch Changes

- zhin.js@1.0.77
- @zhin.js/adapter-icqq@2.0.21

## 1.0.20

### Patch Changes

- Updated dependencies [cb9fbf1]
  - zhin.js@1.0.76
  - @zhin.js/adapter-icqq@2.0.20

## 1.0.19

### Patch Changes

- zhin.js@1.0.75
- @zhin.js/adapter-icqq@2.0.19

## 1.0.18

### Patch Changes

- Updated dependencies [c9dec38]
  - zhin.js@1.0.74
  - @zhin.js/adapter-icqq@2.0.18

## 1.0.17

### Patch Changes

- f1e9a76: fix: 提高 skill 质量
  - zhin.js@1.0.73
  - @zhin.js/adapter-icqq@2.0.17

## 1.0.16

### Patch Changes

- @zhin.js/adapter-icqq@2.0.16

## 1.0.15

### Patch Changes

- Updated dependencies [abc75a4]
  - @zhin.js/adapter-icqq@2.0.15

## 1.0.14

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - zhin.js@1.0.72
  - @zhin.js/adapter-icqq@2.0.14

## 1.0.13

### Patch Changes

- @zhin.js/adapter-icqq@2.0.13

## 1.0.12

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - zhin.js@1.0.71
  - @zhin.js/adapter-icqq@2.0.12

## 1.0.11

### Patch Changes

- zhin.js@1.0.68
- @zhin.js/adapter-icqq@2.0.11

## 1.0.10

### Patch Changes

- @zhin.js/adapter-icqq@2.0.10
- zhin.js@1.0.67

## 1.0.9

### Patch Changes

- zhin.js@1.0.66
- @zhin.js/adapter-icqq@2.0.9

## 1.0.8

### Patch Changes

- zhin.js@1.0.65
- @zhin.js/adapter-icqq@2.0.8

## 1.0.7

### Patch Changes

- Updated dependencies [36c1b8f]
  - @zhin.js/adapter-icqq@2.0.7

## 1.0.6

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - zhin.js@1.0.64
  - @zhin.js/adapter-icqq@2.0.6

## 1.0.5

### Patch Changes

- Updated dependencies [ba30934]
  - @zhin.js/adapter-icqq@2.0.5
  - zhin.js@1.0.63

## 1.0.4

### Patch Changes

- zhin.js@1.0.62
- @zhin.js/adapter-icqq@2.0.4

## 1.0.3

### Patch Changes

- zhin.js@1.0.61
- @zhin.js/adapter-icqq@2.0.3

## 1.0.2

### Patch Changes

- 5073d4c: chore: chore: update TypeScript version to ^5.9.3 across all plugins and packages
  feat: enhance ai-text-as-image output registration with off handler for cleanup
  fix: remove unnecessary logging in ensureBuiltinFontsCached function
  refactor: simplify action handlers in html-renderer tools
  chore: add README files for queue-sandbox-poc and event-delivery packages
  chore: adjust pnpm workspace configuration to exclude games directory
  chore: update tsconfig to include plugins directory for TypeScript compilation
- Updated dependencies [5073d4c]
  - @zhin.js/adapter-icqq@2.0.2
  - zhin.js@1.0.60

## 1.0.1

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - zhin.js@1.0.59
  - @zhin.js/adapter-icqq@2.0.1

## 1.0.0

### Patch Changes

- zhin.js@1.0.58
- @zhin.js/adapter-icqq@2.0.0

## 0.0.52

### Patch Changes

- zhin.js@1.0.57
- @zhin.js/adapter-icqq@1.0.71

## 0.0.51

### Patch Changes

- zhin.js@1.0.56
- @zhin.js/adapter-icqq@1.0.70

## 0.0.50

### Patch Changes

- @zhin.js/adapter-icqq@1.0.69

## 0.0.49

### Patch Changes

- zhin.js@1.0.55
- @zhin.js/adapter-icqq@1.0.68

## 0.0.48

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - zhin.js@1.0.54
  - @zhin.js/adapter-icqq@1.0.67

## 0.0.47

### Patch Changes

- zhin.js@1.0.53
- @zhin.js/adapter-icqq@1.0.66

## 0.0.46

### Patch Changes

- a3511a0: 各包内 Agent 技能说明已固定为随包发布的 `skills/*/SKILL.md`（替代已移除的运行时 `declareSkill`）。本批为 registry / 分发侧对齐的 **patch** 版本递增。
- Updated dependencies [a3511a0]
  - @zhin.js/adapter-icqq@1.0.65

## 0.0.45

### Patch Changes

- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - zhin.js@1.0.52
  - @zhin.js/adapter-icqq@1.0.64

## 0.0.44

### Patch Changes

- @zhin.js/adapter-icqq@1.0.63

## 0.0.43

### Patch Changes

- Updated dependencies [607acc4]
  - @zhin.js/adapter-icqq@1.0.62
  - zhin.js@1.0.51

## 0.0.42

### Patch Changes

- @zhin.js/adapter-icqq@1.0.61

## 0.0.41

### Patch Changes

- zhin.js@1.0.50
- @zhin.js/adapter-icqq@1.0.60

## 0.0.40

### Patch Changes

- zhin.js@1.0.49
- @zhin.js/adapter-icqq@1.0.59

## 0.0.39

### Patch Changes

- zhin.js@1.0.48
- @zhin.js/adapter-icqq@1.0.58

## 0.0.38

### Patch Changes

- Updated dependencies [de3e352]
  - @zhin.js/adapter-icqq@1.0.57
  - zhin.js@1.0.47

## 0.0.37

### Patch Changes

- Updated dependencies [7394603]
  - zhin.js@1.0.46
  - @zhin.js/adapter-icqq@1.0.56

## 0.0.36

### Patch Changes

- zhin.js@1.0.45
- @zhin.js/adapter-icqq@1.0.55

## 0.0.35

### Patch Changes

- zhin.js@1.0.44
- @zhin.js/adapter-icqq@1.0.54

## 0.0.34

### Patch Changes

- Updated dependencies [72ec4ba]
  - zhin.js@1.0.43
  - @zhin.js/adapter-icqq@1.0.53

## 0.0.33

### Patch Changes

- @zhin.js/adapter-icqq@1.0.52

## 0.0.32

### Patch Changes

- zhin.js@1.0.42
- @zhin.js/adapter-icqq@1.0.51

## 0.0.31

### Patch Changes

- Updated dependencies [5a68249]
  - @zhin.js/adapter-icqq@1.0.50
  - zhin.js@1.0.41

## 0.0.30

### Patch Changes

- Updated dependencies [7ef9057]
  - @zhin.js/adapter-icqq@1.0.49
  - zhin.js@1.0.40

## 0.0.29

### Patch Changes

- 04f76ac: fix: 工具命名格式优化
  - zhin.js@1.0.39
  - @zhin.js/adapter-icqq@1.0.48

## 0.0.28

### Patch Changes

- Updated dependencies [ab5c54a]
  - @zhin.js/adapter-icqq@1.0.47
  - zhin.js@1.0.38

## 0.0.27

### Patch Changes

- @zhin.js/adapter-icqq@1.0.46

## 0.0.26

### Patch Changes

- Updated dependencies [e23e732]
  - @zhin.js/adapter-icqq@1.0.45

## 0.0.25

### Patch Changes

- zhin.js@1.0.37
- @zhin.js/adapter-icqq@1.0.44

## 0.0.24

### Patch Changes

- @zhin.js/adapter-icqq@1.0.43
- zhin.js@1.0.36

## 0.0.23

### Patch Changes

- zhin.js@1.0.35
- @zhin.js/adapter-icqq@1.0.42

## 0.0.22

### Patch Changes

- zhin.js@1.0.34
- @zhin.js/adapter-icqq@1.0.41

## 0.0.21

### Patch Changes

- zhin.js@1.0.33
- @zhin.js/adapter-icqq@1.0.40

## 0.0.20

### Patch Changes

- Updated dependencies [48481a8]
  - @zhin.js/adapter-icqq@1.0.39

## 0.0.19

### Patch Changes

- zhin.js@1.0.32
- @zhin.js/adapter-icqq@1.0.38

## 0.0.18

### Patch Changes

- zhin.js@1.0.31
- @zhin.js/adapter-icqq@1.0.37

## 0.0.17

### Patch Changes

- Updated dependencies [460a6c6]
  - zhin.js@1.0.30
  - @zhin.js/adapter-icqq@1.0.36

## 0.0.16

### Patch Changes

- zhin.js@1.0.29
- @zhin.js/adapter-icqq@1.0.35

## 0.0.15

### Patch Changes

- @zhin.js/adapter-icqq@1.0.34
- zhin.js@1.0.28

## 0.0.14

### Patch Changes

- @zhin.js/adapter-icqq@1.0.33

## 0.0.13

### Patch Changes

- Updated dependencies [b27e633]
  - zhin.js@1.0.27
  - @zhin.js/adapter-icqq@1.0.32

## 0.0.12

### Patch Changes

- 106d357: fix: ai
- Updated dependencies [106d357]
  - @zhin.js/adapter-icqq@1.0.31
  - zhin.js@1.0.26

## 0.0.11

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai
- Updated dependencies [26d2942]
- Updated dependencies [6b02c41]
  - zhin.js@1.0.25
  - @zhin.js/adapter-icqq@1.0.30

## 0.0.10

### Patch Changes

- zhin.js@1.0.24
- @zhin.js/adapter-icqq@1.0.29

## 0.0.9

### Patch Changes

- Updated dependencies [52ae08a]
  - @zhin.js/adapter-icqq@1.0.28
  - zhin.js@1.0.23

## 0.0.8

### Patch Changes

- Updated dependencies [26aba27]
  - zhin.js@1.0.22
  - @zhin.js/adapter-icqq@1.0.27

## 0.0.7

### Patch Changes

- zhin.js@1.0.21
- @zhin.js/adapter-icqq@1.0.26

## 0.0.6

### Patch Changes

- a3b7673: fix: 调整依赖项
- Updated dependencies [a3b7673]
- Updated dependencies [5141137]
  - @zhin.js/adapter-icqq@1.0.25
  - zhin.js@1.0.20

## 0.0.5

### Patch Changes

- f9faa1d: fix: test release
- Updated dependencies [f9faa1d]
  - @zhin.js/adapter-icqq@1.0.24

## 0.0.4

### Patch Changes

- d16a69c: fix: test trust publish
- Updated dependencies [d16a69c]
  - @zhin.js/adapter-icqq@1.0.23

## 0.0.3

### Patch Changes

- @zhin.js/adapter-icqq@1.0.22

## 0.0.2

### Patch Changes

- @zhin.js/adapter-icqq@1.0.21
