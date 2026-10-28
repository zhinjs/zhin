---
"@zhin.js/im-contract": patch
"@zhin.js/core": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/cli": patch
---

Fix member-join welcome display: icqq now sends the mention's display name as the `at` element text, the joining member's nickname from the notice is threaded into `target.name`, and icqq group messages populate `conversation.name` from `group_name` so `{group}` renders the group name instead of the group number.
