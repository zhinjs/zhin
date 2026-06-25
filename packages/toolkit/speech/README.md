# @zhin.js/speech

Zhin.js 可选语音包：STT（Whisper）与 TTS（edge / OpenAI / Azure / 自定义 OpenAI 兼容 API）。

安装：

```bash
pnpm add @zhin.js/speech
```

配置（`zhin.config.yml`）：

```yaml
speech:
  stt:
    provider: ollama
    model: whisper
    host: http://localhost:11434
  tts:
    provider: edge
    voice: zh-CN-XiaoxiaoNeural
    edgeTtsCommand: edge-tts
```

由 `zhin.js` 启动时自动注册 `voice_stt` / `voice_tts` 工具与入站 STT（`ai.multimodal.audio.strategy: transcribe`）。

## TTS Providers

| provider | 说明 |
|----------|------|
| `edge`（默认） | 需 `pip install edge-tts` |
| `openai` | `POST /v1/audio/speech` |
| `azure` | Azure Cognitive Speech REST |
| `custom` | OpenAI 兼容 `baseUrl` |

## License

MIT
