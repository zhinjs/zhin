# AI 内容链可观测性

入站语音、多模态 parts、Rich Segment 出站、Adapter 发送构成一条 **AI 内容链**。排查「语音有没有进 AI」「html 有没有出图」时，按 stage 日志检索。

## Stage SSOT

| stage | 含义 | 典型日志前缀 |
|-------|------|----------------|
| `extract_media` | 从 Message 提取 media parts | `[Content Chain] stage: extract_media` |
| `stt` | 入站语音转写（`preprocessInboundMedia`） | `[Content Chain] stage: stt` |
| `multimodal` | 合并文本 + vision parts 送入 Agent | `[Content Chain] stage: multimodal` |
| `rich_segment` | `resolveRichSegments` 渲染 html/tts/qrcode 等 | `[Content Chain] stage: rich_segment` |
| `outbound` | Adapter 发送前含 image/audio 段 | `[Content Chain] stage: outbound` |

统一字段：`kind`、`mode`、`fallback`、`peer`（`speech` / `html-renderer`）、`adapter`。

## 常见问题

### 配置了 transcribe 但语音仍是占位文本

1. 确认已安装：`pnpm add @zhin.js/speech`
2. 运行 `zhin doctor --fix` 检查 optional peer
3. 日志搜 `stage: stt`；若 `fallback` 或 warn 含 `未安装 @zhin.js/speech`，补装 peer 后重启

### html 卡片变成纯文本

1. 确认 `@zhin.js/html-renderer` 已安装
2. Adapter `outboundRichSegmentPolicy` 中 `html` 是否为 `image`（见 [Rich Segment 适配器矩阵](/essentials/rich-segment-adapters)）
3. 日志搜 `stage: rich_segment; kind: html` 查看 `mode` 与 `fallback`

### warn-once

optional peer 缺失时每个 peer **只 warn 一次**（key：`speech`、`html-renderer`），消息含 `pnpm add …` 修复提示。

## 相关文档

- [Install tiers — Speech / Rich media](/getting-started/#install-tierszhinjs-4x)
- [ADR 0020 — Speech 管线](/adr/0020-speech-pipeline-stt-tts)
- [配置 — speech / htmlRenderer](/essentials/configuration#语音-stt-tts-zhinjsspeech-optional-peer)

## doctor

```bash
zhin doctor              # 含 speech / html-renderer optional peer 检查
zhin doctor --fix        # 写入 package.json 缺失依赖
zhin doctor --upgrade-l4 # minimal → L4 升级诊断 + 建议配置块
```
