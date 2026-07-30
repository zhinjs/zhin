# @zhin.js/cli

## 2.0.2

### Patch Changes

- Updated dependencies [d5cd4aa]
  - @zhin.js/runtime@1.0.4
  - @zhin.js/command@1.0.4
  - @zhin.js/pagemanager@2.0.7
  - @zhin.js/config-yaml@1.0.4
  - @zhin.js/adapter@1.1.2
  - @zhin.js/component@1.0.4
  - @zhin.js/core@1.4.2
  - @zhin.js/agent@1.0.7
  - @zhin.js/speech@2.0.2

## 2.0.1

### Patch Changes

- cdf64e7: 多方向审计修复批（8 面 30+ bug）：

  - **安全**：钉钉 webhook 验签绕过修复（缺 timestamp/sign 一律 403 + ±1h 防重放）；exec-policy fail-closed（换行/`$(`/反引号拒绝、管道逐段过白名单、env dump 复合拆段）；wecom 验签改 timingSafeEqual；config:set 拒绝 `__proto__` 等魔术键、host 键优先防覆写。
  - **P0 功能**：`zhin packages` scoped 包名解析为空导致 rm -rf 风险；命令数字参数解析失败炸断消息链路（dispatch 捕获 continue）；TaskQueue 监听器首个事件自摘除导致 assistant 队列挂死（+超时后完成不覆盖终态）；DatabaseHost 跨世代共享崩溃（define 幂等 + stop 改进程级）；rss 按不存在 id 列删除改业务键。
  - **Runtime/HMR**：native watcher 过滤忽略目录（lib/.zhin 不再触发重载风暴）；host 段配置 patch（http.port 等）存在 installResources 时全量重建；capability 目录非 entry 支持文件升级进程重启；documentTransaction 失败回滚。
  - **CLI 写侧**：config/setup 对 toml 静默假成功改统一 config-file（不支持格式报错）；doctor/onboard 默认配置改新形态 plugins 映射；schedule add 改 --prompt；migrate engines/中文模板误伤/覆盖前备份。
  - **适配器生命周期**：napcat/milky start 失败竞态与僵尸连接、心跳 close 清理、stop-during-connect settle；slack webhook 二次 writeHead + messageChannelMap LRU。
  - **Host/向导**：logs/stats 与 inbox 查询改 DB 侧 count/orderBy/limit 下推；save-yaml 写入前校验；zhipu/moonshot baseUrl 必填预填；.env 写入转义 + 幂等合并；setup 数据库密码不再明文落 config；60s fetch 超时与 JSON 守卫。

- 2d0a159: 审计尾账清零（P2 批）：

  - Runtime：reload 前重读配置文档消除陈旧快照；组合式根 schema 显式报错（不再静默空 view）；ConfigPatch 支持数组数字索引（`endpoints.0.url`）；console 配置读写单一数据源 + 写入串行化；watch tick 防重叠 + fetch 超时。
  - Host/MCP：MCP client stop 成功才标记 + handoff 补 quiescePrevious/resumePrevious（独占端口不再新旧并存）；readJsonBody 超限保留连接回 413；dispatchHttp 统一 HttpBodyError 状态码；inbox endpoint 名仅命中才缓存；create_plugin 工具生成物改 definePlugin 新格式。
  - Agent：CapabilityIngress 按 projection 归属记账（key 振荡不再泄漏/误 purge）；敏感目录 `data` 锚定工作区根（src/data 不再误伤）；passive-group-buffer 死 key 清扫；tool scopes 数组校验。
  - 插件：blackjack 终局「回复 1」复活（getLatestForUser）；60s apiBase 改运行时求值（弃 process.env）；rss \_db lifecycle 清理；group-suite flush 不丢计数 + checkin 串行化防双签；milky SSE start 失败复位。
  - 工具链：applyAdaptersToConfig 改合并（重跑 wizard 不丢手工 endpoint）；html-renderer 提示识别 plugins 映射；create-zhin CLI 项目名校验 + task XML/NSSM 修复；setup --ai 补 @zhin.js/tool；layout 发现支持 .ts。

- 078e3f7: 架构统一批（AURA）：

  - **EndpointLifecycle 基座**（@zhin.js/adapter 新增 `createEndpointLifecycle`）：WS/SSE 端点的 start 失败复位、仅曾 open 才退避重连（指数+jitter 可配）、stop 不重连、PONG 看门狗、定时器集中清理、陈旧事件防叠套；napcat/milky/onebot11/onebot12/satori 已迁移（删除各自手写状态机），从此同类竞态在结构上不可能再犯。
  - **Generation-store**（@zhin.js/plugin-runtime 新增 `createGenerationStore`）：模块级运行时状态的一等能力，provide 自动挂 lifecycle 反注册（代际结束自动清理）；lottery deps 与 rss db 已迁移，公开 API 兼容。
  - **Resolver 管线收敛**（@zhin.js/runtime）：解析规则统一为 local path → workspace → node_modules 单管线；optional 引用对所有 PackageResolutionError 容错（消除 message 前缀补丁）。
  - **工具目录准入统一**（@zhin.js/agent）：RegisteredToolSource 与 ExternalToolSource 共用同一 `canAccessTool` 准入（platforms/scopes/permissions/hidden 四元组全链路透传），同名覆盖 warn；AgentToolRegistration 补 platforms/scopes。两条注册通道（静态约定 vs 动态注册）职责边界已文档化。

- 5b439e6: 插件包生命周期命令补全：`zhin uninstall` 注册进 CLI 并现代化——卸载时从新格式配置（`plugins.<instanceKey>` 映射，兼容 legacy 数组）和 package.json 的 `zhin.plugins` 挂载清单中同时移除，本地插件目录 `./plugins/<name>` 改为确认后删除（替代旧 src/plugins 路径）。`zhin install` 修复"只写配置不挂载"：启用后同步把 `{package, instanceKey}` 合并进 `zhin.plugins` 清单（此前插件不会真正加载）。至此 `new / build / pub / install / uninstall / search` 全部可用且对齐 Plugin Runtime 约定。
- 43485a9: 架构对齐修复（platformFeatures 继承落地）：

  - `zhin.js` 主包 `zhin.plugins` 清空：host-router/host-api 是 legacy 插件包（`usePlugin` 入口），经 graph 加载会崩溃；新 Runtime 的 Console 由 cli 装配，门面保持纯 re-export。
  - `@zhin.js/runtime` package-resolver：`declaredDependency` 接受 `peerDependencies`（optional peer 是合法声明，未安装时由 `optional` 引用容错）。
  - `@zhin.js/cli` PackageCutover 检查器适配继承形态：依赖 zhin.js/core 时 manifest `features` 可省略 command/component/middleware（platformFeatures 继承），不再误报 blocked。
  - 文档：新增 `docs/architecture/package-topology.md`（包结构依赖图与各层 zhin 字段配置指南）。

- f0ec5ab: 五分钟首跑闭环（P1-2.1）。

  - `create-zhin-app`：依赖安装完成后自动运行项目内 `zhin doctor` 做安装后自检（Node 版本 / pnpm / 配置文件 / Console 登录条件 / 端口占用），自检失败不阻断创建流程。
  - `@zhin.js/cli`：`zhin runtime start` 启动成功后输出醒目的首跑指引（Remote Console 地址、Host `http://127.0.0.1:<port>`、token 在 `.env` 的 `HTTP_TOKEN`、Sandbox 页发送 hello），新增 `--open` / `ZHIN_OPEN=1` 自动打开浏览器（CI 与无显示环境自动跳过）；`zhin doctor` 的 pnpm 修复提示补充 corepack 方式、端口占用提示补充 `http.port` 换端口方案，AI 引导文件（SOUL/TOOLS/AGENTS）检查改为仅在启用 AI 时执行，避免 IM-only 首跑项目收到误导性警告。
  - `@zhin.js/core`：`MessageGateway` 接口新增 `setUnmatchedHandler`（此前仅 `ImRuntime` 实现类上有，Host AI 回退同款钩子），支撑单文件 bot 在无 `commands/` 约定目录时响应消息。
  - 新增 `examples/single-file-bot`：一个 `bot.ts` 即完整机器人（definePlugin + defineCommand + sandbox adapter），附 README 说明单文件与约定目录布局的取舍。

- 3e925d0: 删除 legacy 插件包 `@zhin.js/host-api` 与 `@zhin.js/host-router`（legacy `usePlugin` 插件栈下线）：

  - **包删除**：`@zhin.js/host-api`、`@zhin.js/host-router` 从仓库移除，后续版本不再发布。Console / HTTP Host 由 `@zhin.js/cli`（composition root）用 `@zhin.js/host-http` + `@zhin.js/pagemanager` 自动装配，用户无需、也不能再安装这两个插件。
  - **zhin.js**：移除对 host-api / host-router 的 optional peer 依赖；`shutdown.ts` 不再动态导入 host-api 的 `stopSseHub`（SSE Hub 生命周期由 CLI 装配层管理）。
  - **@zhin.js/mcp / @zhin.js/a2a**：移除对 host-router 的 peer 依赖；legacy `usePlugin` 入口改为本地结构类型（运行时走 `./runtime` 子路径，由 CLI 经 host-http 装配，行为不变）。
  - **@zhin.js/cli**：`config check` / `doctor` / `setup` 不再检查或写入 host 插件；全局实例（~/.zhin）脚手架不再声明 host-api / host-router。
  - **@zhin.js/scaffold-wizard**：移除 `CONSOLE_HOST_PLUGINS` 导出与 `ConsoleConfigDiagnosis.missingHostPlugins` 字段；`zhin-stack-deps` 不再含 host 包；`stack-versions.generated.json` 同步移除。
  - **@zhin.js/agent**：稳定性监控移除 host-api SSE 订阅数采集（`collectStabilityMetrics` 不再支持 `includeSse`，快照不再有 `sseSubscribers`）。

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
- Updated dependencies [8c7d03d]
- Updated dependencies [3e925d0]
- Updated dependencies [fa66c4c]
- Updated dependencies [fa66c4c]
- Updated dependencies [6cb6152]
  - @zhin.js/runtime@1.0.3
  - @zhin.js/command@1.0.3
  - @zhin.js/agent@1.0.6
  - @zhin.js/plugin-runtime@1.1.1
  - @zhin.js/host-http@1.0.3
  - @zhin.js/scaffold-wizard@0.2.1
  - @zhin.js/config-yaml@1.0.3
  - @zhin.js/database@1.0.78
  - @zhin.js/schedule@0.0.4
  - @zhin.js/speech@2.0.1
  - @zhin.js/adapter@1.1.1
  - @zhin.js/core@1.4.1
  - @zhin.js/component@1.0.3
  - @zhin.js/pagemanager@2.0.6

## 2.0.0

### Patch Changes

- e5c84ed: Adapter 多账号：插件实例 config 支持 `endpoints: [{name, ...覆盖}]` 数组，`expandEndpointConfigs` 将一个实例展开为多个 endpoint record（id 为 `<slotId>~<name>`，顶层字段共享、逐项覆盖），替代多 `instanceKey` 方案；Console `/api/plugins` 收敛为一个插件卡片 + 多 endpoint。icqq / qq schema 与 README 补 `endpoints` 配置。

  Plugin Runtime Console Host：补 `/esm/*` React/router ESM 代理路由（legacy `consoleApiRouter` 对齐），TypeScriptClientBuilder 裸导入改写为 `/esm/<enc>.mjs`。

- 3ea84a0: Plugin Runtime 插件 agent 工具接线：新增 `agentToolsHostToken`（generation 作用域的 Agent Tools Host），插件 `setup()` 可经闭包向 Agent Host 注册工具（桥接 zod inputSchema → JSON parameters + execute 前校验），解决 Runtime 下插件 `agent/tools` 不被发现、`lottery agent deps not initialized` 的问题。lottery 7 个 `lottery_*` 工具已按此接线（`agent/runtime-tools.ts`）；`/api/introspection/tools` 合并 agent 注册工具。
- 1ddcd70: Console/契约扫尾批：

  - adapter：多 endpoint record name 改为 entry.name（Console 展示/resolve/inbox 按名唯一命中）；`expandEndpointConfigs` 增加缺名/非法字符/重名校验与告警；slack endpoint 补 `name` getter；inbox-installer / agent-host 解析 `slot~entry` 展开 id（activity-feedback 随之恢复）。
  - host-http：`schema:get`/`config:get` 兼容 `data.plugin`；extended RPC 参数顶层与 `data` 合并（cron 写操作修复）；请求审批认 `requestId`、已读认单值 `id`；`endpoint:requests`/`inboxRequests`/`inboxNotices` 行补 camelCase/扁平别名；cron 列表补 `expression/running/plugin/nextExecution/createdAt/context`。
  - cli：装配 `setOrchestrationRuntime`/`setSessionTreeRuntime`（agent-sessions/orchestration 页恢复）；`/api/stats` 补 commands/components 计数；console REST databaseHost.started 改动态 getter；`wrapModel` 支持 orderBy/limit 链式查询；接线 SystemLog 模型 + 日志 transport（logs 页有真实数据，带 7 天/1 万条清理）。
  - plugin-runtime：`DatabaseHostModel.select` 升级为链式 `DatabaseHostSelection`；新增 `system-log`（SystemLog 表定义/写入助手）。
  - agent：导出 `asPrivate`（Runtime Host 装配 session tree runtime 用）。

- ac9da66: 深化 Remote Console wire contract：统一 canonical Endpoint RPC/SSE 名称与旧别名规范化，新增共享 `ConsoleEndpointSummary`、EndpointManagement 能力词汇和方法派生能力清单。Plugin Runtime Host 与 legacy Host 现在都会在 `endpoint.list` / `endpoint.info` 返回 `managementCapabilities`，Console SDK 与官方 UI 不再按适配器名称猜测管理能力。

  发布时必须同时发布 `@zhin.js/console-protocol` 与 `@zhin.js/client`；Client 从既有 protocol 运行时依赖重导出协议常量、规范化函数和 Endpoint wire 类型。

- Updated dependencies [7db69c1]
- Updated dependencies [e5c84ed]
- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
- Updated dependencies [ac9da66]
- Updated dependencies [713445c]
- Updated dependencies [15bbdb3]
- Updated dependencies [0356aa1]
  - @zhin.js/core@1.4.0
  - @zhin.js/pagemanager@2.0.5
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/agent@1.0.5
  - @zhin.js/host-http@1.0.2
  - @zhin.js/scaffold-wizard@0.2.0
  - @zhin.js/speech@2.0.0
  - @zhin.js/runtime@1.0.2
  - @zhin.js/command@1.0.2
  - @zhin.js/component@1.0.2
  - @zhin.js/config-yaml@1.0.2

## 1.0.95

### Patch Changes

- 90f301d: fix: log format

## 1.0.94

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
  - @zhin.js/schedule@0.0.3
  - @zhin.js/pagemanager@2.0.4
  - @zhin.js/scaffold-wizard@0.1.9
  - @zhin.js/logger@1.0.75
  - @zhin.js/database@1.0.77
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/speech@1.0.4
  - @zhin.js/config-yaml@1.0.1
  - @zhin.js/runtime@1.0.1

## 1.0.93

### Patch Changes

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/agent@1.0.3
  - @zhin.js/logger@1.0.74
  - @zhin.js/scaffold-wizard@0.1.8

## 1.0.92

### Patch Changes

- 5cc9c03: fix: ai 优化
- b9b3881: fix: 增加游戏引擎以及部分游戏
- Updated dependencies [5cc9c03]
- Updated dependencies [b9b3881]
  - @zhin.js/logger@1.0.73
  - @zhin.js/scaffold-wizard@0.1.7

## 1.0.91

### Patch Changes

- b2c73bd: fix: 初始化项目后,安装依赖失败
- c4575c9: fix: 输入输出优化,文档优化
- Updated dependencies [b2c73bd]
- Updated dependencies [c4575c9]
  - @zhin.js/scaffold-wizard@0.1.6
  - @zhin.js/logger@1.0.72

## 1.0.90

### Patch Changes

- 7dfafc2: fix: ai 提示词缓存优化
- ae5239c: fix: 核心包瘦身
- Updated dependencies [7dfafc2]
- Updated dependencies [ae5239c]
  - @zhin.js/scaffold-wizard@0.1.5

## 1.0.89

### Patch Changes

- d8def69: fix: 性能优化
- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - @zhin.js/logger@0.1.71
  - @zhin.js/scaffold-wizard@0.1.4

## 1.0.88

### Patch Changes

- Updated dependencies [d8547d2]
  - @zhin.js/scaffold-wizard@0.1.3

## 1.0.87

### Patch Changes

- 3735e96: fix: 智能家居控制
- 238de62: fix: 内置命令优化
- Updated dependencies [3735e96]
  - @zhin.js/scaffold-wizard@0.1.2

## 1.0.86

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - @zhin.js/logger@0.1.70
  - @zhin.js/scaffold-wizard@0.1.1

## 1.0.85

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新

## 1.0.84

### Patch Changes

- ccb6e24: fix: zhin.js 瘦身

## 1.0.83

### Patch Changes

- 90d9efd: fix: 处理包名
- Updated dependencies [90d9efd]
  - @zhin.js/logger@0.1.69

## 1.0.82

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [7e14f8d]
  - @zhin.js/logger@0.1.68
  - zhin.js@1.0.86

## 1.0.81

### Patch Changes

- zhin.js@1.0.85
- @zhin.js/logger@0.1.67

## 1.0.80

### Patch Changes

- 0db9fed: fix: deno deploy
- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
  - zhin.js@1.0.84
  - @zhin.js/logger@0.1.66

## 1.0.79

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - zhin.js@1.0.83
  - @zhin.js/logger@0.1.65

## 1.0.78

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/logger@0.1.64
  - zhin.js@1.0.82

## 1.0.77

### Patch Changes

- Updated dependencies [8086ccb]
  - zhin.js@1.0.81
  - @zhin.js/logger@0.1.63

## 1.0.76

### Patch Changes

- zhin.js@1.0.80
- @zhin.js/logger@0.1.62

## 1.0.75

### Patch Changes

- zhin.js@1.0.79
- @zhin.js/logger@0.1.61

## 1.0.74

### Patch Changes

- zhin.js@1.0.78
- @zhin.js/logger@0.1.60

## 1.0.73

### Patch Changes

- zhin.js@1.0.77
- @zhin.js/logger@0.1.59

## 1.0.72

### Patch Changes

- Updated dependencies [cb9fbf1]
  - zhin.js@1.0.76
  - @zhin.js/logger@0.1.58

## 1.0.71

### Patch Changes

- zhin.js@1.0.75
- @zhin.js/logger@0.1.57

## 1.0.70

### Patch Changes

- c9dec38: fix: ai 架构优化,文档更新
- Updated dependencies [c9dec38]
  - zhin.js@1.0.74
  - @zhin.js/logger@0.1.56

## 1.0.69

### Patch Changes

- zhin.js@1.0.73
- @zhin.js/logger@0.1.55

## 1.0.68

### Patch Changes

- abc75a4: fix: 优化,客户端构建优化

## 1.0.67

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - @zhin.js/logger@0.1.54
  - zhin.js@1.0.72

## 1.0.66

### Patch Changes

- 4304825: fix: 重新发版
- cea7a33: fix: cli 优化
- Updated dependencies [4304825]
  - @zhin.js/logger@0.1.53
  - zhin.js@1.0.71

## 1.0.65

### Patch Changes

- d0250e8: fix: 修复 onebot11 的反向 bug,优化 cli
  - zhin.js@1.0.68
  - @zhin.js/logger@0.1.52

## 1.0.64

### Patch Changes

- zhin.js@1.0.67
- @zhin.js/logger@0.1.51

## 1.0.63

### Patch Changes

- zhin.js@1.0.66
- @zhin.js/logger@0.1.50

## 1.0.62

### Patch Changes

- zhin.js@1.0.65
- @zhin.js/logger@0.1.49

## 1.0.61

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - @zhin.js/logger@0.1.48
  - zhin.js@1.0.64

## 1.0.60

### Patch Changes

- zhin.js@1.0.63
- @zhin.js/logger@0.1.47

## 1.0.59

### Patch Changes

- zhin.js@1.0.62
- @zhin.js/logger@0.1.46

## 1.0.58

### Patch Changes

- zhin.js@1.0.61
- @zhin.js/logger@0.1.45

## 1.0.57

### Patch Changes

- Updated dependencies [5073d4c]
  - zhin.js@1.0.60
  - @zhin.js/logger@0.1.44

## 1.0.56

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - @zhin.js/logger@0.1.43
  - zhin.js@1.0.59

## 1.0.55

### Patch Changes

- zhin.js@1.0.58
- @zhin.js/logger@0.1.42

## 1.0.54

### Patch Changes

- zhin.js@1.0.57
- @zhin.js/logger@0.1.41

## 1.0.53

### Patch Changes

- zhin.js@1.0.56
- @zhin.js/logger@0.1.40

## 1.0.52

### Patch Changes

- zhin.js@1.0.55
- @zhin.js/logger@0.1.39

## 1.0.51

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - @zhin.js/logger@0.1.38
  - zhin.js@1.0.54

## 1.0.50

### Patch Changes

- zhin.js@1.0.53
- @zhin.js/logger@0.1.37

## 1.0.49

### Patch Changes

- bb6bfa8: feat: `zhin new` 为插件创建 `skills/<name>/` 与 `SKILL.md` 模板；生成 `package.json` 的 `files`/`exports`（含 `development`、`./package.json`）与仓库插件约定对齐
- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - zhin.js@1.0.52
  - @zhin.js/logger@0.1.36

## 1.0.48

### Patch Changes

- zhin.js@1.0.51
- @zhin.js/logger@0.1.35

## 1.0.47

### Patch Changes

- zhin.js@1.0.50
- @zhin.js/logger@0.1.34

## 1.0.46

### Patch Changes

- zhin.js@1.0.49
- @zhin.js/logger@0.1.33

## 1.0.45

### Patch Changes

- zhin.js@1.0.48
- @zhin.js/logger@0.1.32

## 1.0.44

### Patch Changes

- Updated dependencies [de3e352]
  - zhin.js@1.0.47
  - @zhin.js/logger@0.1.31

## 1.0.43

### Patch Changes

- 7394603: fix: cli 优化, windows 用户体验优化
  fix: 新增消息过滤系统
- Updated dependencies [7394603]
  - zhin.js@1.0.46
  - @zhin.js/logger@0.1.30

## 1.0.42

### Patch Changes

- zhin.js@1.0.45
- @zhin.js/logger@0.1.29

## 1.0.41

### Patch Changes

- zhin.js@1.0.44
- @zhin.js/logger@0.1.28

## 1.0.40

### Patch Changes

- Updated dependencies [72ec4ba]
  - zhin.js@1.0.43
  - @zhin.js/logger@0.1.27

## 1.0.39

### Patch Changes

- zhin.js@1.0.42
- @zhin.js/logger@0.1.26

## 1.0.38

### Patch Changes

- zhin.js@1.0.41
- @zhin.js/logger@0.1.25

## 1.0.37

### Patch Changes

- Updated dependencies [7ef9057]
  - zhin.js@1.0.40
  - @zhin.js/logger@0.1.24

## 1.0.36

### Patch Changes

- 04f76ac: fix: 工具命名格式优化
  - zhin.js@1.0.39
  - @zhin.js/logger@0.1.23

## 1.0.35

### Patch Changes

- Updated dependencies [ab5c54a]
  - zhin.js@1.0.38
  - @zhin.js/logger@0.1.22

## 1.0.34

### Patch Changes

- zhin.js@1.0.37
- @zhin.js/logger@0.1.21

## 1.0.33

### Patch Changes

- 6d94111: fix: 增加 github 适配器,更改 auth 为 token auth
  - zhin.js@1.0.36
  - @zhin.js/logger@0.1.20

## 1.0.32

### Patch Changes

- 8502351: fix: token 优化
  - zhin.js@1.0.35
  - @zhin.js/logger@0.1.19

## 1.0.31

### Patch Changes

- 634e2d7: fix: ai 强化
  - zhin.js@1.0.34
  - @zhin.js/logger@0.1.18

## 1.0.30

### Patch Changes

- zhin.js@1.0.33
- @zhin.js/logger@0.1.17

## 1.0.29

### Patch Changes

- 48481a8: fix: @zhin.js/adapter-icqq 内置点赞工具
  fix: create-zhin-app 默认增加 send 指令
  fix: @zhin.js/cli 重命名 onborading 为 onborad 并重写实现,新增 zhin send 命令，用于直接通过 send 命令发送消息
  fix: @zhin.js/host-router 新增消息发送 api

## 1.0.28

### Patch Changes

- zhin.js@1.0.32
- @zhin.js/logger@0.1.16

## 1.0.27

### Patch Changes

- 771706d: fix: 技能优化
  - zhin.js@1.0.31
  - @zhin.js/logger@0.1.15

## 1.0.26

### Patch Changes

- Updated dependencies [460a6c6]
  - zhin.js@1.0.30
  - @zhin.js/logger@0.1.14

## 1.0.25

### Patch Changes

- zhin.js@1.0.29
- @zhin.js/logger@0.1.13

## 1.0.24

### Patch Changes

- 05a514d: fix: ai 增强,cli 增强
  - zhin.js@1.0.28
  - @zhin.js/logger@0.1.12

## 1.0.23

### Patch Changes

- 2b44e18: fix: change version

## 1.0.22

### Patch Changes

- Updated dependencies [b27e633]
  - zhin.js@1.0.27
  - @zhin.js/logger@0.1.11

## 1.0.21

### Patch Changes

- 106d357: fix: ai
- Updated dependencies [106d357]
  - zhin.js@1.0.26
  - @zhin.js/logger@0.1.10

## 1.0.20

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai
- Updated dependencies [26d2942]
- Updated dependencies [6b02c41]
  - @zhin.js/logger@0.1.9
  - zhin.js@1.0.25

## 1.0.19

### Patch Changes

- zhin.js@1.0.24
- @zhin.js/logger@0.1.8

## 1.0.18

### Patch Changes

- 52ae08a: fix: 更新消息处理流程
- Updated dependencies [52ae08a]
  - zhin.js@1.0.23
  - @zhin.js/logger@0.1.7

## 1.0.17

### Patch Changes

- Updated dependencies [26aba27]
  - zhin.js@1.0.22
  - @zhin.js/logger@0.1.6

## 1.0.16

### Patch Changes

- zhin.js@1.0.21
- @zhin.js/logger@0.1.5

## 1.0.15

### Patch Changes

- 7aa94b1: fix: 更新 create-bot

## 1.0.14

### Patch Changes

- a3b7673: fix: 调整依赖项
- Updated dependencies [a3b7673]
- Updated dependencies [5141137]
  - @zhin.js/logger@0.1.4
  - zhin.js@1.0.20

## 1.0.13

### Patch Changes

- f9faa1d: fix: test release
- Updated dependencies [f9faa1d]
  - @zhin.js/logger@0.1.3
  - zhin.js@1.0.19

## 1.0.12

### Patch Changes

- d16a69c: fix: test trust publish
- Updated dependencies [d16a69c]
  - @zhin.js/logger@0.1.2
  - zhin.js@1.0.18

## 1.0.11

### Patch Changes

- 3bc5d56: fix: 内存优化

## 1.0.10

### Patch Changes

- cda76be: fix: add adapters

## 1.0.9

### Patch Changes

- 8b367ab: fix: cli err

## 1.0.8

### Patch Changes

- 547028f: fix: 优化包结构,优化客户端支持

## 1.0.7

### Patch Changes

- c1a539e: fix: cli 优化,console 优化
- Updated dependencies [c8c3996]
  - @zhin.js/logger@0.1.1

## 1.0.6

### Patch Changes

- c490260: fix: 更新脚手架结构,优化包依赖

## 1.0.5

### Patch Changes

- f347667: fix: runtime error

## 1.0.4

### Patch Changes

- d291005: fix: 更新 cli,更新 http

## 1.0.3

### Patch Changes

- ffa9cbc: fix: create-zhin-app 查询 cli 路径错误

## 1.0.2

### Patch Changes

- 15fc934: fix: 支持 jsx
- ebf852c: fix: change docs,add @types/node
- cd8c8a8: fix: 更改默认配置的插件查找目录

## 1.0.1

### Patch Changes

- efdd58a: fix: init
