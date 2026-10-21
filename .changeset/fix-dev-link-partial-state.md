---
"@zhin.js/cli": patch
---

`zhin dev link` 先打包到临时目录再写入备份与状态，首次 link 失败时回滚且不留下缺少 `state.json` 的 `.zhin-local/`；`zhin dev unlink` 能安全清理只有 backup 没有 state.json 的残留目录。
