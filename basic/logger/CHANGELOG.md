# @zhin.js/logger

## 1.1.3

### Patch Changes

- 57c6cdc: fix: 全仓审计修复

  - kernel: 模板求值沙箱不再泄漏宿主对象——宿主函数的返回值与抛出的错误会重新包裹代理（`segments.map(x=>x).constructor.constructor(...)` 之前可拿到宿主 `Function`），并禁止通过代理写入/删除宿主属性。
  - agent: exec 白名单正则按整体锚定（`git|npm` 不再匹配 `gitevil`）；SSRF 主机名黑名单识别尾点形式（`localhost.`）；Docker 沙箱 `always` 模式的 fail-closed 分支可被触达；声明缺失的 `chalk` 依赖。
  - ai: 摘要按最新优先加载（超过 500 条时不再使用过期锚点）；修复 `test` 脚本指向不存在的配置。
  - cli: `ZHIN_LOG_LEVEL` 生效（修复运算符优先级）；移除旧守护进程遗留的无引用进程辅助函数。
  - logger: `formatCompact` 不再把 `config: 'yaml'`、`direction: 'in'` 这类非路径值改写成 `./yaml`。
  - host-http: 未配置数据库时 `db:tables` 与有数据库时一致返回 `{ tables }`。
  - a2a: 405 响应把 `Allow` 放进响应头。
  - pagemanager: 内联进 `<script>` 的页面元数据转义 `<`。
  - client: 事件历史请求失败时携带 HTTP 状态，token 失效可触发重新登录。
  - scaffold-wizard / create-zhin-app: 修正适配器文档 URL 与模板里的 `@zhin.js/tool` 导入。
  - adapter-wechat-mp: 签名比较改为常量时间。
  - adapter-kook: 声明运行时依赖 `ws`。
  - plugin-lottery: 遗漏值按最近一次出现计算；推送目标 schema 字段与实现一致（`endpointKey`）。
  - plugin-code-runner: 语言校验改用自有属性判断。
  - plugin-link-poster: 抓取前校验主机名白名单（修复 SSRF），超时覆盖响应体读取。
  - 其余包：从 `files` 中移除不存在的目录。
  - feature-kit / middleware: 修正 README 中层级错误的文档链接。

- e1fda87: fix: 按审计待审清单处理（安全、功能、清理）

  **行为变更（升级前请阅读）**

  - kernel / core / zhin.js：出站文本中的 `${…}` 不再用 `vm` 求值，只替换 `TemplateContext` 上能解析到值的属性路径（如 `${sender.name}`）；表达式、函数调用、未知名字原样保留。整套 vm 沙箱（`evaluate` / `execute` / `compiler` / `getValueWithRuntime`）已移除。
  - kernel / core / zhin.js：移除零引用的遗留导出——`Scheduler`、错误管理器与 `ZhinError` 子类、`compose`、`segment.from/toString`、AI 触发/准入函数、`@zhin.js/core/queue-im-field-contract`、`zhin.js/contexts`。
  - agent：readonly 执行预设不再放行重定向、后台 `&`、进程替换、`find -delete/-exec`、`sed -i`、`sort -o`、`tee`、`xargs`、awk；curl/wget 校验每个 URL 与裸主机并识别更多上传参数；自定义 `execAllowlist` 中的只读命令带写入风险时改走审批。沙箱超时/取消会杀掉进程组或具名容器，默认镜像改为 `node:22-bookworm-slim` + `bash`。移除无生产调用的 `AuditLogger`、`AnomalyDetector`、旧 vision 回合等导出。
  - ai：移除 `storage`、`FileStateCache`、`CostTracker`、`model-name-utils`、`./agent-step-checkpoint` 子路径、`ContextManager` 及旧压缩管线；延迟工具快照改为有界 LRU。
  - cli：`zhin send` / `watch` / `schedule` 改为与运行中的 Host 通信（新增 `POST /message/send` 与 `/assistant/jobs` 写接口），`schedule` 不再支持离线改文件；移除 `zhin uninstall service`（用 `zhin service uninstall`）、`build --analyze`、`install -S`；`zhin stop` 杀不掉进程时保留 pid 文件并以非零退出；`runtime migrate` 新增 `verify`；未设置 `TZ` 时调度默认时区改为系统时区；不带 `ZHIN_SUPERVISOR_PID` 的进程被 init 接管后不再自行退出。
  - schedule：后台 reconcile 出错不再产生未处理 rejection（新增 `onStoreError`）；启动途中 `stop()` 不再遗留定时器。
  - schema：元组校验与 `safeParse`、JSON Schema 一致（空数组不通过，缺省的可选元组为 `undefined`）。
  - client / contract：删除无后端路由的 agent-stream API、未使用的 `definePage` 与旧 PageManager 类型；`@zhin.js/contract` 不再依赖 `@zhin.js/ai`；客户端收到 401 会清除已保存的凭据；安装/更新/卸载 RPC 默认超时 120 秒。
  - a2a：流式响应中途出错写入 SSE error 并结束；未配置 token 的非生产环境只接受本机请求；任务存储有上限与过期；Mailbox 凭据回退与生产环境缺密钥检查修复。
  - speech：`provider: openai` 不再套用 Ollama 的默认 host/model；识别语言改为可配置，不再写死 `zh`。
  - adapter-lark：支持 `encryptKey` 加密事件解密。adapter-github：Device Flow 可取消、带超时并回复失败原因。adapter-wecom / dingtalk：请求加超时并校验 HTTP 状态。adapter-weixin-ilink：输入关闭期间暂停轮询。adapter-milky：SSE 支持 CRLF、缓冲上限与空闲重连。adapter-onebot-events：好友删除通知改为 `notice.friend.decrease`。
  - plugin-group-suite：`teachAllowRegex` 默认关闭，正则安全检查更严格。plugin-qrcode：改为本地生成，回复 data URL 图片。plugin-rss / short-url / link-poster：拒绝解析到内网的地址；rss 修复条目每周重复推送；short-url 的 Console 创建改为真实调用 is.gd。plugin-lottery：按 `historyLimit` 同步。

  **其余**

  - host-http：插件市场详情加缓存与包名校验，SSE 回放容忍背压。host-http-contract：新增 `readTextBody()`，九个适配器改用它。
  - pagemanager：页面外壳 importmap 升级到 React 19.2.8 / react-router 7.12.0。console-contract：`definePage` 接受 `description` / `group` / `parent` / `fullWidth`。
  - command：进度提示本地化，匹配不再重复拷贝消息段。runtime：源码监听降级后退避重试原生监听。
  - html-renderer：删除未接线的 `aiTextAsImage`。create-zhin-app / scaffold-wizard：移除不起作用的"全局安装 CLI"与运行时选择提示。
  - 依赖声明清理、发布清单不再携带解析不到的 `src` 目录、移除未使用的 Skill 挂载、README 与示例配置按当前实现更正。

## 1.1.2

### Patch Changes

- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

## 1.1.1

### Patch Changes

- 9110ab8: Move optional Speech loading and pipeline ownership into the CLI composition root. Agent media handling now depends on an explicitly injected `AudioTranscriptionPort`; Core no longer exposes a process-global Speech loader, and Logger no longer exposes the process-global warn-once registry.

## 1.1.0

### Minor Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

## 1.0.77

### Patch Changes

- 09b14d6: Publish clearer package and authoring API documentation for generated references and editor IntelliSense.

## 1.0.76

### Patch Changes

- f8c7a54: fix: im

## 1.0.75

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

## 1.0.74

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化

## 1.0.73

### Patch Changes

- 5cc9c03: fix: ai 优化

## 1.0.72

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化

## 1.0.71

### Patch Changes

- chore: align stable version line to 1.0.x (no API change from 0.1.71)

## 0.1.71

### Patch Changes

- d8def69: fix: 性能优化
- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限

## 0.1.70

### Patch Changes

- c8f8207: fix: 修复内存泄露问题

## 0.1.69

### Patch Changes

- 90d9efd: fix: 处理包名

## 0.1.68

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [7e14f8d]
  - zhin.js@1.0.86

## 0.1.67

### Patch Changes

- zhin.js@1.0.85

## 0.1.66

### Patch Changes

- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
  - zhin.js@1.0.84

## 0.1.65

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - zhin.js@1.0.83

## 0.1.64

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - zhin.js@1.0.82

## 0.1.63

### Patch Changes

- Updated dependencies [8086ccb]
  - zhin.js@1.0.81

## 0.1.62

### Patch Changes

- zhin.js@1.0.80

## 0.1.61

### Patch Changes

- zhin.js@1.0.79

## 0.1.60

### Patch Changes

- zhin.js@1.0.78

## 0.1.59

### Patch Changes

- zhin.js@1.0.77

## 0.1.58

### Patch Changes

- Updated dependencies [cb9fbf1]
  - zhin.js@1.0.76

## 0.1.57

### Patch Changes

- zhin.js@1.0.75

## 0.1.56

### Patch Changes

- Updated dependencies [c9dec38]
  - zhin.js@1.0.74

## 0.1.55

### Patch Changes

- zhin.js@1.0.73

## 0.1.54

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - zhin.js@1.0.72

## 0.1.53

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - zhin.js@1.0.71

## 0.1.52

### Patch Changes

- zhin.js@1.0.68

## 0.1.51

### Patch Changes

- zhin.js@1.0.67

## 0.1.50

### Patch Changes

- zhin.js@1.0.66

## 0.1.49

### Patch Changes

- zhin.js@1.0.65

## 0.1.48

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - zhin.js@1.0.64

## 0.1.47

### Patch Changes

- zhin.js@1.0.63

## 0.1.46

### Patch Changes

- zhin.js@1.0.62

## 0.1.45

### Patch Changes

- zhin.js@1.0.61

## 0.1.44

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

## 0.1.43

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - zhin.js@1.0.59

## 0.1.42

### Patch Changes

- zhin.js@1.0.58

## 0.1.41

### Patch Changes

- zhin.js@1.0.57

## 0.1.40

### Patch Changes

- zhin.js@1.0.56

## 0.1.39

### Patch Changes

- zhin.js@1.0.55

## 0.1.38

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - zhin.js@1.0.54

## 0.1.37

### Patch Changes

- zhin.js@1.0.53

## 0.1.36

### Patch Changes

- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - zhin.js@1.0.52

## 0.1.35

### Patch Changes

- zhin.js@1.0.51

## 0.1.34

### Patch Changes

- zhin.js@1.0.50

## 0.1.33

### Patch Changes

- zhin.js@1.0.49

## 0.1.32

### Patch Changes

- zhin.js@1.0.48

## 0.1.31

### Patch Changes

- Updated dependencies [de3e352]
  - zhin.js@1.0.47

## 0.1.30

### Patch Changes

- Updated dependencies [7394603]
  - zhin.js@1.0.46

## 0.1.29

### Patch Changes

- zhin.js@1.0.45

## 0.1.28

### Patch Changes

- zhin.js@1.0.44

## 0.1.27

### Patch Changes

- Updated dependencies [72ec4ba]
  - zhin.js@1.0.43

## 0.1.26

### Patch Changes

- zhin.js@1.0.42

## 0.1.25

### Patch Changes

- zhin.js@1.0.41

## 0.1.24

### Patch Changes

- Updated dependencies [7ef9057]
  - zhin.js@1.0.40

## 0.1.23

### Patch Changes

- zhin.js@1.0.39

## 0.1.22

### Patch Changes

- Updated dependencies [ab5c54a]
  - zhin.js@1.0.38

## 0.1.21

### Patch Changes

- zhin.js@1.0.37

## 0.1.20

### Patch Changes

- zhin.js@1.0.36

## 0.1.19

### Patch Changes

- zhin.js@1.0.35

## 0.1.18

### Patch Changes

- zhin.js@1.0.34

## 0.1.17

### Patch Changes

- zhin.js@1.0.33

## 0.1.16

### Patch Changes

- zhin.js@1.0.32

## 0.1.15

### Patch Changes

- zhin.js@1.0.31

## 0.1.14

### Patch Changes

- Updated dependencies [460a6c6]
  - zhin.js@1.0.30

## 0.1.13

### Patch Changes

- zhin.js@1.0.29

## 0.1.12

### Patch Changes

- zhin.js@1.0.28

## 0.1.11

### Patch Changes

- Updated dependencies [b27e633]
  - zhin.js@1.0.27

## 0.1.10

### Patch Changes

- 106d357: fix: ai
- Updated dependencies [106d357]
  - zhin.js@1.0.26

## 0.1.9

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai
- Updated dependencies [26d2942]
- Updated dependencies [6b02c41]
  - zhin.js@1.0.25

## 0.1.8

### Patch Changes

- zhin.js@1.0.24

## 0.1.7

### Patch Changes

- Updated dependencies [52ae08a]
  - zhin.js@1.0.23

## 0.1.6

### Patch Changes

- Updated dependencies [26aba27]
  - zhin.js@1.0.22

## 0.1.5

### Patch Changes

- zhin.js@1.0.21

## 0.1.4

### Patch Changes

- a3b7673: fix: 调整依赖项
- Updated dependencies [5141137]
  - zhin.js@1.0.20

## 0.1.3

### Patch Changes

- f9faa1d: fix: test release

## 0.1.2

### Patch Changes

- d16a69c: fix: test trust publish

## 0.1.1

### Patch Changes

- c8c3996: fix: 修复 segment-matcher
