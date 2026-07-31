# @zhin.js/client

## 2.1.3

### Patch Changes

- @zhin.js/contract@1.0.8

## 2.1.2

### Patch Changes

- @zhin.js/contract@1.0.7

## 2.1.1

### Patch Changes

- 5691aba: 第二轮全量审计修复批（8 面 ~60 bug）：

  - **安全**：email 附件路径穿越修复（basename + downloadPath 约束）；lark/telegram/satori webhook 鉴权（缺密钥告警、timingSafeEqual、±5min 时效窗、chat_type 修正）；onebot wss/webhook 缺 token 告警；qq webhook 改原始字节验签；renderJsx/JSX 转义注入修复；console runtime token 401 死循环。
  - **P0 功能**：sandbox 多 endpoint 解析 + WS 路径隔离；short-url expand（undici opaqueredirect）改 follow；AI 压缩摘要失败不再静默丢历史（熔断恢复生效）；console-ui 实时推送事件名归一化 + IndexedDB schema 对齐；process-monitor 热重载不再误判崩溃。
  - **生命周期**：email IMAP 断线重连 + 在飞锁；onebot11/12 start 失败清理；line replyToken TTL + push 兜底；wechat-mp token 过期重试 + MsgId 去重；weixin-ilink buf 推进/防抖写盘/媒体 TTL/QR abort；satori PONG 看门狗；退避自毁修复。
  - **游戏**：text-adventure 终局 restart 复活 + requires 服务端校验；tic-tac-toe PvP 占用/restart/队列清理/TTL；idiom-chain/word-riddle 闲聊不扣失误；别名中间件不劫持普通聊天。
  - **共享库**：schema falsy 默认值/date/tuple/union 修复；database parseCondition Date/未知操作符、sqlite TEXT 往返、query 分派、belongsToMany 方言、migration dry-run；schedule DST 回拨死循环、重复 id 去重、flush 串行化；game-kit fallback 编号/onboarding 提示/尾缀边界/活引用拷贝。
  - **渲染语音**：fetch 全部超时 + 渲染并发闸；sanitizeHtml form 保文本；STT 扩展名映射 + 删临时文件；TTS 未知 provider 报错；emojiCache LRU 负缓存/fontCache style/clearFonts 恢复；register 错误分类收窄。
  - @zhin.js/contract@1.0.6

## 2.1.0

### Minor Changes

- ac9da66: 深化 Remote Console wire contract：统一 canonical Endpoint RPC/SSE 名称与旧别名规范化，新增共享 `ConsoleEndpointSummary`、EndpointManagement 能力词汇和方法派生能力清单。Plugin Runtime Host 与 legacy Host 现在都会在 `endpoint.list` / `endpoint.info` 返回 `managementCapabilities`，Console SDK 与官方 UI 不再按适配器名称猜测管理能力。

  发布时必须同时发布 `@zhin.js/console-protocol` 与 `@zhin.js/client`；Client 从既有 protocol 运行时依赖重导出协议常量、规范化函数和 Endpoint wire 类型。

### Patch Changes

- 5849336: 修复 console hooks 自动加载的零退避死循环：`useConfig` / `useConfigYaml` / `useFiles` / `useEnvFiles` / `useDatabase` 在 RPC 失败时会以全速反复请求 `/api/console/request`（状态为空 → effect 立即重试）。新增 `useAutoLoadOnce`：每次连接会话对同一 key 只自动加载一次，断连重置，手动重试仍可用。
- Updated dependencies [ac9da66]
  - @zhin.js/console-protocol@1.1.0
  - @zhin.js/contract@1.0.5

## 2.0.6

### Patch Changes

- @zhin.js/contract@1.0.4

## 2.0.5

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/contract@1.0.3

## 2.0.4

### Patch Changes

- 5cc9c03: fix: ai 优化
- Updated dependencies [5cc9c03]
  - @zhin.js/contract@1.0.2

## 2.0.3

### Patch Changes

- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限

## 2.0.2

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - @zhin.js/contract@1.0.1

## 2.0.1

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新

## 1.1.4

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [7e14f8d]
  - @zhin.js/console-types@0.1.5

## 1.1.3

### Patch Changes

- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [f19d2e0]
  - @zhin.js/console-types@0.1.4

## 1.1.2

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/console-types@0.1.3

## 1.1.1

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/console-types@0.1.2

## 1.1.0

### Minor Changes

- Remote Console 与 Host 分离：zhin 主仓仅保留 Console **API**，静态 UI 迁至独立仓库 [zhinjs/console](https://github.com/zhinjs/console)。

  ### @zhin.js/console-core (major)

  - 移除 `./browser` 导出；包仅含 Node 侧 PageManager、`/entries`、`/@dev`、`/esm` 打包管线。
  - 不再依赖 `console-app` 内置壳；`registerBuiltinAppShellServer` 已删除。

  ### @zhin.js/client (minor)

  - 合并原 `@zhin.js/console-core/browser` 能力：`loadConsoleEntries`、`apiFetch`、`getApiBase`、`createRegistryStore` 等。
  - Remote Console UI 应依赖本包 + `zhin-console` 静态站，勿再 `import from '@zhin.js/console-core/browser'`。

  ### @zhin.js/console (major)

  - Host 默认 **api_only**（`serveClientHost: false`），不再捆绑 Farm 静态页。
  - 移除对 `@zhin.js/console-app` 的依赖；`PageManager` 的 esbuild 解析根目录改为机器人项目根（`ZHIN_PROJECT_ROOT` / `cwd`）。
  - 删除 `plugins/services/console/client` 内置 UI 源码（已迁至 zhin-console）。

## 1.0.18

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - @zhin.js/console-core@0.1.1
  - @zhin.js/console-types@0.1.1

## 1.0.17

### Patch Changes

- 4304825: fix: 重新发版

## 1.0.16

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2

## 1.0.15

### Patch Changes

- c212bf7: fix: 适配器优化

## 1.0.14

### Patch Changes

- 16c8f92: fix: 统一发一次版

## 1.0.13

### Patch Changes

- bb6bfa8: chore: 控制台路由 key、client tsc、页面模块化拆分；client/satori 的 clean 与构建产物约定对齐

## 1.0.12

### Patch Changes

- 353de3d: fix: 控制台优化

## 1.0.11

### Patch Changes

- 72ec4ba: fix: 新增插件,控制台调优

## 1.0.10

### Patch Changes

- 05a514d: fix: ai 增强,cli 增强

## 1.0.9

### Patch Changes

- 106d357: fix: ai

## 1.0.8

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai

## 1.0.7

### Patch Changes

- f9faa1d: fix: test release

## 1.0.6

### Patch Changes

- d16a69c: fix: test trust publish

## 1.0.5

### Patch Changes

- c490260: fix: 更新脚手架结构,优化包依赖

## 1.0.4

### Patch Changes

- 551c4d2: fix: 插件支持配置文件读取,优化 test 用例

## 1.1.0 (2024-10-22)

### Major Features

- ✨ **插件配置系统** - 基于 Schema 的自动化配置表单

  - 完整支持 15 种 Schema 数据类型
  - 智能 UI 组件自动选择
  - 支持任意深度的嵌套结构
  - 实时配置读取和保存

- 🏗️ **组件模块化重构**
  - PluginConfigForm 拆分为 8 个模块（17 个独立渲染器）
  - 职责单一，易于测试和扩展
  - 向后兼容，使用方式不变

### Improvements

- 🎨 表单布局优化

  - 使用 ScrollArea 控制高度
  - 使用 Accordion 折叠复杂字段
  - 统一组件尺寸（size="1"）
  - 智能分组（简单字段 vs 复杂字段）

- 📝 文档完善
  - 新增 `DEVELOPMENT.md` 开发文档
  - 更新 `README.md` 添加配置系统说明
  - 详细的 API 参考和最佳实践

### Bug Fixes

- 🐛 修复 Schema 格式兼容性问题（dict vs properties）
- 🐛 修复嵌套字段状态管理问题
- 🐛 修复 definitions 字段名称问题

## 1.0.3

### Patch Changes

- c2d9047: fix: 重复插件 bug
- c2d9047: fix: 优化中间件逻辑
- b213bbc: fix: 更新 kook 报错

## 1.0.2

### Patch Changes

- d291005: fix: 更新 cli,更新 http

## 1.0.1

### Patch Changes

- 727963c: fix: 修复 sqlite 数据错误;优化 console 展示
