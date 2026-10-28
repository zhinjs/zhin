---
"@zhin.js/core": patch
"@zhin.js/adapter-icqq": patch
---

修复同一群先后两人入群时后一次入群被当重复事件丢掉：side event 去重键（core 与 icqq）加入成员与操作人。
