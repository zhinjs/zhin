# @zhin.js/plugin-voice

Zhin.js 语音输入/输出插件，提供语音识别（STT）和语音合成（TTS）功能。

## 功能特性

- **STT（Speech-to-Text）** — 通过 Whisper 模型将语音消息转写为文字
  - 支持 Ollama 和 OpenAI API 两种 Provider
- **TTS（Text-to-Speech）** — 通过 edge-tts 将文字转换为语音消息
  - 支持自定义语音、语速、音调
- AI 工具集成 — 自动注册为 AI 可调用的 Tool

## 安装

```bash
pnpm add @zhin.js/plugin-voice
```

### 前置依赖

**STT（语音识别）**：

- [Ollama](https://ollama.com/) 并安装 Whisper 模型：`ollama pull whisper`
- 或使用 OpenAI API（需要 API Key）

**TTS（语音合成）**：

- [edge-tts](https://github.com/rany2/edge-tts)：`pip install edge-tts`

## 配置

在 `zhin.config.yml` 中配置：

```yaml
plugins:
  - voice                       # 或带配置的写法

voice:
  stt:
    enabled: true
    provider: ollama            # ollama | openai
    model: whisper              # Whisper 模型名称
    host: http://localhost:11434  # Ollama API 地址
    # apiKey: sk-xxx            # OpenAI 模式需要
  tts:
    enabled: true
    voice: zh-CN-XiaoxiaoNeural  # edge-tts 语音
    rate: '+0%'                   # 语速调整
    pitch: '+0Hz'                 # 音调调整
    edgeTtsCommand: edge-tts      # edge-tts CLI 路径
```

## AI 工具

插件会自动注册以下 AI 工具：

### text_to_speech

将文本转换为语音。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `text` | string | 是 | 要转换的文本 |
| `voice` | string | 否 | 语音类型（覆盖默认配置） |

### speech_to_text

将语音转换为文本。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `audio_url` | string | 是 | 音频文件 URL |

## 可用语音列表

edge-tts 支持多种语音，常用的中文语音包括：

| 语音 ID | 说明 |
|---------|------|
| `zh-CN-XiaoxiaoNeural` | 晓晓（女声，默认） |
| `zh-CN-YunxiNeural` | 云希（男声） |
| `zh-CN-YunjianNeural` | 云健（男声） |
| `zh-CN-XiaoyiNeural` | 晓伊（女声） |

查看全部语音：`edge-tts --list-voices`

## 使用示例

```typescript
import { usePlugin, ZhinTool } from 'zhin.js'

const { addTool } = usePlugin()

// 插件已自动注册 TTS/STT 工具
// AI 可以通过 "帮我朗读这段文字" 等自然语言触发 TTS
// AI 可以通过接收语音消息触发 STT
```

## 许可证

MIT License
