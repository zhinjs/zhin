---
title: "语音能力（Speech）"
description: "让 Bot 听懂语音消息并用语音回复：安装、语音转文字（STT）、文字转语音（TTS）与 Agent 语音工具"
---

# 语音能力（Speech）

群里发来一条语音，Bot 听懂了内容，还能回一段合成语音——这就是可选包 `@zhin.js/speech` 提供的能力：

- **入站语音自动转文字**（STT），转写结果交给 AI 处理；
- **给 AI 两个语音工具**：`voice_stt`（识别）和 `voice_tts`（合成）。

没有安装这个包时，`speech:` 配置会被跳过并记录 warn，不影响其他功能。

```mermaid
flowchart LR
    V[语音消息] -->|audio_url| S[Speech Host STT]
    S -->|转写文本| A[ZhinAgent 回合]
    A -->|voice_tts 工具| T[TTS provider]
    T -->|音频| H[Agent Host]
    H -->|元数据：sent / format / size| A
    H -->|语音消息段，随回复经发送链| U[用户]
```

## 快速启用

```bash
pnpm add @zhin.js/speech
```

在 `zhin.config.yml` 顶层加入 `speech:` 段，重启后实例会自动装配 Speech Host：

```yaml
speech:
  stt: { provider: openai, model: whisper-1, host: https://api.openai.com, apiKey: ${OPENAI_API_KEY} }
  tts: { provider: edge, voice: zh-CN-XiaoxiaoNeural }
```

## 配置

```yaml
speech:
  stt:
    provider: openai          # ollama | openai
    model: whisper-1
    host: https://api.openai.com
    apiKey: ${OPENAI_API_KEY}
  tts:
    provider: edge            # edge | openai | azure | custom
    voice: zh-CN-XiaoxiaoNeural
```

## STT（语音转文字）

| provider | 说明 |
|----------|------|
| `openai` | 调 `{host}/v1/audio/transcriptions`（OpenAI 兼容 whisper 接口）；`model` 默认 `whisper-1`，`host` 默认 `https://api.openai.com`，语言固定 `zh`，超时 60s |
| `ollama` | **当前不可用**：Ollama 没有音频转写模型，调用会直接报错并提示改用 `openai` |

`stt.enabled: false` 可单独关闭 STT。入站语音先走统一媒体物化与真实 MIME/大小校验；策略为 `transcribe` 时，Agent Host 再转写并作为派生文本加入当前 Turn。下载、校验或转写失败都会产生明确媒体终态，不会伪装成模型已识别成功。

语音地址可能由发消息的人决定，所以 Speech Host 下载语音（入站语音的地址、手写的 `[audio:URL]`、`voice_stt` 的 `audio_url`）和其他入站媒体用同一套规则：只下载公网 HTTPS 地址；唯一的例外是适配器根据平台数据产出的语音段（段里的 `media` / `url` / `src` / `file`、`metadata.audio_url`，例如 QQ 的语音 CDN 链接），这类地址也可以是公网 HTTP，其余规则不变，且从 HTTPS 重定向到 HTTP 一律拒绝。消息正文里手写的 `[audio:URL]`、`voice_stt` 的 `audio_url`，以及声明了 `runtime.sandbox` 的端点（如 Sandbox，客户端自己拼语音段）或读不到能力画像的端点上的语音段，都算用户提供的地址，只认 HTTPS。主机名解析到私网、回环、链路本地或云元数据地址的一律拒绝，连接时只连已校验过的那个地址（防 DNS 重绑定）；重定向逐跳重新校验；单个语音最大 25 MB、整次下载 30 秒。被拒的地址不会发出任何请求，这一轮照常继续，模型看到「[语音地址不可用，未转写（speech_url_blocked）]」，`voice_stt` 返回同样原因的 `{ error }`；日志记 `op: speech_url_blocked` 和主机名，不记完整地址。没有把内网主机加入白名单的配置：需要转写内网存放的语音时，请先放到公网 HTTPS 地址。

音频格式按 MIME 推断扩展名（wav / mp3 / ogg / webm / amr / silk / m4a / flac），无法识别时按 wav 处理。

## TTS（文字转语音）

`tts.provider` 缺省为 `edge`。四个 provider：

| provider | 关键配置 | 说明 |
|----------|----------|------|
| `edge` | `voice`（默认 `zh-CN-XiaoxiaoNeural`）、`rate`（默认 `+0%`）、`pitch`（默认 `+0Hz`）、`edgeTtsCommand`（默认 `edge-tts`） | 调本机 `edge-tts` CLI，输出 mp3；需自行安装该命令 |
| `openai` | `host`（默认 `https://api.openai.com`）、`model`（默认 `tts-1`）、`voice`（默认 `alloy`）、`speed` | 调 `{host}/v1/audio/speech`；apiKey 取 `tts.apiKey`，缺省回落 `stt.apiKey` |
| `azure` | `region`（默认 `eastasia`）、`subscriptionKey`、`voice` | Azure Cognitive Services REST，输出 16kHz mp3 |
| `custom` | `baseUrl`（必填）、`headers`、`model`、`voice`、`speed` | 任意 OpenAI 兼容 TTS 端点，body 同 `/v1/audio/speech` |

TTS 请求超时统一 30s，输出格式 mp3（`openai` / `custom` 可选 wav）。

### edge-tts 与托管环境（launchd / systemd）

`edge` provider 调用本机命令 `edge-tts`（`pip install edge-tts`）。实例由 launchd、systemd、pm2 等托管时，进程的 `PATH` 往往很短，通常**不包含** `~/.local/bin` 或虚拟环境的 `bin`，在终端里能用的 `edge-tts` 在服务里会找不到。托管运行时请把 `edgeTtsCommand` 写成**可执行文件的绝对路径**（不要用 `~`，它不会被展开）：

```yaml
speech:
  tts:
    provider: edge
    edgeTtsCommand: /Users/me/.local/bin/edge-tts   # `command -v edge-tts` 的输出
```

`edgeTtsCommand` 只能填可执行文件路径，不支持带参数（例如 `uvx edge-tts`）。Windows 上要指向 `edge-tts.exe`：Node 不经 shell 无法直接运行 `.cmd` / `.bat`。

启动时 Speech Host 会检查 `edgeTtsCommand` 能否执行（只在 `PATH` / 文件系统里查找，不运行命令，最多 3 秒）。不能执行时：

- 启动日志记 warn，写成 `degraded | … | tts: edge (unavailable: not-found edge-tts)`，不再写 `ready`；
- Console「需要你处理」出现「语音合成（edge）不可用」（`speech.unavailable`，指向 `speech.tts.edgeTtsCommand`），`zhin doctor` 在实例运行时也会列出这一条；
- `voice_tts` 被调用时先重新检查一次（装好 edge-tts 后无需重启），仍不可用就直接返回原因（「未找到 edge-tts……」），模型据此如实告诉用户。返回给模型的报错和日志中，命令路径只保留最后一段（如 `…/edge-tts`），不暴露家目录。

其他 provider（openai / azure / custom TTS，openai / ollama STT）都是 HTTP 服务，没有本机命令依赖；服务地址或密钥有问题时在调用时报出具体原因。

## Agent 工具

Speech Host 装配后向 Agent 注册两个工具（`source: speech`）：

| 工具 | 参数 | 返回 |
|------|------|------|
| `voice_stt` | `audio_url`（仅公网 HTTPS，规则同上）或 `file_path`（本地绝对路径，二选一） | `{ text }`；失败返回 `{ error }` |
| `voice_tts` | `text`（必填）、`voice`（覆盖默认）、`provider`（`edge` / `openai` / `azure` / `custom`） | 模型看到 `{ format, size, sent: true, note }`；失败返回 `{ error }`（含原因） |

`voice_tts` 可按调用临时切换 provider，便于一次部署同时挂多种音色。

合成的音频**不会交给模型**：Agent 在工具结果进入模型之前把音频拆出来，作为语音消息段随本轮回复经正常发送链（`Message.$reply` → OutboundRenderer → Endpoint）发出，只发一次；模型只看到元数据和「语音已发送，不要重复输出音频内容」的提示。工具结果里 2048 字符以上的 base64 / data URL 在进入模型前会被替换为一行说明（读文件、搜索、shell 类工具只截断 64 KB 以上的串并标明「已截断」，`write_file` / `edit_file` 拒绝写入这类占位）；会话历史里已发送的语音只记占位（如「[语音 mp3 18.6KB 已发送]」）；本轮工具已经产出语音时，模型回复里抄写的内嵌音频（含流式回复）不会再作为第二段语音发出。模型照抄进回复的这些占位（「[已省略 … 数据（N 字符）…]」「[语音 mp3 18.6KB 已发送]」等固定形态）不会发给用户。

取舍：超过 2048 个字符、连续由 base64 字符集组成的文本（包括很长的十六进制串）一律视为内嵌二进制，以占位提供给模型并以占位存入历史；用户要求模型输出或改写超长 base64 时，原文不会保留到下一轮。

## 相关

- [AI 能力总览](./index.md)
- [Agent 深入](./agent.md)
