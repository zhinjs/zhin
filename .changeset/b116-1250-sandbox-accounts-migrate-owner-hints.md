---
"@zhin.js/adapter-sandbox": patch
"@zhin.js/cli": patch
"@zhin.js/permission": patch
"@zhin.js/adapter": patch
"@zhin.js/core": patch
"zhin.js": patch
"@zhin.js/agent": patch
---

fix(sandbox,cli,permission): 第二个 Sandbox 账号不再重复回复，`/sandbox` 始终有账号接管；migrate 提示用最新 CLI 并清理旧版多写的内容；只有 Sandbox 时的 owner 提示（#1250 b116）

- adapter-sandbox：多个账号共用一个 HTTP Host 时，`/sandbox` 路径认领表按插件拿到的 HttpHost 对象去重，而 `context.use(httpHostToken)` 每次都返回一个新的 admission 绑定外壳，两个账号都挂到了 `/sandbox`，每条消息（含 `/restart`）被处理两次。认领表改以同一 Host 共享的 token registry 为键（放在 `globalThis`，热重载后仍是同一张表），按 owner（endpoint canonical id + 账号）区分：同一 owner 跨 generation 交接时共享路径，不同插件实例里的同名账号退到 `-2`、`-3`。每个账号都挂自己的 `/sandbox/<id>`；`/sandbox` 由最早启动、仍在运行的账号挂上，它停用、删除或改名时交给仍在运行的下一个账号（按启动顺序）补挂，只要 Host 上还有 Sandbox 账号，`/sandbox` 就能连上且只由一个账号处理。`ready` 帧新增 `endpoints`（`id`、`path`、`default`），Console 会话页有多个账号时显示账号选择（按路径区分），切换后连到所选账号的路径：选择按 Host（apiBase）记在本浏览器；断线不清除选择，连续 3 次在 `ready` 前断开后先连 `/sandbox` 看 `endpoints`，确认账号不在列表里才回到 `/sandbox`。页面只连 `/sandbox` 或 `/sandbox/<段>`，段内只允许 `[A-Za-z0-9._~-]` 与合法 `%XX`，拒绝 `.`、`..`、`%2e` 与反斜杠，构造的 URL 路径必须与原路径一致。
- cli：`zhin migrate` 在改动前比较正在运行的 CLI 与 registry 上最新的 `@zhin.js/cli`；落后时 `--dry-run` 和正式执行都只打印醒目的黄色提示，首选 `npx @zhin.js/cli@latest migrate`（或 `pnpm dlx`），并说明启用 `minimumReleaseAge` 时刚发布的版本可能装不上，然后继续执行（不中断，不影响锁定的精确版本、发布冷却和 CI）。migrate 还清理 1.9.x 多写的内容并在 dry-run 中列出：值与旧 CLI 写入完全一致的 `scripts.daemon`（改过的保留，删除时提示改用 `pnpm start` 或 `zhin start --mode production --no-watch`），以及 pnpm 发布冷却不生效的项目里 zhin 包的 `name@版本` `minimumReleaseAgeExclude` 条目（其他条目保留）。
- permission / core / agent / zhin.js：只装了模拟适配器（按能力画像 `runtime.sandbox` 判断，新增 `isSimulationOnlyAdapterIndex`，chat owner 认领的 `simulationOnly` 也改用它）时，`/restart`、`config`、`owner@global` 指令与按钮、`/approve` 的拒绝提示改为引导在 Sandbox 打开「以我的聊天身份发言」再授予全局 owner，不再提「绑定 / 认领 <码>」（`describeGlobalOwnerRequired` / `PermitDenialOptions` 新增可选 `simulationOnly`）。
