---
"@zhin.js/adapter-kook": patch
---

canonical reply 映射原生 quote。图片经原生二进制 multipart 上传，图文混排用卡片保持顺序，修复仅显示 [image] 或丢失文本；上传失败不发文字替代，缺真实消息 ID 不确认成功，日志错误不携带原始平台响应。

撤回使用完整会话路由调用真实频道/私聊删除接口，修复不存在 recallMsg 方法被 optional no-op 当作成功的问题；false 回执和缺失方法明确失败。
