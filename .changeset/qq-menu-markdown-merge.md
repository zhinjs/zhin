---
"@zhin.js/adapter-qq": patch
---

修复 QQ 官方机器人分页「菜单」只显示标题和翻页按钮、指令列表丢失的问题：一条 QQ 消息只能携带一个 markdown，按钮消息或含内联 markdown 的消息中，文本与内联 markdown 现按顺序合并为同一 markdown 段（模板 markdown 与纯文本消息不变）。图片与 markdown/按钮同时出现时（如菜单渲染成图片），公网 URL 图片按 `![图片 #宽px #高px](url)` 嵌入 markdown（尺寸读取图片文件头获得）；base64/本地图片（QQ 上传接口只返回 file_info，拿不到 URL）或尺寸未知时，降级为先发独立图片消息、再发 markdown 与按钮，避免 msg_type 冲突导致图片丢失。新增导出 `formatOutboundMessages`、`collectOutboundImageSizes`、`probeImageSize`、`imageSizeFromBytes`。
