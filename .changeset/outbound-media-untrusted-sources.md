---
"zhin.js": patch
"@zhin.js/core": patch
"@zhin.js/agent": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-wecom": patch
---

Agent 模型输出不能再借出站媒体段发送宿主文件（ADR 0056 §2）：

- 此前模型可以在回复里写 `{"kind":"file","value":"file:///etc/passwd"}`（或 `/etc/passwd`）这样的「平台文件引用」，Agent 发布层原样放行，OneBot / NapCat 会把它当作本地文件读取上传；模型以 `path` 引用工作区文件时也只做了工作区与敏感文件名检查，没有按发起人角色做 `read_file` 的读取判定（普通成员可发出 `.git/config`、`package.json`）。
- Core 新增不可信来源的出站媒体策略：`untrustedContent(content, trust)` 包装的内容在渲染器里（出站中间件与 Endpoint 之前，出站链仍唯一）只允许 http(s) 链接、有上限的内联数据（默认 25 MiB）与裸平台文件标识；本地路径（含 `file://`）只在 `trust.authorizePath` 认可或由可信代码 `trustedMediaRef()` 构造时放行；嵌套的本地来源拒绝，`html` 只保留文字，不做 `${…}` 模板替换。被拒的段替换为可见提示（「[图片未发送：媒体来源不被允许]」）并记录 `op=outbound_media_refused`。
- Agent 的回复、流式回复（`OpenReplyStreamOptions.mediaTrust`）、场景事件回复、主动发送与 QQ / ICQQ / Telegram / Discord / NapCat / 企业微信的 Agent 工具发送都按不可信来源投递；模型引用的本地路径按发起人文件角色（只有全局 `owner` 是 `owner`）做与 `read_file` 相同的判定，需要确认的敏感读取直接拒绝。插件代码自己构造的内容不受影响；工作区内工具生成的截图、图表与 Agent 落盘的大附件照常发送。
