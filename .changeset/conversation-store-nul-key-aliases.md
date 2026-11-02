---
"@zhin.js/im-contract": patch
---

修复 Node 22 内置 `node:sqlite` 读回 TEXT 时在首个 NUL 处截断，导致旧版（未编码）message_key 别名在索引投影中丢失、撤回前最高 revision 选错的问题；无法从返回行映射回别名时改为按 key 逐个读取并按查询归属。
