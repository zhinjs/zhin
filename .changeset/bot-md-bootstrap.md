---
"@zhin.js/agent": minor
"zhin.js": patch
"@zhin.js/cli": patch
"@zhin.js/scaffold-wizard": patch
"create-zhin-app": patch
---

机器人专用引导文件 `BOT.md`（#1250）：项目根目录（或 `data/`）有非空的 `BOT.md` 时，机器人只读 `BOT.md`（与 `SOUL.md`、`TOOLS.md`），不再读任何 `AGENTS.md`，`AGENTS.md` 留给开发者与编码代理；没有 `BOT.md` 时行为不变。新项目生成 `BOT.md`（机器人指令与记忆）和面向开发者的 `AGENTS.md`；`zhin setup --bootstrap` / `zhin doctor --fix` 在已有 `AGENTS.md` 且无 `BOT.md` 时继续用 `AGENTS.md`。修改 `BOT.md` 与修改根 `AGENTS.md` 一样需要审批。新增导出 `BOT_BOOTSTRAP_FILENAME`、`BOT_BOOTSTRAP_FILENAMES`、`botBootstrapFilenames()`、`hasBotBootstrapFile()`。

`BOT.md` 列入 `DEFAULT_SELF_FILES`：`self` 硬闸、未注入项目根时的按名匹配与隔离 shell 的只读挂载都覆盖它，与 `AGENTS.md` 相同。Agent 宿主从项目根目录或 `data/` 读取 `BOT.md`（与 `hasBotBootstrapFile()` 的判定位置一致）；此前只有 `data/BOT.md` 时 `AGENTS.md` 被停用而 `BOT.md` 也没被读取。修改根目录 `BOT.md` 与修改 `SOUL.md` / `AGENTS.md` 一样触发 Root 重建并重新读取；`data/` 不在监视范围内。
