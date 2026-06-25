# ADR 0020：语音管线（STT / TTS）与 AI 内容链

## 状态

Accepted（单 PR 落地；`@zhin.js/plugin-voice` 已删除）

## 背景

- 用户通过 IM 发送 **语音 / 录音** 时，多数 LLM 无法直接理解二进制音频；需要 **STT** 将内容转为文本再进入 Agent 上下文。
- Agent 回复若需 **语音消息**（或平台只支持 audio 段），需要 **TTS** 将文本合成为标准 `audio` 段，再走统一出站链。
- 仓库已有 **`@zhin.js/plugin-voice`**（Ollama/OpenAI STT + edge-tts TTS + `voice_stt` / `voice_tts` 工具），但：
  - 与 **Rich Segment / optional peer** 长期架构不一致（应对齐 `@zhin.js/html-renderer` 模式）；
  - 入站默认 `audio.strategy: text-only`，语音 **不会自动转写**，AI 只能看到占位或需模型主动调工具；
  - TTS 仅经工具 → `media-tool-bridge`，缺少 **`segment.tts`** 语义段与 Adapter policy 统一出口。

目标：**STT + TTS 都纳入框架能力**，使「人 ↔ 平台 ↔ AI」之间的语音内容可预测地转换，且不撑大 IM 核心安装体积（ADR 0019）。

## 决策

### D1. 双管线、对称分工

| 方向 | 职责 | 挂载点 | 产出 |
|------|------|--------|------|
| **入站 STT** | 语音段 → 模型可读文本 | `@zhin.js/agent` 多模态预处理（`preprocessInboundMedia` / AI trigger 前） | 追加/替换为 `text`；可选 `$extra.transcript` 元数据 |
| **出站 TTS** | 文本 → 标准 IM `audio` 段 | Rich Segment `tts` kind + 现有 `voice_tts` 工具桥 | `segment('audio', …)` → `resolveRichSegments` → Endpoint `materializeOutboundMedia` |

**不重复**：Endpoint 仍只负责「已有 audio/video/file → 平台上传/格式」；不负责 Whisper/edge-tts 本身。

### D2. 可选包 `@zhin.js/speech`

- 新 workspace 包：`packages/toolkit/speech/`（名称暂定 **`@zhin.js/speech`**）。
- 从 `plugin-voice` **迁出引擎**（STT/TTS provider 实现），插件层变薄或废弃。
- **`zhin.js` optional peer**；未安装时：
  - 入站：降级为现有行为（占位文本 / 落盘提示 / 模型调 MCP）；
  - 出站：`tts` rich segment 降级为 `text`（与 html-renderer 未装时一致）。
- 启动注册（对齐 html-renderer）：`packages/im/zhin/src/setup/register-speech.ts` 注册 capability loader + 可选 `voice_stt` / `voice_tts` 工具。

导出契约（最小）：

```typescript
interface SpeechPipeline {
  transcribe(input: { data: Buffer | string; mimeType?: string }): Promise<string>;
  synthesize(input: { text: string; voice?: string }): Promise<{ data: Buffer; format: 'mp3' | 'wav' }>;
}
export function createSpeechPipeline(config?: SpeechConfig): SpeechPipeline;
```

### D3. Capability 注册（core 已预留）

- Rich Segment：`registerRichSegmentCapabilityLoader('speech', …)` 或复用 id **`media-pipeline`**（TTS/转码）；**STT 不入 Rich Segment**，走 agent 入站链。
- Core `RichSegmentCapabilityId` 已含 `'media-pipeline'`；speech 包可同时注册 `speech` loader，由 zhin setup 一次性挂载。

### D4. 入站 STT：`audio.strategy` 扩展

在 `ai.multimodal.audio.strategy` 增加 **`transcribe`**（命名 SSOT）：

| strategy | 行为 |
|----------|------|
| `text-only` | 仅描述/占位，不转写 |
| `mcp` | 落盘 + 提示路径，供 MCP/工具 |
| `transcribe` | 调用 `@zhin.js/speech`（或已注册 loader）；成功则将转写文本 **合并进 AI 输入** |

配置示例：

```yaml
ai:
  multimodal:
    audio:
      strategy: transcribe   # 需 @zhin.js/speech
speech:
  stt:
    provider: openai         # openai | ollama | …
    model: whisper-1
  tts:
    voice: zh-CN-XiaoxiaoNeural
    edgeTtsCommand: edge-tts
```

### D5. 出站 TTS：Rich Segment `tts` + 工具并存

1. **`segment.tts({ text, voice? })`** — 注册 kind `tts`，默认 mode `audio`；Adapter 可 override `outboundRichSegmentPolicy.tts: 'audio' | 'text' | 'origin'`。
2. **`voice_tts` 工具** — 保留；`media-tool-bridge` 已支持 → `AudioElement` → `publishOutboundElements`。
3. **Agent 回复策略**（产品层）：平台偏好语音时可 policy `tts: audio`，否则 `text`。

### D6. `plugin-voice` 迁移

- **已完成**：删除 `plugins/utils/voice`；能力迁至 `@zhin.js/speech` + zhin bootstrap。
- 配置键 **`speech:`**（breaking：`voice:` 不再读取）。
- TTS providers：`edge`（默认）| `openai` | `azure` | `custom`。

### D7. 安装分层（install tiers）

在 `docs/snippets/install-tiers.md` 增加一行（与 Rich media 并列或合并为 **Media**）：

| 档位 | 安装 | 能力 |
|------|------|------|
| **Speech** | `+ @zhin.js/speech` | 入站 STT、出站 TTS、`tts` rich segment |

IM 核心仍 **不** 硬依赖 speech。

## 实现阶段

1. **包与 loader**：`@zhin.js/speech` + `register-speech.ts` + 动态 import warn-once。
2. **入站垂直切片**：`transcribe` strategy + 单测（mock pipeline）。
3. **出站垂直切片**：`TtsSegment` + registry + 单测；一个 Adapter policy 示例。
4. **迁移 plugin-voice** + test-bot 配置 + install tiers + `zhin doctor` 提示。
5. **（可选）** 视频抽帧/转码并入同一包或 sibling `@zhin.js/media-pipeline`（ffmpeg）；与 STT/TTS 共用 loader id。

## 后果

- 启用 `transcribe` 未装 speech 包时：warn once，回退 `text-only` 行为。
- STT 增加延迟与外部依赖（API/CLI）；需在 AI trigger 日志中记录 `stage: stt` 与耗时。
- TTS 出站体积受平台 `maxAttachmentBytes` 约束；超长文本需分段或仅 text。
- `im_transcripts` 可存转写文本；原始音频是否落盘由 `inboundDir` 与 strategy 决定。

## 相关

- [ADR 0019](./0019-install-size-layering.md) — optional peer 与 install tiers
- [packages/im/core/README.md — Rich Segment 扩展](../../packages/im/core/README.md)
- 现有实现：`plugins/utils/voice`、`packages/im/agent/src/media/media-router.ts`、`media-tool-bridge.ts`
- Install tiers SSOT：`docs/snippets/install-tiers.md`
