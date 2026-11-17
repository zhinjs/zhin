---
"@zhin.js/adapter-ipad-wechat": patch
---

ipad-wechat 声明入站媒体目录 `<dataDir>/media/inbound`（#1250 第 44 批）：开启 `downloadImages` 时下载的入站图片仍能被 Agent 读取；目录外的本机路径照旧不读。
