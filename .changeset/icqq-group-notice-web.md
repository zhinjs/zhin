---
"@zhin.js/adapter-icqq": patch
---

修复 icqq 群公告"发送成功但群里看不到"：icqq `sendGroupNotice` 走 OIDB 0x89a_0 旧字段，QQ 回成功却不展示。改走群公告网页接口（qun.qq.com cookie + bkn），接口未确认时报失败而不是假成功；公告流程与 `announce` 工具都受影响。
