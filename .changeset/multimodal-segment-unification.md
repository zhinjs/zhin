---
"@zhin.js/core": minor
"@zhin.js/ai": minor
"@zhin.js/agent": minor
"@zhin.js/cli": minor
"@zhin.js/adapter": minor
"@zhin.js/adapter-qq": minor
"@zhin.js/adapter-icqq": minor
"@zhin.js/adapter-napcat": minor
"@zhin.js/adapter-onebot11": minor
"@zhin.js/adapter-onebot12": minor
"@zhin.js/adapter-milky": minor
"@zhin.js/adapter-satori": minor
"@zhin.js/adapter-slack": minor
"@zhin.js/adapter-telegram": minor
"@zhin.js/adapter-discord": minor
"@zhin.js/adapter-kook": minor
"@zhin.js/adapter-lark": minor
"@zhin.js/adapter-dingtalk": minor
"@zhin.js/adapter-line": minor
"@zhin.js/adapter-wecom": minor
"@zhin.js/adapter-wechat-mp": minor
"@zhin.js/adapter-weixin-ilink": minor
"@zhin.js/adapter-email": minor
"@zhin.js/adapter-github": minor
"@zhin.js/adapter-sandbox": minor
---

feat!: 多模态双向 Segment 一贯制（BREAKING，无兼容层）

全框架唯一媒体表达统一为 canonical `Segment` + `MediaRef{kind: url|path|base64|file, value, mime_type?, file_name?, size?}`，新增 audio/video/file 段类型；所有第二形状（legacy `data.url/file/base64` 字段、`mediaRefFromLegacyData`/`mediaRefToLegacyFields` 桥、双写）全部删除。

- **core**：`SendContent` 一等支持 `Segment[]`；endpoint 出站载荷只含 canonical 段；`resolveOutboundMediaPolicy` 改为纯声明驱动（adapter definition `segments.outboundMedia`），内置策略表删除，未声明回退 `url-or-text`；`ImageContent` 旧桥删除。
- **ai**：新增 `MediaContentBlock`/`MediaBlockRef`（Segment 同构）与 `UserMessage.media`（当前 turn 媒体，**不持久化**——存储层自动剥离）；`createUserMessage(text, media?)` 签名变更（`ImageContent` 删除）；provider 边界序列化器 `filterMediaBlocksForProvider` + 能力表（缺省 image-only，不支持类型降级占位文本）；ai-sdk 桥媒体块 → SDK image/file parts。
- **agent**：入站 turn 注入（`turn/inbound-media.ts`）——commMessage 媒体段 → 当前 turn `UserMessage.media`；图片 path 物化、音频默认 STT（`@zhin.js/speech` 可选，失败降级占位）、视频/文件占位；`publishOutboundElements` 产出 canonical Segment；`transcribeAudioPayload` 导出。
- **cli**：`bridgeRuntimeMessage` 回复链路媒体段透传，不再压平为文本（`$reply` 直达 normalize → adapter）。
- **全部 20 个平台适配器**：出站媒体只消费 `data.media`（url 直发 / base64 直发 / 平台上传 / 读盘），入站媒体产出 canonical `data.media`；`segments.outboundMedia` 声明与实际消费逐一核对修正；QQ 入站新增 canonical segments（image/audio/video/file/mention/face/reply），图片/语音/视频不再丢失。

迁移：适配器/插件产媒体一律用 `{ type, data: { media: MediaRef } }`；发送 legacy `data.url/file/base64` 形状的段会被 warn 丢弃。
