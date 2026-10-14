---
'@zhin.js/agent': patch
'@zhin.js/core': patch
---

Harness 组合修复：直接调用被策略移除的 bash 不再被自动加载进会话；standalone 子 loop 支持传入父 turn 策略以同样隐藏 bash；交互提示的回答（如审批回复 y）不再作为背景事件进入下一轮上下文。
