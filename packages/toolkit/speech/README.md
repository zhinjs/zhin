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
    enabled: false # TTS 可独立使用；语音转写另配支持 STT 的服务
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

## 短语音回复与验证

`voice_tts` 的结果会进入 Agent 的媒体发送桥，生成当前会话的 audio 段。工具说明建议用于明确的语音请求、对方先发语音、情绪化短句或私聊中偶尔使用；长内容使用文字。空文字、空音频视为失败，Agent 应改用文字回复。显式关闭 STT/TTS 后不向 Agent 披露对应工具。

TTS 工具声明为免逐次审批的回复能力，不接收其他会话目标或文件路径；涉及读取文件的 `voice_stt` 保持原有审批策略。TTS 仍使用配置的 provider，调用费用取决于该服务。

Edge 需要在 **Bot 所在环境** 安装命令，不要求安装 Edge 浏览器。可按 [edge-tts 官方说明](https://github.com/rany2/edge-tts#installation) 安装到独立环境：

```bash
python3 -m venv .venv-speech
.venv-speech/bin/pip install edge-tts
.venv-speech/bin/edge-tts --voice zh-CN-XiaoxiaoNeural --text '你好，这是语音测试。' --write-media /tmp/zhin-voice-test.mp3
```

将 `speech.tts.edgeTtsCommand` 设置为该环境内 `edge-tts` 的绝对路径；服务进程的 PATH 未必与终端相同。缺少命令时框架会提示这个配置项，不会假装生成成功。不使用 CLI 时可配置现有 openai / azure / custom provider。

注意：Ollama 不支持音频转写，`provider: ollama, model: whisper` 无法启用 STT。入站语音转写需配置 `speech.stt.provider: openai` 和支持音频转写的服务及凭据，再启用 `ai.multimodal.audio.strategy: transcribe`。TTS 可独立使用，不要求先启用 STT。
