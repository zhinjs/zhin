---
"@zhin.js/workroom": patch
---

新增 Room 护栏组件：handoff 深度与 ping-pong 上限、每分钟 turn 上限、同 Room 串行与人类取消、敏感操作仅限配置的人类账号、每账号发送频率限制（装饰 `OutboundMessageService.send`，不绕过出站链）。当前未接入运行时，行为不变，由后续条目接线。
