---
"@zhin.js/adapter-sandbox": patch
"@zhin.js/cli": patch
"@zhin.js/permission": patch
"@zhin.js/adapter": patch
"@zhin.js/core": patch
"zhin.js": patch
---

fix(sandbox,cli,permission): 第二个 Sandbox 账号不再重复回复；migrate 先确认 CLI 是最新并清理旧版多写的内容；只有 Sandbox 时的 owner 提示（#1250 b116）

- adapter-sandbox：多个账号共用一个 HTTP Host 时，`/sandbox` 路径认领表按插件拿到的 HttpHost 对象去重，而 `context.use(httpHostToken)` 每次都返回一个新的 admission 绑定外壳，两个账号都挂到了 `/sandbox`，每条消息（含 `/restart`）被处理两次。认领表改以同一 Host 共享的 token registry 为键（放在 `globalThis`，热重载后仍是同一张表）。每个账号都挂自己的 `/sandbox/<id>`，第一个启动的账号另外挂 `/sandbox`；`ready` 帧新增 `endpoints`（`id`、`path`、`default`），Console 会话页有多个账号时显示账号选择，切换后连到所选账号的路径（记在本浏览器，账号不存在时回到 `/sandbox`）。
- cli：`zhin migrate` 在改动前比较正在运行的 CLI 与 registry 上最新的 `@zhin.js/cli`；落后时 `--dry-run` 只提示，正式执行停止并提示 `npx @zhin.js/cli@latest migrate` 或先 `pnpm add @zhin.js/cli@latest`，`--allow-outdated-cli` 可强制继续。migrate 还清理 1.9.x 多写的内容并在 dry-run 中列出：值与旧 CLI 写入完全一致的 `scripts.daemon`（改过的保留），以及 pnpm 发布冷却不生效的项目里 zhin 包的 `name@版本` `minimumReleaseAgeExclude` 条目（其他条目保留）。
- permission / core / zhin.js：只装了模拟适配器（按能力画像 `runtime.sandbox` 判断，新增 `isSimulationOnlyAdapterIndex`）时，`/restart`、`config` 与 `owner@global` 指令的拒绝提示改为引导在 Sandbox 打开「以我的聊天身份发言」再授予全局 owner，不再提「绑定 / 认领 <码>」（`describeGlobalOwnerRequired` / `PermitDenialOptions` 新增可选 `simulationOnly`）。
