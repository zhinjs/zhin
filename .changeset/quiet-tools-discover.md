---
"@zhin.js/agent": patch
---

去除 discover 工具结果正文中重复的完整参数 schema，减少后续模型请求携带的重复历史。保留匹配工具的自动加载、权限、加载上限与稳定顺序，完整定义仍通过下一次请求的 tools 字段提供，无需增加 load_tool 调用。
