---
"@zhin.js/adapter-icqq": patch
---

New `set_group_admin` Agent tool in `icqq-group-admin`: set (`enabled: true`) or remove (`enabled: false`) a QQ group administrator. It is injected only when the bot is the current group's owner (not when it is merely an admin), requires `role(master,admin,trusted,owner)` plus per-call human approval, and re-checks live roles before calling `setGroupAdmin` (bot still owner; promote only regular members; demote only current admins). An unconfirmed platform result is reported as such and never retried automatically.
