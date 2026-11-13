# @zhin.js/mcp

## 1.1.27

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

- c2bbdcf: Console 访问控制（ADR 0049）：用户、角色、会话、API 令牌与审计日志存入项目数据库，每个 Console RPC、`/api` 路由与 Host 鉴权的 WebSocket 都按 `@zhin.js/console-protocol` 的权限表放行，未登记的一律拒绝。

  **破坏性变更**

  - `http.tokens` 与演示模式（`scope: demo` / `user`）删除；配置里仍有 `http.tokens` 时 Host 拒绝启动。Host 配置 Schema 同步删除该字段。
  - `http.token` 变为初始化令牌：只在创建第一个所有者之前有效，之后在所有接口上被拒绝。
  - 未在 `CONSOLE_WS_PERMISSIONS` 登记、又使用 Host 鉴权的插件 WebSocket 不再接受 Console 账号；插件自己的 WebSocket 应改用 `ws(path, { auth: 'protocol' })` 并自行校验凭据（新增 `verifyProtocolAccessToken`、`isLoopbackAddress`）。
  - OneBot 11 / 12、NapCat、Milky 的反向 WebSocket 改为只认适配器自己的 `access_token`；未配置 `access_token` 时只接受本机回环连接。
  - `zhin doctor --live` 等改从 `ZHIN_CONSOLE_TOKEN` 读取 API 令牌（仍兼容 `ZHIN_HTTP_TOKEN`）。

  **迁移步骤**（详见文档「升级到 Console 访问控制」）

  1. 升级后用 `http.token` 打开 Console 初始化向导创建第一个所有者，或运行 `zhin console init`（脚本：`zhin console init --yes --owner <名> --password-stdin`）。
  2. 删除配置里的 `http.tokens`，在 Console「访问控制」里为原来的令牌持有人创建用户并绑定角色（`viewer` / `operator` / `admin`）；演示环境改用 `viewer` 账号。
  3. 自动化在 Console 签发 API 令牌，放进 `ZHIN_CONSOLE_TOKEN`。
  4. 从其他机器或容器连接的反向 WebSocket endpoint 补上 `access_token`。
  5. 忘记密码或所有者被锁时，停下 Host，用 `zhin console user passwd|enable|create` 离线恢复。

  MCP / A2A 的 Bearer 访问同样接受用户 API 令牌（分别需要 `mcp.access`、`a2a.access`）。适配器与插件文档同步改为账号与角色的说法。

- cc7a5f9: Console 访问控制迁到网关（ADR 0054 §3 / §7，B1.4）

  - gateway：网关自己打开项目数据库（新子路径 `@zhin.js/gateway/database`，按实例同一规则解析 `database`；SQLite 为 WAL，网关连接遇忙时异步退避重试（5 秒，不使用同步 busy*timeout），超时返回 `503 database_busy` 与 Retry-After，写入都是单语句自动提交），持有 `console*_` 表，本地认证会话、API 令牌与初始化令牌；`{base}/auth/_`、`iam.\*`、`onboarding.update`、初始化向导（切换数据库后网关重连并重启实例）、终端与审计都挂在网关上，没有实例时也能登录与初始化。数据库连接或重连期间按初始化标记失败即关闭。网关运行时另一个进程（`zhin console init`）创建了所有者，网关按初始化标记立即关闭开放 Host 并重读所有者状态，不再等 30 秒的定时刷新。网关接管 `{base}/events`（合并 `gateway.packages.progress`，实例离线时只含网关事件）与 `{base}/gateway/packages/progress`。
  - host-http：桥接协议升到 3：删除过渡消息 `auth.*`；实例上报插件权限目录（`catalog`）与审计条目（`audit`），网关下发 `principal-revoked`，实例关闭该用户的 SSE 与 WebSocket。
  - console-protocol：新增 `GATEWAY_PACKAGES_PROGRESS_PATH`，网关事件说明更新。
  - database：SQLite 文件库总是开启 WAL，新增 `busyTimeoutMs`；未设置同步等待的连接（实例）对事务外语句与 `BEGIN IMMEDIATE` 遇到 `SQLITE_BUSY` 时做有界的异步退避重试（默认 5 秒，`busyRetryMs`），事务默认 `BEGIN IMMEDIATE`，声明 `readOnly` 的事务用 `BEGIN DEFERRED` + `query_only`，网关短暂持有写锁时实例写入不再报错。
  - zhin.js：受监管实例不再安装 Console 账号与终端，只对网关转发的主体授权（`--standalone` 照旧自带）。
  - mcp / a2a：配合实例不再持有 Console 令牌注册表。
  - cli：`zhin console` 经网关模块打开项目数据库。

- 5cd9d3d: HTTP 路由契约改为 Web 标准 `Request` / `Response`（ADR 0054 §2，B1.0）

  - host-http-contract：路由处理函数签名改为 `(request, context) => Response`，`context` 提供 `url`、`params`、`principal`、`remoteAddress`；新增 `readBodyBytes` / `readTextBody` / `readJsonBody`（带大小上限，超限先读完再报 413）、`jsonResponse` / `emptyResponse`、带背压的 `createResponseStream`（SSE、大文件下载）与 `WsConnection`。契约不再引用 `node:http` / `ws`。
  - host-http：Node 服务器移到 `@zhin.js/host-http/node`（`createHttpHost`），负责 Node 请求与 `Request` / `Response` 的互转；认证结果经 `context.principal` 传给路由，删除旧的按请求取主体的辅助函数；未预期的异常只返回通用错误信息，细节写日志。
  - runtime、mcp、a2a、gateway、zhin.js、calendar 插件与各适配器的 Webhook / 反向 WebSocket 路由迁移到新契约，行为不变。

- 1e54b1e: 安全加固：实例侧数据库宿主（Console 数据库页、原始 SQL、模型定义与事务）拒绝访问网关的 `console_*` 表，独立模式改用仅根可用的 `gatewayTableHost()`；Agent 文件工具把 SQLite 数据库文件视为敏感文件。SSH 终端目标必须配置 `hostFingerprint`，只有显式 `insecureAcceptAnyHostKey: true` 才跳过校验并在 Console 标为不安全。新增 `http.trustProxy`（受信任代理时从 `X-Forwarded-For` / `Forwarded` 推导客户端地址，用于限速、审计、协议鉴权与桥接）；带转发头的请求不再算本机连接（未配 `access_token` 的反向 WebSocket、MCP / A2A 本机免鉴权一律拒绝）。
- Updated dependencies [e1fda87]
- Updated dependencies [120e225]
- Updated dependencies [5cd9d3d]
  - @zhin.js/host-http-contract@1.2.0
  - @zhin.js/tool@1.1.19

## 1.1.26

### Patch Changes

- @zhin.js/core@1.1.60

## 1.1.25

### Patch Changes

- 8adce16: fix: post-refactor audit fixes across runtime, console blueprints, AI setup, and plugin stores

  - **Agent & Runtime**: adapt `DatabaseHost` models for `DatabaseEngagementJournal` after `DatabaseHost.start()` (`this[#db].select is not a function`), suppress deferred database warning in `seedInitialAiPlanIfEmpty`, lazy-load `@zhin.js/agent/runtime` in `agent-console.ts`, wrap `#receiveSideEvent` with `withEndpointEventPayload` and `captureInteraction`, select only `('id', 'timestamp')` in `SystemLogDatabaseTransport.prune()`, and surface clear install errors when optional AI/protocol packages are absent.
  - **Console Blueprints & RPC**: bundle `.ts` blueprint page entries via `esbuild` in `TypeScriptClientBuilder` so `spec`, `fields`, `dictionary`, `pollMs`, and `reviewSpec` are preserved in browser bundles; wire `CommentReviewSession` in `DeclarativePageView`; authorize `zhin.game` / `zhin.feature.game` in `plugin-console-rpc.ts`; forward `locale` in `entry-routes.ts`; pass `pluginId: entry.owner ?? entry.id` in `loadConsoleEntries.ts`.
  - **Plugin Store & Capabilities**: make `deriveStoreDisposer` idempotent in `@zhin.js/plugin-runtime`, guard nullish `carrier.resources`, handle `{ dispose }` return shapes in isolate `bootstrap.ts`, remove duplicate manual disposals in `answers`/`earthquake`, guard optional `projectLocaleToken` in `calendar`/`reminder`/`rss`/`lottery`, migrate `process-monitor` to `definePluginStore`, and align `capabilityGraph` declarations across plugins.
  - **Architectural Enhancements**:
    1. **Model Capability Baseline Catalog + Override Layer** (`@zhin.js/ai`, `@zhin.js/scaffold-wizard`, `@zhin.js/cli`): add `MODEL_CAPABILITY_CATALOG`, `inferModelCapabilities`, and `applyModelCapabilityDefaults` so built-in models carry accurate `input`/`streaming`/`toolCalling`/`thinking` baselines while preserving explicit `provider.capabilities` overrides.
    2. **Zero-Bundler Declarative Blueprint Protocol** (`@zhin.js/console-contract`, `@zhin.js/client`, `@zhin.js/pagemanager`): add JSON-serializable `DeclarativeValueExpr` operators (`$path`, `$count`, `$sum`, `$format`, `$map`, `$join`, `$coalesce`) evaluated identically across Web, IM Card, and CLI Panel projections, plus in-process `ts.transpileModule` synthesis (`synthesizePureBlueprintModule`) in `TypeScriptClientBuilder`.
    3. **Auto CapabilityGraph Convention Merge & Codegen** (`@zhin.js/plugin-runtime`, `@zhin.js/runtime`, `@zhin.js/cli`): add `mergePluginCapabilityGraph`, `scanConventionCapabilityFeatures` (auto-merged during `PluginScopeAssembler.setupTree`), and `zhin runtime codegen [dir] --write --json`.
    4. **Durable Turn Step Checkpointing** (`@zhin.js/agent`): add `TurnCheckpointStore` and `DatabaseTurnCheckpointStorage` (`agent_turn_checkpoints`) so multi-step tool turns interrupted mid-flight record completed `(assistant[toolCall] -> toolResult[])` rounds and resume from the last committed `toolResult` boundary on retry or `"继续"`/`"continue"`.
  - **UI Component System & Developer Preview Workbench** (`@zhin.js/client`, `@zhin.js/components`, `@zhin.js/cli`, `create-zhin-app`):
    - Expand `@zhin.js/client/ui` and `@zhin.js/components` with unified design tokens (`UI_DESIGN_TOKENS`), option icons (`RadioGroup`/`CheckboxGroup`), custom chart images/logos (`BarChart`/`Sparkline`/`DonutChart`/`GaugeBar`), batch table selection & sticky columns (`DataTable`), responsive viewport presets (`CardCanvas`), and shared layout/display primitives.
    - Add `zhin preview [dir]` command in `@zhin.js/cli` (and `"preview": "zhin preview"` in `create-zhin-app`) for zero-build live SSE component & page blueprint previewing, interactive `previewProps` JSON editing, canvas width/background presets, and box-model outline debugging.
  - **IM Chat Controlled Restart & Post-Restart Channel Receipt** (`@zhin.js/cli`):
    - Add `installRestartHost` (`restart` / `重启` / `reboot` command for Bot owners) and `deliverPendingRestartReceipt` so owners can trigger a supervised process restart from any IM conversation and automatically receive the restart completion summary in the originating channel once the endpoint reconnects.
    - Ignore `SIGHUP` in `NativeTypeScriptSupervisor` when running in `--daemon` mode.

- Updated dependencies [8adce16]
  - @zhin.js/core@1.1.59
  - @zhin.js/tool@1.1.18

## 1.1.24

### Patch Changes

- Updated dependencies [008ccad]
- Updated dependencies [a1f1028]
  - @zhin.js/core@1.1.58
  - @zhin.js/tool@1.1.17

## 1.1.23

### Patch Changes

- Updated dependencies [6163abc]
- Updated dependencies [bc6ccb1]
- Updated dependencies [72b5a12]
  - @zhin.js/core@1.1.57
  - @zhin.js/tool@1.1.16

## 1.1.22

### Patch Changes

- Updated dependencies [b249e5e]
- Updated dependencies [57661f6]
- Updated dependencies [cbd3f14]
- Updated dependencies [299863a]
- Updated dependencies [b652db3]
- Updated dependencies [0315ba0]
- Updated dependencies [00be764]
  - @zhin.js/core@1.1.56
  - @zhin.js/tool@1.1.15

## 1.1.21

### Patch Changes

- Updated dependencies [b0c02a2]
- Updated dependencies [af8f803]
- Updated dependencies [26fda97]
- Updated dependencies [976886c]
- Updated dependencies [032dc96]
  - @zhin.js/core@1.1.55
  - @zhin.js/tool@1.1.14

## 1.1.20

### Patch Changes

- Updated dependencies [2c3610a]
- Updated dependencies [a9f4e48]
- Updated dependencies [f8505b0]
  - @zhin.js/core@1.1.54
  - @zhin.js/tool@1.1.13

## 1.1.19

### Patch Changes

- Updated dependencies [c58c589]
  - @zhin.js/core@1.1.53
  - @zhin.js/tool@1.1.12

## 1.1.18

### Patch Changes

- Updated dependencies [f67883e]
- Updated dependencies [4d728c0]
- Updated dependencies [eb8feeb]
- Updated dependencies [24a2b71]
- Updated dependencies [d0e1fac]
- Updated dependencies [3771f7a]
- Updated dependencies [4f96ad5]
  - @zhin.js/core@1.1.52
  - @zhin.js/tool@1.1.11

## 1.1.17

### Patch Changes

- dcd4982: Upgrade runtime dependencies to clear security advisories: `undici` (6.29.1 / 8.12.2+), `axios` 1.20.0, and `@modelcontextprotocol/sdk` 1.32.0+ (bringing patched `hono`, `body-parser`, `proxy-addr`, `follow-redirects` and `ip-address` through the lockfile).
- Updated dependencies [18296cf]
- Updated dependencies [08e64de]
- Updated dependencies [9cade30]
- Updated dependencies [53bc6a0]
- Updated dependencies [66b6404]
- Updated dependencies [adb4af2]
- Updated dependencies [69f9ef6]
- Updated dependencies [17d1301]
  - @zhin.js/core@1.1.51
  - @zhin.js/tool@1.1.10

## 1.1.16

### Patch Changes

- Updated dependencies [f98025b]
- Updated dependencies [66ec1a5]
- Updated dependencies [7d68df6]
- Updated dependencies [bf0fa9f]
- Updated dependencies [3326db3]
- Updated dependencies [e91235e]
- Updated dependencies [6da2bad]
- Updated dependencies [3781f1c]
  - @zhin.js/core@1.1.50
  - @zhin.js/tool@1.1.9

## 1.1.15

### Patch Changes

- Updated dependencies [974fa85]
- Updated dependencies [1e9b3d6]
  - @zhin.js/core@1.1.49

## 1.1.14

### Patch Changes

- Updated dependencies [db06de8]
  - @zhin.js/core@1.1.48

## 1.1.13

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

## 1.1.12

### Patch Changes

- Updated dependencies [c407bd2]
- Updated dependencies [064b06d]
- Updated dependencies [b58548a]
- Updated dependencies [e914a93]
- Updated dependencies [e914a93]
- Updated dependencies [064b06d]
  - @zhin.js/core@1.1.46
  - @zhin.js/tool@1.1.7

## 1.1.11

### Patch Changes

- Updated dependencies [dd7f25f]
  - @zhin.js/core@1.1.45

## 1.1.10

### Patch Changes

- 267d685: 移除指向不存在模块的 `./adapter-tools-helper` 子路径导出：发布包里从未包含 `lib/adapter-tools-helper.js`，导入该子路径只会得到 `ERR_MODULE_NOT_FOUND`。
- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/core@1.1.44
  - @zhin.js/host-http-contract@1.1.1
  - @zhin.js/tool@1.1.6

## 1.1.9

### Patch Changes

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
  - @zhin.js/core@1.1.43
  - @zhin.js/tool@1.1.5

## 1.1.8

### Patch Changes

- Updated dependencies [5ab6307]
  - @zhin.js/core@1.1.42

## 1.1.7

### Patch Changes

- Updated dependencies [badcc1f]
  - @zhin.js/core@1.1.41
  - @zhin.js/tool@1.1.4

## 1.1.6

### Patch Changes

- b9b3953: Recognize versioned Tool, MCP, Skill and Agent projections across native generation module identities, so protocol ingress retains visible capabilities and fixed-generation execution guards. Keep MCP tools/list available with an empty tool set and reject unknown calls explicitly instead of advertising an unavailable method.

  Bind reused Tool projections to the explicit operation snapshot: new requests read current generation config, resources and projections, while in-flight requests keep their leased generation and retirement guards.

- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
  - @zhin.js/core@1.1.40
  - @zhin.js/tool@1.1.3

## 1.1.5

### Patch Changes

- 533145d: Document the current Runtime MCP Host Tool surface, explicit server configuration, authentication, and scaffold port.

## 1.1.4

### Patch Changes

- Updated dependencies [43eda99]
- Updated dependencies [0de4836]
  - @zhin.js/core@1.1.39

## 1.1.3

### Patch Changes

- Updated dependencies [5b5d270]
  - @zhin.js/core@1.1.38
  - @zhin.js/tool@1.1.2

## 1.1.2

### Patch Changes

- Updated dependencies [c861789]
- Updated dependencies [1414ccb]
- Updated dependencies [743d470]
- Updated dependencies [62dee52]
- Updated dependencies [cd54131]
- Updated dependencies [5855db7]
- Updated dependencies [ec921d2]
- Updated dependencies [8740059]
- Updated dependencies [9110ab8]
- Updated dependencies [b853dba]
- Updated dependencies [e561309]
- Updated dependencies [d4c6175]
- Updated dependencies [7a0e1ca]
- Updated dependencies [103b5d3]
- Updated dependencies [5a7a7f7]
- Updated dependencies [b076eae]
- Updated dependencies [535fed1]
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
- Updated dependencies [5c3858e]
- Updated dependencies [33ea736]
  - @zhin.js/core@1.1.37
  - @zhin.js/tool@1.1.1

## 1.1.1

### Patch Changes

- @zhin.js/core@1.1.36

## 1.1.0

### Minor Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

### Patch Changes

- a34bf91: Publish internal peer dependencies as compatible caret ranges instead of exact versions, preventing compatible internal minor releases from forcing unrelated major bumps.
- Updated dependencies [1fc6270]
  - @zhin.js/core@1.1.35
  - @zhin.js/host-http-contract@1.1.0
  - @zhin.js/tool@1.1.0

## 7.0.1

### Patch Changes

- @zhin.js/core@1.5.16
- zhin.js@7.0.1

## 7.0.0

### Patch Changes

- zhin.js@7.0.0

## 6.0.15

### Patch Changes

- Updated dependencies [ba7e17a]
- Updated dependencies [7108d0b]
  - @zhin.js/core@1.5.15
  - zhin.js@6.0.15

## 6.0.14

### Patch Changes

- Updated dependencies [54bfd6b]
- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
- Updated dependencies [1fc78bc]
  - @zhin.js/core@1.5.14
  - @zhin.js/tool@1.0.13
  - zhin.js@6.0.14

## 6.0.13

### Patch Changes

- Updated dependencies [f2c532f]
  - @zhin.js/core@1.5.13
  - zhin.js@6.0.13

## 6.0.12

### Patch Changes

- Updated dependencies [5969c5b]
- Updated dependencies [5969c5b]
- Updated dependencies [974772e]
- Updated dependencies [5969c5b]
- Updated dependencies [2f786bd]
- Updated dependencies [1312ca0]
  - @zhin.js/core@1.5.12
  - zhin.js@6.0.12
  - @zhin.js/tool@1.0.12

## 6.0.11

### Patch Changes

- @zhin.js/core@1.5.11
- zhin.js@6.0.11

## 6.0.10

### Patch Changes

- Updated dependencies [d3920e9]
  - @zhin.js/core@1.5.10
  - zhin.js@6.0.10
  - @zhin.js/tool@1.0.11

## 6.0.9

### Patch Changes

- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/core@1.5.9
  - @zhin.js/tool@1.0.10
  - zhin.js@6.0.9

## 6.0.8

### Patch Changes

- Updated dependencies [63253bb]
- Updated dependencies [7427818]
- Updated dependencies [8e973dc]
- Updated dependencies [953cfe1]
- Updated dependencies [0e73866]
  - @zhin.js/core@1.5.8
  - @zhin.js/tool@1.0.9
  - zhin.js@6.0.8

## 6.0.7

### Patch Changes

- Updated dependencies [36cb1ca]
  - @zhin.js/core@1.5.7
  - zhin.js@6.0.7

## 6.0.6

### Patch Changes

- @zhin.js/core@1.5.6
- zhin.js@6.0.6

## 6.0.5

### Patch Changes

- @zhin.js/core@1.5.5
- zhin.js@6.0.5

## 6.0.4

### Patch Changes

- d99fd12: remove(host/mcp): delete legacy MCP scaffolding tools

  Remove handlers.ts, tools.ts, prompts.ts, and resources.ts (1,358 lines)
  which contained outdated scaffolding code for plugin/command/component
  generation. These were not part of the core MCP server functionality and
  had no active consumers. mesh-auth.ts updated to remove orphaned imports.

- daffd4c: 建立 generation-owned Agent Turn 基建并删除第二工具注册权威。

  - Tool capability 统一由 `tools/*.ts` 或 `context.addTool()` 写入候选 generation，并在 commit 后通过唯一 `ToolIndex` 发布；删除 experimental `agentToolsHostToken`。
  - Tool execution context 现必须携带 Turn AbortSignal、trace/turn/session identity 与 principal；生产工具执行等待真实 settlement 后再释放 generation lease。
  - 新增 durable Turn Journal 与 crash-safe File Journal Store，按 sequence 原子发布、跨实例拒绝 stale writer，并保留可 replay 的 terminal facts。
  - MCP 外部工具调用改走固定 snapshot 的 canonical Tool ingress、统一审批/Journal/取消链；删除 `allowApprovalTools` 绕过开关。
  - ApprovalPort 现在必须消费所属 Turn 的 AbortSignal，取消审批等待时 fail closed。

  BREAKING CHANGE: `ToolIndex.execute()` 新增必需的 invocation context；`JournalStore.append()` 新增 expected previous sequence；MCP 删除 `allowApprovalTools`；`agentToolsHostToken` 不再导出，条件式工具改用 `context.addTool()`。

- 2916852: Make canonical invocation origin and principal display identity part of every
  Tool execution context. IM, HTTP, A2A, Schedule, Internal, and MCP callers now
  carry structured origin data through ToolIndex instead of requiring tools to
  read a legacy IM Message side channel.
- Updated dependencies [b0f37ae]
- Updated dependencies [ba08a2f]
- Updated dependencies [daffd4c]
- Updated dependencies [36c7400]
- Updated dependencies [3f29623]
- Updated dependencies [2916852]
- Updated dependencies [162fa34]
- Updated dependencies [e40b048]
- Updated dependencies [f1708c3]
- Updated dependencies [d254a81]
- Updated dependencies [e53444f]
- Updated dependencies [92b0dd7]
- Updated dependencies [a7df753]
  - @zhin.js/core@1.5.4
  - zhin.js@6.0.4
  - @zhin.js/tool@1.0.8

## 6.0.3

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/host-http-contract@1.0.1
  - @zhin.js/core@1.5.3
  - @zhin.js/tool@1.0.7
  - zhin.js@6.0.3

## 6.0.2

### Patch Changes

- 9f57124: feat!: 命令动态参数文件名改为 Next.js 风格（BREAKING）

  - 文件名不再携带类型：`[name:type=default].ts` → `[name].ts`（必需）/ `[[name]].ts`（可选）；类型与默认值统一在 `defineCommand({ params })` 中声明（`params.<name>.type` 必填，`default` 可选）。
  - 新增捕获所有段：`[...slug].ts` / `[[...slug]].ts`，运行时 `params.slug` 为数组；元素粒度随 `params.slug.type`——`text` 逐消息段，`word`/`string` 逐词切分，`number`/`integer`/`float`/`boolean` 逐词转换（任一词失败即不匹配），结构化类型逐消息段。
  - 旧格式文件名在发现期即抛 `CommandPathSyntaxError`；动态文件名缺少对应 `params` 声明、或必需文件名的 `params` 带 `default` 同样抛错。
  - `zhin new` 模板与 `zhin runtime migrate` 产物同步输出新格式；仓库内全部适配器 / 游戏 / 工具插件命令文件已迁移。

- Updated dependencies [afc0e66]
  - @zhin.js/core@1.5.2
  - zhin.js@6.0.2
  - @zhin.js/tool@1.0.6

## 6.0.1

### Patch Changes

- @zhin.js/core@1.5.1
- @zhin.js/tool@1.0.5
- zhin.js@6.0.1

## 6.0.0

### Patch Changes

- Updated dependencies [4fbff5d]
- Updated dependencies [5b94d9c]
  - @zhin.js/core@1.5.0
  - zhin.js@6.0.0

## 5.0.4

### Patch Changes

- d8bf702: fix: resolve GitHub security alerts (XSS, ReDoS, vulnerable dependencies)

  - Sanitize URL schemes in `resolveMediaSrc` to reject `javascript:` and other dangerous protocols
  - Replace polynomial regex patterns with loop-based `trimTrailingSlashes` to prevent ReDoS
  - Use `String.trimEnd()` instead of `/\s*$/` regex in env text merging
  - Fix incomplete URL substring sanitization in tests
  - Upgrade `adm-zip` to ^0.6.0 (fixes GHSA-xcpc-8h2w-3j85)
  - Add pnpm override to force `axios ^1.19.0` for `qq-official-bot`
  - Update transitive dependencies via `pnpm update`

- Updated dependencies [d8bf702]
  - @zhin.js/host-http@1.0.4
  - @zhin.js/core@1.4.3
  - zhin.js@5.0.3

## 5.0.3

### Patch Changes

- Updated dependencies [45b3256]
  - @zhin.js/core@1.4.3
  - zhin.js@5.0.3

## 5.0.2

### Patch Changes

- zhin.js@5.0.2
- @zhin.js/tool@1.0.4
- @zhin.js/core@1.4.2

## 5.0.1

### Patch Changes

- 2d0a159: 审计尾账清零（P2 批）：

  - Runtime：reload 前重读配置文档消除陈旧快照；组合式根 schema 显式报错（不再静默空 view）；ConfigPatch 支持数组数字索引（`endpoints.0.url`）；console 配置读写单一数据源 + 写入串行化；watch tick 防重叠 + fetch 超时。
  - Host/MCP：MCP client stop 成功才标记 + handoff 补 quiescePrevious/resumePrevious（独占端口不再新旧并存）；readJsonBody 超限保留连接回 413；dispatchHttp 统一 HttpBodyError 状态码；inbox endpoint 名仅命中才缓存；create_plugin 工具生成物改 definePlugin 新格式。
  - Agent：CapabilityIngress 按 projection 归属记账（key 振荡不再泄漏/误 purge）；敏感目录 `data` 锚定工作区根（src/data 不再误伤）；passive-group-buffer 死 key 清扫；tool scopes 数组校验。
  - 插件：blackjack 终局「回复 1」复活（getLatestForUser）；60s apiBase 改运行时求值（弃 process.env）；rss \_db lifecycle 清理；group-suite flush 不丢计数 + checkin 串行化防双签；milky SSE start 失败复位。
  - 工具链：applyAdaptersToConfig 改合并（重跑 wizard 不丢手工 endpoint）；html-renderer 提示识别 plugins 映射；create-zhin CLI 项目名校验 + task XML/NSSM 修复；setup --ai 补 @zhin.js/tool；layout 发现支持 .ts。

- 3e925d0: 删除 legacy 插件包 `@zhin.js/host-api` 与 `@zhin.js/host-router`（legacy `usePlugin` 插件栈下线）：

  - **包删除**：`@zhin.js/host-api`、`@zhin.js/host-router` 从仓库移除，后续版本不再发布。Console / HTTP Host 由 `@zhin.js/cli`（composition root）用 `@zhin.js/host-http` + `@zhin.js/pagemanager` 自动装配，用户无需、也不能再安装这两个插件。
  - **zhin.js**：移除对 host-api / host-router 的 optional peer 依赖；`shutdown.ts` 不再动态导入 host-api 的 `stopSseHub`（SSE Hub 生命周期由 CLI 装配层管理）。
  - **@zhin.js/mcp / @zhin.js/a2a**：移除对 host-router 的 peer 依赖；legacy `usePlugin` 入口改为本地结构类型（运行时走 `./runtime` 子路径，由 CLI 经 host-http 装配，行为不变）。
  - **@zhin.js/cli**：`config check` / `doctor` / `setup` 不再检查或写入 host 插件；全局实例（~/.zhin）脚手架不再声明 host-api / host-router。
  - **@zhin.js/scaffold-wizard**：移除 `CONSOLE_HOST_PLUGINS` 导出与 `ConsoleConfigDiagnosis.missingHostPlugins` 字段；`zhin-stack-deps` 不再含 host 包；`stack-versions.generated.json` 同步移除。
  - **@zhin.js/agent**：稳定性监控移除 host-api SSE 订阅数采集（`collectStabilityMetrics` 不再支持 `includeSse`，快照不再有 `sseSubscribers`）。

- Updated dependencies [cdf64e7]
- Updated dependencies [2d0a159]
- Updated dependencies [5691aba]
- Updated dependencies [43485a9]
- Updated dependencies [f0ec5ab]
- Updated dependencies [3e925d0]
- Updated dependencies [fa66c4c]
- Updated dependencies [fa66c4c]
- Updated dependencies [6cb6152]
  - @zhin.js/host-http@1.0.3
  - @zhin.js/tool@1.0.3
  - zhin.js@5.0.1
  - @zhin.js/core@1.4.1

## 5.0.0

### Patch Changes

- Updated dependencies [7db69c1]
- Updated dependencies [e5c84ed]
- Updated dependencies [1ddcd70]
- Updated dependencies [ac9da66]
  - @zhin.js/core@1.4.0
  - @zhin.js/host-router@3.0.0
  - @zhin.js/host-http@1.0.2
  - zhin.js@5.0.0
  - @zhin.js/tool@1.0.2

## 4.0.3

### Patch Changes

- Updated dependencies [16ec4e8]
- Updated dependencies [cc5c94d]
- Updated dependencies [447f3e2]
  - @zhin.js/core@1.3.5
  - @zhin.js/host-http@1.0.1
  - zhin.js@4.1.3
  - @zhin.js/host-router@2.0.4
  - @zhin.js/tool@1.0.1

## 4.0.2

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/core@1.3.4
  - @zhin.js/host-router@2.0.3
  - zhin.js@4.1.2

## 4.0.1

### Patch Changes

- 5cc9c03: fix: ai 优化
- 36d6db2: fix: agent 互联
- Updated dependencies [5b08052]
- Updated dependencies [5cc9c03]
- Updated dependencies [36d6db2]
- Updated dependencies [b9b3881]
- Updated dependencies [7700903]
  - @zhin.js/core@1.3.3
  - @zhin.js/host-router@2.0.2
  - zhin.js@4.1.1

## 4.0.0

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化
- Updated dependencies [c4575c9]
- Updated dependencies [c4575c9]
  - @zhin.js/core@1.3.2
  - zhin.js@4.1.0

## 3.0.1

### Patch Changes

- Updated dependencies [609da24]
- Updated dependencies [93e58d9]
- Updated dependencies [ae5239c]
  - @zhin.js/core@1.3.1
  - zhin.js@4.0.1

## 3.0.0

### Patch Changes

- Updated dependencies [db38da4]
  - @zhin.js/core@1.3.0
  - zhin.js@3.0.0

## 2.0.1

### Patch Changes

- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - @zhin.js/core@1.2.1
  - zhin.js@2.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [65f4b0a]
- Updated dependencies [e62c23a]
  - @zhin.js/core@1.2.0
  - zhin.js@2.0.0

## 1.0.74

### Patch Changes

- Updated dependencies [d8547d2]
  - zhin.js@1.0.92

## 1.0.73

### Patch Changes

- Updated dependencies [3735e96]
  - zhin.js@1.0.91

## 1.0.72

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - zhin.js@1.0.90

## 1.0.71

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新
- Updated dependencies [c78d2cd]
  - zhin.js@1.0.89

## 1.0.70

### Patch Changes

- Updated dependencies [ccb6e24]
  - zhin.js@1.0.88

## 1.0.69

### Patch Changes

- zhin.js@1.0.87

## 1.0.68

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [7e14f8d]
  - zhin.js@1.0.86

## 1.0.67

### Patch Changes

- zhin.js@1.0.85

## 1.0.66

### Patch Changes

- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
  - zhin.js@1.0.84

## 1.0.65

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - zhin.js@1.0.83

## 1.0.64

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - zhin.js@1.0.82

## 1.0.63

### Patch Changes

- 8086ccb: fix: ai 增强/优化
- Updated dependencies [8086ccb]
  - zhin.js@1.0.81

## 1.0.62

### Patch Changes

- zhin.js@1.0.80

## 1.0.61

### Patch Changes

- zhin.js@1.0.79

## 1.0.60

### Patch Changes

- zhin.js@1.0.78

## 1.0.59

### Patch Changes

- zhin.js@1.0.77

## 1.0.58

### Patch Changes

- Updated dependencies [cb9fbf1]
  - zhin.js@1.0.76

## 1.0.57

### Patch Changes

- zhin.js@1.0.75

## 1.0.56

### Patch Changes

- Updated dependencies [c9dec38]
  - zhin.js@1.0.74

## 1.0.55

### Patch Changes

- zhin.js@1.0.73

## 1.0.54

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - zhin.js@1.0.72

## 1.0.53

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - zhin.js@1.0.71

## 1.0.52

### Patch Changes

- zhin.js@1.0.68

## 1.0.51

### Patch Changes

- zhin.js@1.0.67

## 1.0.50

### Patch Changes

- zhin.js@1.0.66

## 1.0.49

### Patch Changes

- zhin.js@1.0.65

## 1.0.48

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - zhin.js@1.0.64

## 1.0.47

### Patch Changes

- zhin.js@1.0.63

## 1.0.46

### Patch Changes

- zhin.js@1.0.62

## 1.0.45

### Patch Changes

- zhin.js@1.0.61

## 1.0.44

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

## 1.0.43

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - zhin.js@1.0.59

## 1.0.42

### Patch Changes

- zhin.js@1.0.58

## 1.0.41

### Patch Changes

- zhin.js@1.0.57

## 1.0.40

### Patch Changes

- zhin.js@1.0.56

## 1.0.39

### Patch Changes

- zhin.js@1.0.55

## 1.0.38

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - zhin.js@1.0.54

## 1.0.37

### Patch Changes

- zhin.js@1.0.53

## 1.0.36

### Patch Changes

- a3511a0: 各包内 Agent 技能说明已固定为随包发布的 `skills/*/SKILL.md`（替代已移除的运行时 `declareSkill`）。本批为 registry / 分发侧对齐的 **patch** 版本递增。

## 1.0.35

### Patch Changes

- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - zhin.js@1.0.52

## 1.0.34

### Patch Changes

- zhin.js@1.0.51

## 1.0.33

### Patch Changes

- zhin.js@1.0.50

## 1.0.32

### Patch Changes

- zhin.js@1.0.49

## 1.0.31

### Patch Changes

- zhin.js@1.0.48

## 1.0.30

### Patch Changes

- Updated dependencies [de3e352]
  - zhin.js@1.0.47

## 1.0.29

### Patch Changes

- Updated dependencies [7394603]
  - zhin.js@1.0.46

## 1.0.28

### Patch Changes

- zhin.js@1.0.45

## 1.0.27

### Patch Changes

- zhin.js@1.0.44

## 1.0.26

### Patch Changes

- 72ec4ba: fix: 新增插件,控制台调优
- Updated dependencies [72ec4ba]
  - zhin.js@1.0.43

## 1.0.25

### Patch Changes

- zhin.js@1.0.42
- @zhin.js/host-router@1.0.36

## 1.0.24

### Patch Changes

- zhin.js@1.0.41
- @zhin.js/host-router@1.0.35

## 1.0.23

### Patch Changes

- 7ef9057: fix: 架构调整优化
- Updated dependencies [7ef9057]
  - zhin.js@1.0.40
  - @zhin.js/host-router@1.0.34

## 1.0.22

### Patch Changes

- zhin.js@1.0.39
- @zhin.js/host-router@1.0.33

## 1.0.21

### Patch Changes

- Updated dependencies [ab5c54a]
  - zhin.js@1.0.38
  - @zhin.js/host-router@1.0.32

## 1.0.20

### Patch Changes

- zhin.js@1.0.37
- @zhin.js/host-router@1.0.30

## 1.0.19

### Patch Changes

- Updated dependencies [432d0a5]
- Updated dependencies [6d94111]
  - @zhin.js/host-router@1.0.29
  - zhin.js@1.0.36

## 1.0.18

### Patch Changes

- zhin.js@1.0.35
- @zhin.js/host-router@1.0.28

## 1.0.17

### Patch Changes

- zhin.js@1.0.34
- @zhin.js/host-router@1.0.27

## 1.0.16

### Patch Changes

- zhin.js@1.0.33
- @zhin.js/host-router@1.0.26

## 1.0.15

### Patch Changes

- zhin.js@1.0.32
- @zhin.js/host-router@1.0.24

## 1.0.14

### Patch Changes

- zhin.js@1.0.31
- @zhin.js/host-router@1.0.23

## 1.0.13

### Patch Changes

- Updated dependencies [460a6c6]
  - zhin.js@1.0.30
  - @zhin.js/host-router@1.0.22

## 1.0.12

### Patch Changes

- zhin.js@1.0.29
- @zhin.js/host-router@1.0.21

## 1.0.11

### Patch Changes

- 05a514d: fix: ai 增强,cli 增强
- Updated dependencies [05a514d]
  - @zhin.js/host-router@1.0.20
  - zhin.js@1.0.28

## 1.0.10

### Patch Changes

- Updated dependencies [b27e633]
  - @zhin.js/host-router@1.0.18
  - zhin.js@1.0.27

## 1.0.9

### Patch Changes

- 106d357: fix: ai
- Updated dependencies [106d357]
  - @zhin.js/host-router@1.0.17
  - zhin.js@1.0.26

## 1.0.8

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai
- Updated dependencies [26d2942]
- Updated dependencies [6b02c41]
  - @zhin.js/ai@0.0.2
  - zhin.js@1.0.25
  - @zhin.js/host-router@1.0.16

## 1.0.7

### Patch Changes

- zhin.js@1.0.24
- @zhin.js/host-router@1.0.15

## 1.0.6

### Patch Changes

- Updated dependencies [52ae08a]
  - zhin.js@1.0.23
  - @zhin.js/host-router@1.0.14

## 1.0.5

### Patch Changes

- Updated dependencies [26aba27]
  - zhin.js@1.0.22
  - @zhin.js/host-router@1.0.13

## 1.0.4

### Patch Changes

- zhin.js@1.0.21
- @zhin.js/host-router@1.0.12

## 1.0.3

### Patch Changes

- a3b7673: fix: 调整依赖项
- Updated dependencies [a3b7673]
- Updated dependencies [5141137]
  - @zhin.js/host-router@1.0.11
  - zhin.js@1.0.20

## 1.0.2

### Patch Changes

- f9faa1d: fix: test release
- Updated dependencies [f9faa1d]
  - zhin.js@1.0.19
  - @zhin.js/host-router@1.0.10

## 1.0.1

### Patch Changes

- d16a69c: fix: test trust publish
- Updated dependencies [d16a69c]
  - zhin.js@1.0.18
  - @zhin.js/host-router@1.0.9

## 1.0.0

### Features

- 🎉 初始版本
- 🤖 提供 MCP Server 支持，让 AI 助手能够理解和生成 Zhin 插件
- 🌐 使用 StreamableHTTPServerTransport 提供 HTTP Stream 传输
- 📦 使用最新的 @modelcontextprotocol/sdk (v1.22.0)
- 🚀 **使用 McpServer 高级 API**，提供更简洁的开发体验
- 🛠️ 内置丰富的开发工具：插件生成、命令生成、组件生成等
- 📚 提供完整的 Zhin 框架文档和最佳实践
- 🔍 支持查询现有插件、命令、组件结构
- 💡 提供代码模板和示例
- ✅ 使用 Zod Schema 进行参数验证
- 📁 模块化代码结构，易于维护和扩展
