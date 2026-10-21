---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

子 agent 结果投递与主动出站（`sendElements`）也不再读取或下载模型在文本中引用的本地路径和 URL（新增 `NO_MEDIA_AUTHORITY`）；工具生成的图片 / 语音是内联 base64，不受影响。补齐 #892 只覆盖 IM 回合回复入口的缺口。
