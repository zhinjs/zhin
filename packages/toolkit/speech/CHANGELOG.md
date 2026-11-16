# @zhin.js/speech

## 1.1.4

### Patch Changes

- f145963: 语音能力的可用性检查与 `voice_tts` 音频不再进入模型上下文（zhinjs/zhin#1250 第 29 批）：

  - `voice-tts-base64-in-model-context`（根因）：`voice_tts` 合成成功后把整段 mp3 的 base64 放进工具结果，Agent 把工具结果原样交给模型，于是模型看到约 2.5 万字符的 base64，并在回复里又抄写一遍（结果出现一段正常、一段残缺的两段语音，整轮将近 6 分钟）。现在 Agent 在工具结果进入模型之前把 `voice_tts` 的音频（以及没有对象存储时 `generate_image` 的内嵌图片）拆出来，作为媒体随本轮回复经正常发送链（`Message.$reply` → OutboundRenderer → Endpoint）只发一次；模型只看到 `{ format, size, sent: true, note }` 和「语音已发送给用户……不要重复输出音频内容」的提示。
  - 兜底：任何工具结果（成功、报告失败、抛错、PostToolUse 改写后的结果）进入模型前，base64 载荷 2048 字符以上的 data URL 与连续 base64 串替换为一行「[已省略 … 数据（N 字符），未提供给模型]」。读文件 / 搜索 / shell 类工具（`read_file`、`grep`、`glob`、`list_dir`、`web_fetch`、`bash` 等）的结果可能被原样写回文件，只截断 64 KB 以上的串并标明「已截断」，CSS / SVG 里的内嵌图标原样保留；`write_file` / `edit_file` 拒绝写入含这类占位的内容并给出明确报错。实现为一次线性扫描，构造输入不会退化为平方复杂度。
  - 会话历史：已发送的工具语音带 `fallbackText`（如「[语音 mp3 18.6KB 已发送]」），内嵌图片带 `alt`；写入历史（`encodeConfirmedOutput`，流式平台的已确认输出）与文本投影（`renderAgentOutput`）时，所有 data URL / base64 媒体元素与媒体段统一只写占位，下一轮模型看不到载荷。非流式回复只带 messageId 写历史（没有已确认输出，保存的是模型原文）时，助手文本同样经过上面的内嵌二进制兜底，模型自己写的内嵌音频 / data URL 段在历史里只剩「[已省略 … 数据（N 字符），未提供给模型]」。助手原文重新交给模型时也一样：格式修复（schema repair）提示里的「Rejected reply」、Agent 循环每次迭代的消息投影（本轮与历史中的助手文本）、迭代耗尽 / 进度摘要的补全，以及压缩摘要请求，都先省略内嵌二进制再发送，模型看不到被拒回复或先前回复里抄写 / 编造的 base64。修复提示要求删掉占位；模型照抄进回复的框架占位（「[已省略 / 已截断 … 数据（N 字符）…]」「[语音 mp3 18.6KB 已发送]」「[语音（内嵌数据，已省略）]」等固定形态）在出站前统一剔除（结算去重与流式快照都覆盖，流式中未写完、可能成为占位的尾部先不提交），普通方括号文字不受影响。取舍：超过 2048 字符、连续由 base64 字符集组成的文本（包括长十六进制串）会以占位提供给模型并存入历史；用户要求模型输出或改写超长 base64 时，原文不会保留到下一轮。
  - 本轮工具已经产出某类媒体（如语音）时，模型回复里同类的内嵌媒体（`kind: base64` 或 `data:` URL，结构化回复的媒体段和文本回复的 `[audio](data:…)` 都算）视为抄写的副本，不再作为第二段媒体发出——结算阶段与流式结构化回复都去重，并在 turn trace 记一条 `copied_inline_media_dropped`（`@zhin.js/agent/trace` 的 `TurnTraceNote` 新增该变体）；模型引用的 URL / 文件不受影响，没有工具媒体时行为不变。
  - `voice_stt` 只接收 URL / 本地路径并返回文字，入站语音按多模态配置转写或作为媒体块交给模型，不会以 base64 文本进入上下文，未改动。
  - `speech-ready-without-tts-binary`：`speech.tts.provider: edge` 时，Speech Host 启动会检查 `speech.tts.edgeTtsCommand`（默认 `edge-tts`）能否执行——只在 `PATH`（Windows 含 `PATHEXT`）/ 文件系统里查找，不运行命令，最多 3 秒。不能执行时：记 warn（`speech_dependency_unavailable`），启动行写成 `degraded | … | tts: edge (unavailable: not-found edge-tts)`，不再写 `ready`；Console「需要你处理」新增 `speech.unavailable` 条目（已登记到 `CONSOLE_ATTENTION_KINDS` 与 `CONSOLE_ATTENTION_KIND_PERMISSIONS`，权限 `status.view`，指向 `speech.tts.edgeTtsCommand`，配置中的家目录路径只显示最后一段）；实例运行时 `zhin doctor` 通过同一个「需要你处理」列表列出它。检查超时只作为提示（`info`），不阻止调用。
  - `edgeTtsCommand` 填了带参数的命令行（如 `uvx edge-tts`）时单独提示「只能填可执行文件路径，不支持带参数」（新增原因 `has-arguments`；路径本身含空格时仍按找不到处理）。Windows 上只接受 `.exe` / `.com`（Node ≥ 22 不经 shell 运行 `.cmd` / `.bat` 会报 `EINVAL`），只有 `.cmd` / `.bat` 时报「不能直接执行」；`@zhin.js/speech` 把 `EINVAL` 翻译为可读提示。
  - 返回给模型的报错与 warn 日志里，命令路径只保留最后一段（`…/edge-tts`），不暴露家目录。
  - `voice_tts` 在 TTS 被标为不可用时先重新检查（装好 edge-tts 后无需重启），仍不可用则直接返回原因（「未找到 edge-tts（命令「…」不在运行环境的 PATH 中）……配置为可执行文件的绝对路径……」），模型据此准确告诉用户；单次调用改用其他 provider 不受影响。合成失败的 `{ error }` 按失败记录、模型看到完整原因（第 26 批）已核实，并在 eval 中断言原因到达模型。
  - `@zhin.js/speech` 的 edge-tts 缺失提示补充命令名、无执行权限（`EACCES`）的情况，以及 launchd / systemd 托管时必须写绝对路径（`PATH` 通常不含 `~/.local/bin`，也不展开 `~`）。其他 provider（openai / azure / custom TTS、openai / ollama STT）都是 HTTP 服务，没有本机命令依赖，不做启动探测。
  - 文档（中英文 `ai/speech`、`@zhin.js/speech` README）说明托管环境中 `edgeTtsCommand` 要写绝对路径、启动检查的表现，以及语音不进模型上下文。

## 1.1.3

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

## 1.1.2

### Patch Changes

- 3781f1c: 支持多模态感知备用模型和 ICQQ 原创表情识图；增强语音回复的使用指引与错误提示，让已启用的 TTS 回复无需逐次审批。ICQQ 踢人工具使用 human 策略，每次都要求独立人工审批，不能由自动审核或历史授权替代。

  内容审核支持按账号和群显式开启广告、辱骂审核：提醒、警告、10 分钟禁言，通知通过 @ 对应成员说明处理结果，30 分钟无新违规重置；提醒/警告是否撤回原消息由模型结合上下文决定。入群 10 分钟内的明确广告可直接踢出，执行前刷新权限和入群时间；审核、通知或平台操作结果不确定时不盲目重试。

  并发消息独立审核并按到达顺序保存上下文，仅处罚和通知使用成员预留；重复投递不覆盖正在等待的撤回决定。接受完整 JSON 代码块，记录无效审核结果。人工确认显示具体参数，并在等待确认时隔离参数，确保批准对象与执行对象一致。

## 1.1.1

### Patch Changes

- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

## 1.1.0

### Minor Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

### Patch Changes

- a34bf91: Publish internal peer dependencies as compatible caret ranges instead of exact versions, preventing compatible internal minor releases from forcing unrelated major bumps.

## 3.0.16

### Patch Changes

- @zhin.js/core@1.5.16

## 3.0.15

### Patch Changes

- Updated dependencies [ba7e17a]
- Updated dependencies [7108d0b]
  - @zhin.js/core@1.5.15

## 3.0.14

### Patch Changes

- Updated dependencies [54bfd6b]
- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
- Updated dependencies [1fc78bc]
  - @zhin.js/core@1.5.14

## 3.0.13

### Patch Changes

- Updated dependencies [f2c532f]
  - @zhin.js/core@1.5.13

## 3.0.12

### Patch Changes

- Updated dependencies [5969c5b]
- Updated dependencies [5969c5b]
- Updated dependencies [974772e]
- Updated dependencies [5969c5b]
- Updated dependencies [2f786bd]
  - @zhin.js/core@1.5.12

## 3.0.11

### Patch Changes

- @zhin.js/core@1.5.11

## 3.0.10

### Patch Changes

- Updated dependencies [d3920e9]
  - @zhin.js/core@1.5.10

## 3.0.9

### Patch Changes

- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/core@1.5.9

## 3.0.8

### Patch Changes

- Updated dependencies [63253bb]
- Updated dependencies [953cfe1]
- Updated dependencies [0e73866]
  - @zhin.js/core@1.5.8

## 3.0.7

### Patch Changes

- Updated dependencies [36cb1ca]
  - @zhin.js/core@1.5.7

## 3.0.6

### Patch Changes

- @zhin.js/core@1.5.6

## 3.0.5

### Patch Changes

- @zhin.js/core@1.5.5

## 3.0.4

### Patch Changes

- Updated dependencies [b0f37ae]
- Updated dependencies [36c7400]
- Updated dependencies [162fa34]
- Updated dependencies [e40b048]
- Updated dependencies [f1708c3]
- Updated dependencies [e53444f]
- Updated dependencies [92b0dd7]
- Updated dependencies [a7df753]
  - @zhin.js/core@1.5.4

## 3.0.3

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/core@1.5.3

## 3.0.2

### Patch Changes

- Updated dependencies [afc0e66]
  - @zhin.js/core@1.5.2

## 3.0.1

### Patch Changes

- @zhin.js/core@1.5.1

## 3.0.0

### Patch Changes

- Updated dependencies [4fbff5d]
- Updated dependencies [5b94d9c]
  - @zhin.js/core@1.5.0

## 2.0.3

### Patch Changes

- Updated dependencies [45b3256]
  - @zhin.js/core@1.4.3

## 2.0.2

### Patch Changes

- @zhin.js/core@1.4.2

## 2.0.1

### Patch Changes

- 5691aba: 第二轮全量审计修复批（8 面 ~60 bug）：

  - **安全**：email 附件路径穿越修复（basename + downloadPath 约束）；lark/telegram/satori webhook 鉴权（缺密钥告警、timingSafeEqual、±5min 时效窗、chat_type 修正）；onebot wss/webhook 缺 token 告警；qq webhook 改原始字节验签；renderJsx/JSX 转义注入修复；console runtime token 401 死循环。
  - **P0 功能**：sandbox 多 endpoint 解析 + WS 路径隔离；short-url expand（undici opaqueredirect）改 follow；AI 压缩摘要失败不再静默丢历史（熔断恢复生效）；console-ui 实时推送事件名归一化 + IndexedDB schema 对齐；process-monitor 热重载不再误判崩溃。
  - **生命周期**：email IMAP 断线重连 + 在飞锁；onebot11/12 start 失败清理；line replyToken TTL + push 兜底；wechat-mp token 过期重试 + MsgId 去重；weixin-ilink buf 推进/防抖写盘/媒体 TTL/QR abort；satori PONG 看门狗；退避自毁修复。
  - **游戏**：text-adventure 终局 restart 复活 + requires 服务端校验；tic-tac-toe PvP 占用/restart/队列清理/TTL；idiom-chain/word-riddle 闲聊不扣失误；别名中间件不劫持普通聊天。
  - **共享库**：schema falsy 默认值/date/tuple/union 修复；database parseCondition Date/未知操作符、sqlite TEXT 往返、query 分派、belongsToMany 方言、migration dry-run；schedule DST 回拨死循环、重复 id 去重、flush 串行化；game-kit fallback 编号/onboarding 提示/尾缀边界/活引用拷贝。
  - **渲染语音**：fetch 全部超时 + 渲染并发闸；sanitizeHtml form 保文本；STT 扩展名映射 + 删临时文件；TTS 未知 provider 报错；emojiCache LRU 负缓存/fontCache style/clearFonts 恢复；register 错误分类收窄。

- Updated dependencies [f0ec5ab]
- Updated dependencies [fa66c4c]
- Updated dependencies [6cb6152]
  - @zhin.js/core@1.4.1

## 2.0.0

### Patch Changes

- Updated dependencies [7db69c1]
- Updated dependencies [ac9da66]
  - @zhin.js/core@1.4.0

## 1.0.4

### Patch Changes

- Updated dependencies [16ec4e8]
- Updated dependencies [cc5c94d]
- Updated dependencies [447f3e2]
  - @zhin.js/core@1.3.5

## 1.0.3

### Patch Changes

- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/core@1.3.4

## 1.0.2

### Patch Changes

- 5cc9c03: fix: ai 优化
- Updated dependencies [5b08052]
- Updated dependencies [5cc9c03]
- Updated dependencies [36d6db2]
- Updated dependencies [b9b3881]
- Updated dependencies [7700903]
  - @zhin.js/core@1.3.3

## 1.0.1

### Patch Changes

- c4575c9: Add optional peer `@zhin.js/speech`: inbound STT (`audio.strategy: transcribe` default), outbound TTS (`segment.tts` + `voice_stt`/`voice_tts` tools), TTS providers edge/openai/azure/custom. Remove `@zhin.js/plugin-voice`; use `speech:` config key instead of `voice:`.
- Updated dependencies [c4575c9]
- Updated dependencies [c4575c9]
  - @zhin.js/core@1.3.2

## 1.0.0

### Patch Changes

- chore: initial stable release line
