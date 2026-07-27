---
"@zhin.js/adapter-qq": patch
---

QQ 出站富媒体移植（自 legacy）：`image` 段支持 http(s) URL 直发与 base64/本地路径经 SDK `/files` 上传；`markdown` 段（原文与 custom_template_id+params 模板）；`keyboard` 段（按钮矩阵 callback/command，自动合并为 markdown+keyboard 载荷）；`at`/`reply` 段透传。文本行为不变，不可映射段降级文本并 warn。
