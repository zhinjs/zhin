---
"@zhin.js/command": patch
"@zhin.js/core": patch
"@zhin.js/runtime": patch
"@zhin.js/agent": patch
---

未命中的消息首词与已注册指令名 / 别名高度相似时（私聊、@机器人或带指令前缀；忽略大小写与 `-` / `_` / 空格，默认 1 次编辑且名称至少 5 个字符或 3 个汉字），经正常回复链直接回复「没有这个指令，你是不是想用：X、Y」，不再交给 AI 编造指令名（#1250）。只列出发送者有权使用的指令；根配置 `commandSuggestion: false` 关闭，`{ maxDistance, limit }` 调整。Agent 提示在有指令菜单时引导模型不确定就让用户发送菜单，而不是猜指令名。
