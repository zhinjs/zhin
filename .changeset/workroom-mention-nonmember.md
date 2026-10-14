---
"@zhin.js/workroom": patch
---

Room Router 不再把只 @ 了非成员账号的消息交给 coordinator 或按 role 匹配：此时不产生目标（返回 undefined），成员副本保持原有的 mentioned 语义，退化为先到先得去重。
