# @zhin.js/plugin-nettools

## 0.1.14

### Patch Changes

- e6d7cc1: 配置表单与插件显示名的多语言约定（#1250）：Schema 节点沿用已有的 `x-i18n`（`Schema#i18n()`），按 `zh-CN` / `en` 分别声明字段的 `title`、`description` 与 `enumLabels`；插件 `metadata`（`definePlugin` 或 `package.json#zhin.metadata`）新增可选的 `displayNameI18n: { 'zh-CN'?, en? }`，与 `displayName` 一样只能在一处声明，清单只接受这两个键且值必须是非空字符串。Console 插件列表（`/api/plugins`、插件详情）和 `feature.list` / `feature.matrix` 原样带出 `displayNameI18n`，由 Console 按界面语言选择（当前语言 → `en` → `displayName` → 实例 key）。没有这些字段时行为不变。

  官方插件补齐中英文配置字段标题与说明（group-suite、repeater、roulette、answers、calendar、ledger、reminder、rss、earthquake、bilibili、content-moderation、lottery、nettools、60s、process-monitor、activity-feedback）以及全部官方插件的中英文显示名。

- f6b4ae9: 修复 `dns` 与 `domain-price` 指令无法加载（#1250）：两者用了两层参数目录（`dns/[name]/[[type]]`、`domain-price/[suffix]/[[order]]`），违反「只有最后一层目录可以是参数目录」，运行时加载抛 `CommandPathSyntaxError`。现改为单层参数目录（`dns/[name]`、`domain-price/[suffix]`），第二个参数在 `defineCommand({ params })` 里声明为可选；`dns example.com MX`、`domain-price com renew` 写法不变。
- 70ddaf4: 插件市场元数据（#1250 marketplace-metadata）：`package.json#zhin.metadata` 新增可选的 `descriptionI18n: { 'zh-CN'?, en? }`（本地化描述）与 `category`（`adapter`、`ai`、`admin`、`community`、`entertainment`、`game`、`information`、`moderation`、`service`、`utility` 之一），校验方式与 `displayNameI18n` 相同：只接受这两个语言键、值为非空字符串、分类必须在枚举内。这两个字段只能写在清单里，插件市场才能从发布的 `package.json` 读到。`@zhin.js/plugin-runtime` 导出 `PLUGIN_CATEGORIES`、`PLUGIN_CATEGORY_LABELS`、`informativeKeywords`、`packageAuthorName`、`readPluginMarketplaceMetadata` 等读取工具。

  市场读取侧：`/pub/marketplace/search` 带出 `displayNameI18n` / `descriptionI18n`，分类读声明的 `category`（旧索引的 `util` 等按别名映射），可选 `locale=zh-CN|en` 按语言解析显示名与描述，并按两种语言的名称与描述搜索；`/pub/marketplace/detail/*` 带出发布清单的显示名、描述翻译与分类。作者一律取 `author`（没有时取 `maintainers`），不再显示发布账号——此前 `plugins.json` 生成脚本优先读 `_npmUser`，CI 可信发布的包因此都显示为「GitHub Actions」。keywords 去掉 `zhin`、`zhin.js`、`bot` 等通用词后展示与参与搜索。`zhin search` / `zhin info` 同样显示中文描述、分类和维护者，`zhin info` 不再读不存在的 `zhin.displayName` / `zhin.category`。

  官方插件与适配器：显示名移到 `package.json#zhin.metadata`，补齐中英文描述、分类、3–6 个有信息量的 keywords，author 统一为 `{ name: "lc-cn", url: "https://github.com/zhinjs/zhin" }`（不再发布邮箱）；npm `description` 与英文描述一致。

  - @zhin.js/skill@1.1.19
  - @zhin.js/tool@1.1.21

## 0.1.13

### Patch Changes

- @zhin.js/skill@1.1.18
- @zhin.js/tool@1.1.20

## 0.1.12

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

- eae4ea8: 官方插件接入分层功能配置（ADR 0050 / 0055）：所有带配置 Schema 的官方插件都声明全部四级（全局 / 适配器 / 账号 / 会话），Console 的适配器、账号与会话页面都能开关它们；密钥、调度与全局资源类字段收窄为仅全局。answers 与 group-suite 可按会话覆盖字段并开放群内自助字段（答题超时、科目一开关；欢迎语、排行条数、教学冷却与分页），ledger 的 `reportWhenEmpty` 可按订阅者会话覆盖。主动推送在发送前按目标会话检查开关：提醒（含管理员提醒）、日历授权通知、地震速报、记账日报、彩票推送、B 站开播 / 动态推送、activity-feedback 的状态提示在已停用的账号或会话上不再发送；roulette 的超时扫描在已停用的会话里静默结束对局（不结算、不禁言、不发消息）。`@zhin.js/schema` 新增 `.fieldLevels(levels)` 用于收窄单个字段的层级；`@zhin.js/testing` 的假插件上下文提供 `isEnabledFor` / `configFor`（`feature` 选项可模拟按会话停用与字段覆盖）。
- 68659cd: `zod` 改为运行时依赖（原为可选对等依赖）：插件运行时在启动时就会加载这些包的约定目录（Agent 工具、命令等），其中静态导入了 `zod`；生成的项目里没有安装可选对等依赖，启动会报 `Cannot find package 'zod'`。范围为 `^4.6.7`（已修复的版本）。
- Updated dependencies [e1fda87]
- Updated dependencies [120e225]
  - @zhin.js/skill@1.1.17
  - @zhin.js/tool@1.1.19

## 0.1.11

### Patch Changes

- @zhin.js/skill@1.1.16
- @zhin.js/tool@1.1.18

## 0.1.10

### Patch Changes

- @zhin.js/tool@1.1.17
- @zhin.js/skill@1.1.15

## 0.1.9

### Patch Changes

- Updated dependencies [72b5a12]
  - @zhin.js/tool@1.1.16
  - @zhin.js/skill@1.1.14

## 0.1.8

### Patch Changes

- Updated dependencies [299863a]
- Updated dependencies [0315ba0]
- Updated dependencies [00be764]
  - @zhin.js/tool@1.1.15
  - @zhin.js/skill@1.1.13

## 0.1.7

### Patch Changes

- Updated dependencies [af8f803]
- Updated dependencies [032dc96]
  - @zhin.js/tool@1.1.14
  - @zhin.js/skill@1.1.12

## 0.1.6

### Patch Changes

- @zhin.js/skill@1.1.11
- @zhin.js/tool@1.1.13

## 0.1.5

### Patch Changes

- Updated dependencies [c58c589]
  - @zhin.js/tool@1.1.12

## 0.1.4

### Patch Changes

- Updated dependencies [eb8feeb]
- Updated dependencies [24a2b71]
- Updated dependencies [d0e1fac]
  - @zhin.js/tool@1.1.11

## 0.1.3

### Patch Changes

- 53bc6a0: 官方工具插件与游戏支持中英文反馈、帮助和配置标签；提醒增加与中文对应的有限英文时间语法。聊天后台任务记录创建者当时语言，管理员任务记录项目语言，旧任务保持中文；多轮选择与游戏使用开始时语言，保留第三方内容和已生成报告。
- Updated dependencies [53bc6a0]
- Updated dependencies [7595136]
- Updated dependencies [17d1301]
  - @zhin.js/tool@1.1.10
  - @zhin.js/skill@1.1.10

## 0.1.2

### Patch Changes

- Updated dependencies [6da2bad]
- Updated dependencies [3781f1c]
  - @zhin.js/tool@1.1.9
  - @zhin.js/skill@1.1.9

## 0.1.1

### Patch Changes

- 17e1cae: Add `@zhin.js/plugin-nettools`: multi-region `ping` (check-host.net), `whois` (RDAP with rdap.org and WHOIS fallbacks), `dns` over HTTPS (Cloudflare → AliDNS → Google) and `domain-price` comparison (nazhumi.com), plus Agent tools `net_ping`, `whois_lookup`, `dns_lookup` and `domain_price`. Targets are canonicalised and refused when private, loopback, link-local, reserved, multicast or cloud-metadata (including hostnames resolving there); every request has a timeout, retry with exponential backoff and jitter, Retry-After handling and a per-user cooldown.
- Updated dependencies [1a11207]
- Updated dependencies [9943df6]
  - @zhin.js/tool@1.1.8
  - @zhin.js/skill@1.1.8
