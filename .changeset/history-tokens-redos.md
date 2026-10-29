---
"@zhin.js/agent": patch
---

修复 CodeQL js/polynomial-redos：`ai.context.historyTokens` 字符串解析先去掉空白、限制长度，再用无重叠量词的正则匹配。
