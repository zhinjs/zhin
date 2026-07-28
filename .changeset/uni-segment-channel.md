---
"@zhin.js/core": minor
"@zhin.js/adapter": minor
"@zhin.js/adapter-icqq": minor
"@zhin.js/adapter-milky": minor
"@zhin.js/adapter-telegram": minor
"@zhin.js/adapter-discord": minor
"@zhin.js/adapter-napcat": minor
"@zhin.js/adapter-onebot11": minor
"@zhin.js/adapter-onebot12": minor
"@zhin.js/adapter-wechat-mp": minor
"@zhin.js/adapter-wecom": minor
"@zhin.js/adapter-lark": minor
"@zhin.js/cli": patch
---

统一消息元素通道（UNI-Channel）落地：

- **入站契约**：`IncomingMessage.segments`（canonical Segment[]，与 content 纯文本视图同源双轨），Message 透传；AI 兜底链路经 `collectSegmentMedia` 把图片/语音/视频/文件 MediaRef 写入会话 extra——多模态输入不再丢失。
- **出站协商**：`normalizeOutboundPayload` 升级全量 canonical 归一（复用 generic-segment-mapper），html→image 按端点 `segments.outboundMedia` 声明降级（base64 直发 / url-or-text / passthrough 自行物化）；`MediaRef.kind` 新增 `'file'` 承载平台不透明引用（file_id/resource_id）。
- **能力声明**：`defineAdapter.segments` policy（outboundMedia / interactive），三道段门禁复活（探测点改 adapters/*.ts，豁免名单渐进收敛）。
- **首批迁移**：icqq 全保真出入站（CQ ↔ canonical，quote→reply 段）；milky/telegram/discord 入站媒体段恢复（附件/贴纸/callback action）；napcat/onebot11/onebot12 出站 canonical→OneBot 数组段；wechat-mp/wecom `/cgi-bin/media/upload` 与 lark `/im/v1/images` 上传通路（base64/URL 图片不再静默丢图，失败降级文本）。
