---
"@zhin.js/cli": patch
"@zhin.js/plugin-runtime": patch
---

`zhin runtime` 子命令写明计划与作用范围，`zhin search` / `zhin info` 不再推荐无关包与弃用命令（#1250 第 36 批）。

- `runtime-publish-silent-noop`：`zhin runtime publish`（dry-run）与 `zhin runtime build` 先打印计划：会处理哪些包、版本、目标 dist-tag（`--execute` 时还有临时 dist-tag），以及跳过了哪些 workspace 包和原因（`private: true` / 没有 `build` 脚本）。计划为空时明确说明（「没有可发布的包：N 个 workspace 包都是 private」）。新增 `--json`：只输出计划（含 `empty`、`packages`、`skipped`），不运行任何 pnpm 命令，不能与 `--execute` / `--resume` 同用。退出码：dry-run（含 `--json`）计划为空时为 0，这是正确的检查结果；`--execute` / `--resume` 计划为空时为 1（要求发布却没有任何包发出），且不再写入空的发布日志。
- `runtime-subcommands-undocumented`：`inspect`、`migrate`、`build`、`publish` 补充描述并写明作用范围（整个 workspace；单个插件用 `zhin build` / `zhin pub`），`--execute` / `--resume` 的帮助写清会发哪些包、需要 npm 登录、发布日志位置与恢复方式；`zhin build` / `zhin pub` 的帮助反过来指向 `zhin runtime build` / `publish`。
- `runtime-inspect-raw-json-only`：`zhin runtime inspect` 默认输出实例表（实例、包、来源、启用状态、features 数），`disable_plugins` 中的实例也列出并标「已停用」；`--json` 输出原来的完整结构，并增加 `disabled` 列表。
- `verification-plan-empty-unexplained`：`zhin packages verification-plan` 默认输出可读文本：离线时说明 generation 为空、不列检查是因为没有连接运行中的实例（加 `--live`）；在线且没有检查时说明插件没有声明业务检查（在 `definePlugin` 的 `setup` 中返回 `verification`），并非查询失败；有检查时列出作用范围、副作用和对应的 `zhin packages verify` 命令。`--json` 输出原始结构。
- `cli-search-generic-plugin-keyword`：生态关键词去掉通用的 `plugin`（新增 `zhin-package`），`@maptiler/weather` 这类无关包不再出现在 `zhin search` 结果里；带关键词搜索时额外查询 `@zhin.js` scope，官方包仍按包名识别。`--official` 只保留 `@zhin.js/*`。
- `cli-search-author-unknown`：`packageAuthorName`（`@zhin.js/plugin-runtime`）与 CLI 的 `packagePersonName` 同时识别 `username`，npm 搜索结果的作者不再显示「未知」。
- `cli-search-suggests-deprecated-commands`：`zhin search` / `zhin info` 的安装与详情提示改为 `zhin install <包>` / `zhin info <包>`；`zhin plugin install` 的纠错提示与 `search` / `info` 的命令描述不再提及弃用的 `zhin packages install|info|search`。
- `chat-roles-export-summary-omits-identities`：`zhin chat-roles export` 的成功行与导入口径一致，报告人、聊天身份、角色授予和 Console 链接四类数量。
- `cli-info-local-workspace-plugin`：`zhin info` 先查本项目 workspace 包（含项目根包）与已安装的包，本地读取 `package.json`、约定目录与 `schema.json`，以与 npm 包相同的格式显示命令、Agent 工具和配置项，并标明来源；都没有时再查 npm。npm 查询失败不再打印原始的 `Command failed: npm view …`：区分「npm 上没有这个包」与「无法查询 npm registry」，退出码 1，提示改为 `zhin search`。
