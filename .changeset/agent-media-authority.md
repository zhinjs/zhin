---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

AI 回复里引用的本地文件和 URL 媒体现在受本轮权限约束：`path` 必须通过与 `read_file` 相同的工作区与敏感路径检查，`url` 需要本轮出网权限并在每一跳都遵守 `allowedDomains`；不满足时以「附件不可用」占位。此前结构化回复可在禁止出网的回合里下载任意 https 地址，旧的 `<audio>` / `<video>` / `<file>` 写法还能把任意本地文件作为附件发出。`publishOutboundElements` 新增可选 `authority` 参数，IM 回合的回复入口已传入本轮权限。
