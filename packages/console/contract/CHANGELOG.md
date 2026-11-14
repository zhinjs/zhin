# @zhin.js/contract

## 1.1.26

### Patch Changes

- Updated dependencies [8c92bda]
- Updated dependencies [7126d03]
- Updated dependencies [1d1746e]
- Updated dependencies [e6d7cc1]
- Updated dependencies [71aa159]
- Updated dependencies [ccab2c1]
- Updated dependencies [b00725c]
- Updated dependencies [c6b5563]
- Updated dependencies [f1a9745]
- Updated dependencies [e0b4e51]
- Updated dependencies [704c7a4]
- Updated dependencies [f3910f1]
  - @zhin.js/console-protocol@1.3.0

## 1.1.25

### Patch Changes

- Updated dependencies [f74b4a5]
- Updated dependencies [a86bdc7]
- Updated dependencies [f2fa3d7]
- Updated dependencies [ac72706]
- Updated dependencies [b2aae3c]
  - @zhin.js/console-protocol@1.2.2

## 1.1.24

### Patch Changes

- Updated dependencies [cfa3dbf]
- Updated dependencies [7fb1ee7]
  - @zhin.js/console-protocol@1.2.1

## 1.1.23

### Patch Changes

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

- c2bbdcf: 页面元数据新增可选 `section`（`overview` / `conversations` / `features` / `plugins` / `ops` / `access`，ADR 0052），声明页面在 Console 导航里属于哪个分区；`definePage` 校验取值，Host 的 `/entries` 与客户端 `resolveEntryRegister` 把它透传到路由 `meta.section`，未知值被丢弃。
- Updated dependencies [1a5c569]
- Updated dependencies [a9c7a13]
- Updated dependencies [120e225]
- Updated dependencies [c2bbdcf]
- Updated dependencies [c2bbdcf]
- Updated dependencies [c2bbdcf]
- Updated dependencies [63595fc]
- Updated dependencies [5120367]
- Updated dependencies [fd22375]
- Updated dependencies [cc7a5f9]
- Updated dependencies [cc7a5f9]
- Updated dependencies [f8bf684]
- Updated dependencies [4e8ba38]
- Updated dependencies [c2bbdcf]
- Updated dependencies [5cd9d3d]
  - @zhin.js/console-protocol@1.2.0

## 1.1.22

### Patch Changes

- Updated dependencies [8adce16]
  - @zhin.js/ai@1.1.54

## 1.1.21

### Patch Changes

- Updated dependencies [008ccad]
  - @zhin.js/ai@1.1.53

## 1.1.20

### Patch Changes

- fed2c27: Upgrade Console Host, Plugin Pages compiler/DX, and `/sandbox` workbench:

  - Populate React 19, `react-dom/client`, and `react-router-dom` named exports and standalone ESM fallback in `@zhin.js/pagemanager`.
  - Re-export `definePage` from `@zhin.js/page`, forward all `PageMetadata` fields (`group`, `order`, `parent`, `fullWidth`, `titleI18n`), and inject `{ pluginId, owner, localName, route, title }` props into page components.
  - Add `definePluginConsoleRpc.withConfig<TConfig>()` and `@zhin.js/client` `createDeclarativePage` helper.
  - Upgrade local Console shell (`page-renderer.ts`), live `log:entry` SSE broadcasts, and `/sandbox` simulated sender identity/role switching and rich segment rendering.

- Updated dependencies [3a8504b]
- Updated dependencies [6163abc]
- Updated dependencies [bc6ccb1]
- Updated dependencies [8de6080]
- Updated dependencies [8de6080]
- Updated dependencies [8de6080]
- Updated dependencies [8de6080]
  - @zhin.js/ai@1.1.52
  - @zhin.js/console-protocol@1.1.14

## 1.1.19

### Patch Changes

- Updated dependencies [299863a]
- Updated dependencies [9e6d70d]
- Updated dependencies [bd524d1]
- Updated dependencies [126ae99]
- Updated dependencies [4fe49b5]
- Updated dependencies [0315ba0]
- Updated dependencies [d086ff3]
- Updated dependencies [8be6c23]
  - @zhin.js/ai@1.1.51
  - @zhin.js/console-protocol@1.1.13

## 1.1.18

### Patch Changes

- Updated dependencies [af8f803]
- Updated dependencies [26fda97]
- Updated dependencies [976886c]
- Updated dependencies [3c1912f]
  - @zhin.js/ai@1.1.50

## 1.1.17

### Patch Changes

- Updated dependencies [6749002]
- Updated dependencies [c7944a5]
- Updated dependencies [fc33495]
- Updated dependencies [2c3610a]
- Updated dependencies [4949b90]
- Updated dependencies [4c05a4e]
  - @zhin.js/ai@1.1.49

## 1.1.16

### Patch Changes

- Updated dependencies [c58c589]
  - @zhin.js/ai@1.1.48

## 1.1.15

### Patch Changes

- Updated dependencies [b5071e7]
- Updated dependencies [e23cabc]
- Updated dependencies [3c4178d]
- Updated dependencies [825e4dc]
- Updated dependencies [f1eb75c]
- Updated dependencies [5621f75]
- Updated dependencies [2b8b408]
- Updated dependencies [4d728c0]
- Updated dependencies [f0e1df7]
- Updated dependencies [d9672ec]
- Updated dependencies [24a2b71]
- Updated dependencies [119e9e6]
- Updated dependencies [f2bbab5]
- Updated dependencies [1bdbc08]
- Updated dependencies [df6442c]
- Updated dependencies [b223a51]
- Updated dependencies [d0e1fac]
- Updated dependencies [945303c]
  - @zhin.js/ai@1.1.47

## 1.1.14

### Patch Changes

- af29996: 为 Page 元数据增加可选 titleI18n，在页面目录、导航与 Console 客户端注册链路中保留显式标题翻译。Sandbox 页面提供英文导航标题，缺少对应语言时保留插件原题，不修改路由或访问规则。
- Updated dependencies [f3b7c9f]
- Updated dependencies [ff87195]
- Updated dependencies [a3b636d]
- Updated dependencies [9cade30]
- Updated dependencies [b8e594e]
- Updated dependencies [dcd4982]
- Updated dependencies [69f9ef6]
- Updated dependencies [17d1301]
- Updated dependencies [f821029]
  - @zhin.js/console-protocol@1.1.12
  - @zhin.js/ai@1.1.46

## 1.1.13

### Patch Changes

- Updated dependencies [0dd657d]
- Updated dependencies [5d099f5]
- Updated dependencies [f9ab410]
  - @zhin.js/ai@1.1.45

## 1.1.12

### Patch Changes

- Updated dependencies [f98025b]
- Updated dependencies [9e21404]
- Updated dependencies [de39053]
- Updated dependencies [250b026]
- Updated dependencies [bff8e31]
- Updated dependencies [bf0fa9f]
- Updated dependencies [3326db3]
- Updated dependencies [6da2bad]
- Updated dependencies [3781f1c]
  - @zhin.js/ai@1.1.44

## 1.1.11

### Patch Changes

- Updated dependencies [974fa85]
- Updated dependencies [d9cc732]
  - @zhin.js/ai@1.1.43

## 1.1.10

### Patch Changes

- Updated dependencies [d13b1d7]
- Updated dependencies [1971e0c]
- Updated dependencies [a383380]
  - @zhin.js/console-protocol@1.1.11
  - @zhin.js/ai@1.1.42

## 1.1.9

### Patch Changes

- Updated dependencies [7edd04c]
- Updated dependencies [2b4d6dc]
- Updated dependencies [b58548a]
- Updated dependencies [e914a93]
  - @zhin.js/console-protocol@1.1.10

## 1.1.8

### Patch Changes

- Updated dependencies [d033076]
  - @zhin.js/ai@1.1.41

## 1.1.7

### Patch Changes

- Updated dependencies [dd7f25f]
  - @zhin.js/ai@1.1.40

## 1.1.6

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [a64716a]
- Updated dependencies [75e26a6]
- Updated dependencies [75e26a6]
- Updated dependencies [cc9959e]
- Updated dependencies [fdc2148]
  - @zhin.js/ai@1.1.39
  - @zhin.js/console-protocol@1.1.9

## 1.1.5

### Patch Changes

- Updated dependencies [c829031]
- Updated dependencies [0c17e0b]
- Updated dependencies [bf52b40]
- Updated dependencies [55811d1]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [fc75499]
- Updated dependencies [2a9d08b]
- Updated dependencies [e4fbfb2]
- Updated dependencies [56bafda]
- Updated dependencies [7d2263c]
- Updated dependencies [27da0e8]
- Updated dependencies [7d2263c]
- Updated dependencies [d91d21a]
- Updated dependencies [a62acca]
- Updated dependencies [9ab9ffb]
- Updated dependencies [1280631]
- Updated dependencies [bd78a94]
- Updated dependencies [acfaaef]
- Updated dependencies [57ea5f7]
- Updated dependencies [6e035e5]
- Updated dependencies [57ea5f7]
- Updated dependencies [55db42d]
- Updated dependencies [f48ba72]
- Updated dependencies [3237f63]
- Updated dependencies [8e26cf1]
- Updated dependencies [9891e66]
- Updated dependencies [4778587]
- Updated dependencies [681abf3]
  - @zhin.js/ai@1.1.38
  - @zhin.js/console-protocol@1.1.8

## 1.1.4

### Patch Changes

- Updated dependencies [b36452a]
  - @zhin.js/ai@1.1.37

## 1.1.3

### Patch Changes

- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
  - @zhin.js/console-protocol@1.1.7
  - @zhin.js/ai@1.1.36

## 1.1.2

### Patch Changes

- Updated dependencies [36c2eb9]
- Updated dependencies [95b24d4]
  - @zhin.js/ai@1.1.35

## 1.1.1

### Patch Changes

- f474b1d: Replace the process-wide Console application, runtime environment, and WebSocket singleton with an explicitly created `ConsoleClient` that owns its application registry and REST/SSE transport. React transport hooks now resolve that owner through `ConsoleClientProvider`, and the obsolete `addPage` compatibility alias is removed from the plugin registration contract.
- Updated dependencies [1414ccb]
- Updated dependencies [62dee52]
- Updated dependencies [244e475]
- Updated dependencies [1fa1c09]
- Updated dependencies [75920c4]
- Updated dependencies [cd4f240]
- Updated dependencies [4bc3d3c]
- Updated dependencies [77d5a46]
- Updated dependencies [baef56b]
- Updated dependencies [698f16f]
- Updated dependencies [507d602]
  - @zhin.js/ai@1.1.34
  - @zhin.js/console-protocol@1.1.6

## 1.1.0

### Minor Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

### Patch Changes

- Updated dependencies [1fc6270]
  - @zhin.js/ai@1.1.33
  - @zhin.js/console-protocol@1.1.5

## 1.0.19

### Patch Changes

- Updated dependencies [882a08a]
  - @zhin.js/ai@1.5.9

## 1.0.18

### Patch Changes

- Updated dependencies [d85eddd]
  - @zhin.js/ai@1.5.8

## 1.0.17

### Patch Changes

- Updated dependencies [09b14d6]
  - @zhin.js/ai@1.5.7

## 1.0.16

### Patch Changes

- Updated dependencies [b10d058]
- Updated dependencies [f2c532f]
  - @zhin.js/console-protocol@1.1.4

## 1.0.15

### Patch Changes

- Updated dependencies [5969c5b]
- Updated dependencies [974772e]
- Updated dependencies [5969c5b]
- Updated dependencies [2f786bd]
- Updated dependencies [1312ca0]
- Updated dependencies [985fa22]
  - @zhin.js/console-protocol@1.1.3
  - @zhin.js/ai@1.5.6

## 1.0.14

### Patch Changes

- Updated dependencies [0b8b5bd]
  - @zhin.js/ai@1.5.5

## 1.0.13

### Patch Changes

- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/console-protocol@1.1.2
  - @zhin.js/ai@1.5.4

## 1.0.12

### Patch Changes

- Updated dependencies [0e73866]
  - @zhin.js/ai@1.5.3

## 1.0.11

### Patch Changes

- Updated dependencies [c50aca3]
- Updated dependencies [daffd4c]
- Updated dependencies [61bfc1c]
- Updated dependencies [f1708c3]
- Updated dependencies [05befc1]
- Updated dependencies [e53444f]
- Updated dependencies [a7df753]
  - @zhin.js/ai@1.5.2

## 1.0.10

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/console-protocol@1.1.1
  - @zhin.js/ai@1.5.1

## 1.0.9

### Patch Changes

- Updated dependencies [1f23bf6]
- Updated dependencies [4fbff5d]
- Updated dependencies [5b94d9c]
  - @zhin.js/ai@1.5.0

## 1.0.8

### Patch Changes

- Updated dependencies [d8bf702]
  - @zhin.js/ai@1.4.8

## 1.0.7

### Patch Changes

- Updated dependencies [f346346]
  - @zhin.js/ai@1.4.7

## 1.0.6

### Patch Changes

- Updated dependencies [5691aba]
  - @zhin.js/ai@1.4.6

## 1.0.5

### Patch Changes

- Updated dependencies [ac9da66]
  - @zhin.js/console-protocol@1.1.0

## 1.0.4

### Patch Changes

- @zhin.js/ai@1.4.5

## 1.0.3

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
  - @zhin.js/ai@1.4.4

## 1.0.2

### Patch Changes

- 5cc9c03: fix: ai 优化

## 1.0.1

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
