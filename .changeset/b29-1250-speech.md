---
"@zhin.js/agent": minor
"zhin.js": patch
"@zhin.js/console-protocol": patch
"@zhin.js/speech": patch
---

语音能力的可用性检查与 `voice_tts` 音频不再进入模型上下文（zhinjs/zhin#1250 第 29 批）：

- `voice-tts-base64-in-model-context`（根因）：`voice_tts` 合成成功后把整段 mp3 的 base64 放进工具结果，Agent 把工具结果原样交给模型，于是模型看到约 2.5 万字符的 base64，并在回复里又抄写一遍（结果出现一段正常、一段残缺的两段语音，整轮将近 6 分钟）。现在 Agent 在工具结果进入模型之前把 `voice_tts` 的音频（以及没有对象存储时 `generate_image` 的内嵌图片）拆出来，作为媒体随本轮回复经正常发送链（`Message.$reply` → OutboundRenderer → Endpoint）只发一次；模型只看到 `{ format, size, sent: true, note }` 和「语音已发送给用户……不要重复输出音频内容」的提示。
- 兜底：任何工具结果（成功、报告失败、抛错、PostToolUse 改写后的结果）进入模型前，base64 载荷 2048 字符以上的 data URL 与连续 base64 串替换为一行「[已省略 … 数据（N 字符），未提供给模型]」。读文件 / 搜索 / shell 类工具（`read_file`、`grep`、`glob`、`list_dir`、`web_fetch`、`bash` 等）的结果可能被原样写回文件，只截断 64 KB 以上的串并标明「已截断」，CSS / SVG 里的内嵌图标原样保留；`write_file` / `edit_file` 拒绝写入含这类占位的内容并给出明确报错。实现为一次线性扫描，构造输入不会退化为平方复杂度。
- 会话历史：已发送的工具语音带 `fallbackText`（如「[语音 mp3 18.6KB 已发送]」），内嵌图片带 `alt`；写入历史（`encodeConfirmedOutput`，流式平台的已确认输出）与文本投影（`renderAgentOutput`）时，所有 data URL / base64 媒体元素与媒体段统一只写占位，下一轮模型看不到载荷。非流式回复只带 messageId 写历史（没有已确认输出，保存的是模型原文）时，助手文本同样经过上面的内嵌二进制兜底，模型自己写的内嵌音频 / data URL 段在历史里只剩「[已省略 … 数据（N 字符），未提供给模型]」。
- 本轮工具已经产出某类媒体（如语音）时，模型回复里同类的内嵌媒体（`kind: base64` 或 `data:` URL，结构化回复的媒体段和文本回复的 `[audio](data:…)` 都算）视为抄写的副本，不再作为第二段媒体发出——结算阶段与流式结构化回复都去重，并在 turn trace 记一条 `copied_inline_media_dropped`（`@zhin.js/agent/trace` 的 `TurnTraceNote` 新增该变体）；模型引用的 URL / 文件不受影响，没有工具媒体时行为不变。
- `voice_stt` 只接收 URL / 本地路径并返回文字，入站语音按多模态配置转写或作为媒体块交给模型，不会以 base64 文本进入上下文，未改动。
- `speech-ready-without-tts-binary`：`speech.tts.provider: edge` 时，Speech Host 启动会检查 `speech.tts.edgeTtsCommand`（默认 `edge-tts`）能否执行——只在 `PATH`（Windows 含 `PATHEXT`）/ 文件系统里查找，不运行命令，最多 3 秒。不能执行时：记 warn（`speech_dependency_unavailable`），启动行写成 `degraded | … | tts: edge (unavailable: not-found edge-tts)`，不再写 `ready`；Console「需要你处理」新增 `speech.unavailable` 条目（已登记到 `CONSOLE_ATTENTION_KINDS` 与 `CONSOLE_ATTENTION_KIND_PERMISSIONS`，权限 `status.view`，指向 `speech.tts.edgeTtsCommand`，配置中的家目录路径只显示最后一段）；实例运行时 `zhin doctor` 通过同一个「需要你处理」列表列出它。检查超时只作为提示（`info`），不阻止调用。
- `edgeTtsCommand` 填了带参数的命令行（如 `uvx edge-tts`）时单独提示「只能填可执行文件路径，不支持带参数」（新增原因 `has-arguments`；路径本身含空格时仍按找不到处理）。Windows 上只接受 `.exe` / `.com`（Node ≥ 22 不经 shell 运行 `.cmd` / `.bat` 会报 `EINVAL`），只有 `.cmd` / `.bat` 时报「不能直接执行」；`@zhin.js/speech` 把 `EINVAL` 翻译为可读提示。
- 返回给模型的报错与 warn 日志里，命令路径只保留最后一段（`…/edge-tts`），不暴露家目录。
- `voice_tts` 在 TTS 被标为不可用时先重新检查（装好 edge-tts 后无需重启），仍不可用则直接返回原因（「未找到 edge-tts（命令「…」不在运行环境的 PATH 中）……配置为可执行文件的绝对路径……」），模型据此准确告诉用户；单次调用改用其他 provider 不受影响。合成失败的 `{ error }` 按失败记录、模型看到完整原因（第 26 批）已核实，并在 eval 中断言原因到达模型。
- `@zhin.js/speech` 的 edge-tts 缺失提示补充命令名、无执行权限（`EACCES`）的情况，以及 launchd / systemd 托管时必须写绝对路径（`PATH` 通常不含 `~/.local/bin`，也不展开 `~`）。其他 provider（openai / azure / custom TTS、openai / ollama STT）都是 HTTP 服务，没有本机命令依赖，不做启动探测。
- 文档（中英文 `ai/speech`、`@zhin.js/speech` README）说明托管环境中 `edgeTtsCommand` 要写绝对路径、启动检查的表现，以及语音不进模型上下文。
