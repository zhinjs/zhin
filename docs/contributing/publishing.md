---
title: npm 发布与可信发布
---

# npm 发布与可信发布

`.github/workflows/publish.yml` 用 changesets 发布全部非 private 包（`pnpm pub` → `changeset publish` → `pnpm publish` → npm CLI）。认证方式正在从长期 npm token 迁移到 [npm 可信发布](https://docs.npmjs.com/trusted-publishers)（OIDC）。

## 发版触发与失败恢复

日常 PR 使用 5 分钟目标的受影响范围检查。正式发版必须在 Actions → **Build and Publish** 手动启动：先调用 `full-validation.yml` 进行全量验收，成功后才消费 changeset、创建版本 PR。全量失败或取消时 main 不产生版本变更，修复后重跑即可。main 在验收中前进也会拒绝生成版本，需要重新验收。

版本 PR 合并后，发布任务会重新生成并逐字节比较完整版本树，核对对应源码的正式全量验收记录，再对最终版本进行构建、打包导入与已安装消费者验收。不能用同名分支、提交标题或任意绿色 PR 代替发布证据。nightly 只验证，不发布。

如果 npm 上传已开始且只有部分包成功，不自动回退版本或恢复已经消费的 changeset。保持该源码与版本，手动重跑续发未完成的包；源码有新变化时拒绝继续复用旧版本。详细流程见[开发流程](./development.md#显式发版批次)。

## 工作方式

发布步骤对每个包按下面的顺序认证，由 npm CLI 自己完成，不需要脚本判断：

1. **可信发布（OIDC）**：job 有 `id-token: write`，npm CLI 用 GitHub 签发的短期 OIDC token 向 npmjs.com 换取只对该包有效的发布凭据。只要这个包在 npmjs.com 配置了匹配的可信发布者，就走这条路。
2. **token 回退**：包还没有可信发布者（或配置已过期、OIDC 换取临时失败）时，换取失败，npm 继续使用 `NODE_AUTH_TOKEN`。它**只取** `secrets.NPM_TOKEN`（npm 的 Granular Access Token，需对 `@zhin.js` 作用域有发布权限）；没有配置时为空，该包发布失败。不会拿 `PERSONAL_TOKEN`：那是 GitHub 的 token，npmjs.com 会拒绝（401 / 404），只会让每个包白白等待后失败。`changesets/action` 会把 `NPM_TOKEN` 写进 npmjs 的 `.npmrc`，所以发布步骤里 `NPM_TOKEN` 和 `NODE_AUTH_TOKEN` 都只取这个 secret。

所有发布都带 [provenance](https://docs.npmjs.com/generating-provenance-statements)：OIDC 发布由 npm 自动生成；token 发布由 `NPM_CONFIG_PROVENANCE=true` 打开。provenance 要求 `package.json` 的 `repository.url` 指向 `github.com/zhinjs/zhin`，由 `pnpm check:publish-repository` 门禁保证。

工作流的要求：

| 要求 | 本仓库 |
| --- | --- |
| npm CLI ≥ 11.5.1、Node ≥ 22.14.0 | Node 24；`ensure npm CLI supports trusted publishing` 步骤在 npm 过旧时升级 |
| `permissions: id-token: write` | publish job 已授予 |
| GitHub 托管 runner | `ubuntu-latest` |
| 工作流文件名与 npmjs.com 配置一致 | `publish.yml` |
| environment 与 npmjs.com 配置一致（若填写） | `npm-production` |

### 关闭 token 回退

确认全部包都配置好可信发布者、并且至少一次真实发版走通 OIDC 后，在仓库 **Settings → Secrets and variables → Actions → Variables** 新建变量 `NPM_TRUSTED_PUBLISHING_ONLY = true`。之后发布步骤不再拿到任何 npm token，未配置可信发布者的包会直接发布失败。删除这个变量即可恢复回退。

不要删除 `PERSONAL_TOKEN`：它用于安装 GitHub Packages 上的 `@icqqjs/*` 依赖，与 npm 发布认证无关。

## 新包首次发布

npm 目前**不能**用 OIDC 发布一个从未发布过的包：可信发布者只能在已存在的包的设置页上配置（[npm/cli#8544](https://github.com/npm/cli/issues/8544)）。所以新包仍需一次手动首次发布，`pnpm check:unpublished` 门禁会在 CI 里拦下并列出这些包。最小步骤：

```bash
pnpm build
(cd path/to/pkg && pnpm publish --access public --no-git-checks)   # 维护者本机，npm login + 2FA
npm trust github <包名> --repo zhinjs/zhin --file publish.yml --env npm-production --allow-publish --yes
```

这里必须用 `pnpm publish`：它会把 `workspace:` 协议换成真实版本，并用 `publishConfig.exports` 替换 `exports`（去掉指向 `src/` 的 `development` 条件）；`npm publish` 两样都不做。

然后重跑 **Build and Publish**。`npm trust` 需要 npm ≥ 11.15.0 且账号开启 2FA，也可以改在网页上配置（见下文）。

## 打包产物导入检查

工作区测试直接导入 `src/`，所以「打包后的入口引用了没被编译出来的模块」这类问题只有在发布包里才会暴露（例如 `@zhin.js/plugin-group-suite@1.1.8` 缺少 `lib/keywords.js`）。`pnpm check:pack-imports` 会在 `pnpm build` 之后对每个可发布包：

- 按 prepack 生成 Plugin Runtime JS 入口，用 `npm pack --dry-run --json --ignore-scripts` 列出 tarball 文件，检查结束后清理生成的入口；
- 检查打包 `.js/.mjs/.cjs` 中所有相对 `import`/`export`/`import()`/`require()` 都能解析到 tarball 内的文件，且不越出包根；
- 检查 `main`、`bin`、`exports`（`development` 条件除外）指向的文件都在 tarball 里。

同一次扫描还会按下文的[发布包目录规范](#发布包目录规范)检查 tarball 布局。

只有打包器才能解析的无扩展名导入（如浏览器端的 `./types`）只报警告，加 `--strict` 才算失败。CI 和发布工作流都在构建后运行这项检查，可用 `--filter <包名>` 只检查单个包。

## 发布包目录规范

npm 包里只放运行时、类型和使用者需要读的文件。目标布局：

| 内容 | 位置 | 说明 |
| --- | --- | --- |
| 库代码 | `lib/**/*.js` + `lib/**/*.d.ts` | 由 `src/**/*.ts` 经 `tsc` 产出；`main`、`types`、`exports` 都指向 `lib/` |
| Plugin Runtime 入口 | 包根 `plugin.js` | `package.json#zhin.entry` 指向它；prepack 由 `scripts/build-plugin-runtime-entries.mjs` 生成 |
| 约定目录 | 包根 `commands/`、`middlewares/`、`handlers/`、`schedules/`、`tools/`、`hooks/`、`mcps/`、`adapters/`、`prompt-sections/`、`pages/` 下的 `index.js` | 运行时从包根扫描这些目录，所以不能挪进 `lib/` |
| 资源 | `schema.json`、`skills/`、`agents/` 里的 Markdown、`README.md`、`CHANGELOG.md` | |
| source map（可选） | 与产物同目录的 `*.js.map` / `*.d.ts.map` | 要么同时发布它指向的源文件，要么用 `inlineSources` 把源码写进 `sourcesContent`，要么不生成 |

不发布：测试（`tests/`、`__tests__/`、`*.test.*`、`*.spec.*`）、`tsconfig*.json`、`vitest`/`vite` 配置、`*.tsbuildinfo`。发布后的 `exports` 不再有 `development` 条件，`node_modules` 里的插件运行时也优先加载 `.js`，所以 `src/*.ts` 和约定目录里的 `.ts` 对使用者没有作用，新包不要发布它们（已有包是否移除见 [#857](https://github.com/zhinjs/zhin/issues/857)，移除会改变已发布路径）。

`files` 白名单示例（插件包）：

```json
{
  "files": ["lib", "plugin.js", "schema.json", "commands", "middlewares", "skills", "README.md", "CHANGELOG.md"]
}
```

如果必须整目录发布 `src`，用取反排除测试：`"src", "!src/**/*.test.ts"`。

`pnpm check:pack-imports` 对每个 tarball 的布局检查：

| 规则 | 级别 |
| --- | --- |
| `zhin.entry` 是 `.js/.mjs/.cjs` 且在 tarball 里 | 错误 |
| tarball 里没有测试文件 | 错误 |
| tarball 里没有构建配置 | 警告 |
| source map 指向的源文件已发布或已内联 | 警告 |
| 发布的 `.ts` 源文件有 source map 引用 | 警告 |

警告不阻塞 CI，加 `--strict` 时算失败。

## 在 npmjs.com 配置可信发布者

每个包在 **npmjs.com → Packages → 包名 → Settings → Trusted publishing** 里选 **GitHub Actions**，填写：

| 字段 | 值 |
| --- | --- |
| Organization or user | `zhinjs` |
| Repository | `zhin` |
| Workflow filename | `publish.yml`（只填文件名） |
| Environment name | `npm-production` |
| Allowed actions | 勾选 **npm publish**（2026-09-03 之后新建的配置默认只允许 `npm stage publish`，不勾选会发布失败） |

注意事项：

- **2 天内必须发布一次**：新建的可信发布者配置要在 2 天内完成首次成功发布，否则过期，只能删除重建。过期期间 CI 会自动回退到 token，不会中断发版。建议在合并 changesets 的 version PR 前，只为这次要发布的包配置。
- 每个包只能有一个 `npm trust` 配置；已有配置不能修改，只能 `npm trust revoke` 后重建。
- 字段大小写敏感，npm 保存时不会校验，写错只会在发布时报 `ENEEDAUTH` / 404。
- 全部配置好并关闭回退后，可以在包的 **Settings → Publishing access** 选 “Require two-factor authentication and disallow tokens”，再吊销不用的发布 token。

批量配置（npm ≥ 11.15.0；第一次请求要 2FA，可在网页上勾选 5 分钟内免 2FA）。把这次 version PR 要发布的包名写进 `names.txt`，每行一个：

```bash
while read -r name; do
  npm trust github "$name" --repo zhinjs/zhin --file publish.yml --env npm-production --allow-publish --yes
  sleep 2
done < names.txt
```

列出全部可发布包名：`pnpm -r ls --json --depth -1 | node -e 'for (const p of JSON.parse(require("fs").readFileSync(0, "utf8"))) if (!p.private) console.log(p.name)'`。

用 `npm trust list <包名>` 检查某个包的配置。

## 包清单

以下 101 个非 private 包都需要配置可信发布者（由各 `package.json` 生成；新增包后同步更新本清单）。

### `basic/`（5）

- [ ] `@zhin.js/cli` — `basic/cli`
- [ ] `@zhin.js/database` — `basic/database`
- [ ] `@zhin.js/logger` — `basic/logger`
- [ ] `@zhin.js/schedule` — `basic/schedule`
- [ ] `@zhin.js/schema` — `basic/schema`

### `packages/console/`（7）

- [ ] `@zhin.js/client` — `packages/console/client`
- [ ] `@zhin.js/contract` — `packages/console/contract`
- [ ] `@zhin.js/layout` — `packages/console/layout`
- [ ] `@zhin.js/page` — `packages/console/page`
- [ ] `@zhin.js/pagemanager` — `packages/console/pagemanager`
- [ ] `@zhin.js/console-contract` — `packages/console/plugin-contract`
- [ ] `@zhin.js/console-protocol` — `packages/console/protocol`

### `packages/game-kit`（1）

- [ ] `@zhin.js/game-kit` — `packages/game-kit`

### `packages/host/`（4）

- [ ] `@zhin.js/a2a` — `packages/host/a2a`
- [ ] `@zhin.js/host-http` — `packages/host/http`
- [ ] `@zhin.js/host-http-contract` — `packages/host/http-contract`
- [ ] `@zhin.js/mcp` — `packages/host/mcp`

### `packages/im/`（25）

- [ ] `@zhin.js/adapter` — `packages/im/adapter`
- [ ] `@zhin.js/agent` — `packages/im/agent`
- [ ] `@zhin.js/agent-feature` — `packages/im/agent-feature`
- [ ] `@zhin.js/ai` — `packages/im/ai`
- [ ] `@zhin.js/command` — `packages/im/command`
- [ ] `@zhin.js/component` — `packages/im/component`
- [ ] `@zhin.js/config-file` — `packages/im/config-file`
- [ ] `@zhin.js/core` — `packages/im/core`
- [ ] `@zhin.js/feature-kit` — `packages/im/feature-kit`
- [ ] `@zhin.js/handler` — `packages/im/handler`
- [ ] `@zhin.js/im-contract` — `packages/im/im-contract`
- [ ] `@zhin.js/interaction` — `packages/im/interaction`
- [ ] `@zhin.js/isolate` — `packages/im/isolate`
- [ ] `@zhin.js/jsx` — `packages/im/jsx`
- [ ] `@zhin.js/kernel` — `packages/im/kernel`
- [ ] `@zhin.js/mcp-feature` — `packages/im/mcp-feature`
- [ ] `@zhin.js/middleware` — `packages/im/middleware`
- [ ] `@zhin.js/permission` — `packages/im/permission`
- [ ] `@zhin.js/plugin-runtime` — `packages/im/plugin-runtime`
- [ ] `@zhin.js/prompt-section` — `packages/im/prompt-section`
- [ ] `@zhin.js/runtime` — `packages/im/runtime`
- [ ] `@zhin.js/schedule-feature` — `packages/im/schedule-feature`
- [ ] `@zhin.js/skill` — `packages/im/skill`
- [ ] `@zhin.js/tool` — `packages/im/tool`
- [ ] `zhin.js` — `packages/im/zhin`

### `packages/toolkit/`（7）

- [ ] `@zhin.js/components` — `packages/toolkit/components`
- [ ] `create-zhin-app` — `packages/toolkit/create-zhin`
- [ ] `@zhin.js/html-renderer` — `packages/toolkit/html-renderer`
- [ ] `@zhin.js/testing` — `packages/toolkit/testing`
- [ ] `@zhin.js/scaffold-wizard` — `packages/toolkit/scaffold-wizard`
- [ ] `@zhin.js/speech` — `packages/toolkit/speech`
- [ ] `@zhin.js/tailwind` — `packages/toolkit/tailwind`

### `plugins/adapters/`（20）

- [ ] `@zhin.js/adapter-dingtalk` — `plugins/adapters/dingtalk`
- [ ] `@zhin.js/adapter-discord` — `plugins/adapters/discord`
- [ ] `@zhin.js/adapter-email` — `plugins/adapters/email`
- [ ] `@zhin.js/adapter-github` — `plugins/adapters/github`
- [ ] `@zhin.js/adapter-icqq` — `plugins/adapters/icqq`
- [ ] `@zhin.js/adapter-kook` — `plugins/adapters/kook`
- [ ] `@zhin.js/adapter-lark` — `plugins/adapters/lark`
- [ ] `@zhin.js/adapter-line` — `plugins/adapters/line`
- [ ] `@zhin.js/adapter-milky` — `plugins/adapters/milky`
- [ ] `@zhin.js/adapter-napcat` — `plugins/adapters/napcat`
- [ ] `@zhin.js/adapter-onebot11` — `plugins/adapters/onebot11`
- [ ] `@zhin.js/adapter-onebot12` — `plugins/adapters/onebot12`
- [ ] `@zhin.js/adapter-qq` — `plugins/adapters/qq`
- [ ] `@zhin.js/adapter-sandbox` — `plugins/adapters/sandbox`
- [ ] `@zhin.js/adapter-satori` — `plugins/adapters/satori`
- [ ] `@zhin.js/adapter-slack` — `plugins/adapters/slack`
- [ ] `@zhin.js/adapter-telegram` — `plugins/adapters/telegram`
- [ ] `@zhin.js/adapter-wechat-mp` — `plugins/adapters/wechat-mp`
- [ ] `@zhin.js/adapter-wecom` — `plugins/adapters/wecom`
- [ ] `@zhin.js/adapter-weixin-ilink` — `plugins/adapters/weixin-ilink`

### `plugins/features/`（1）

- [ ] `@zhin.js/process-monitor` — `plugins/features/process-monitor`

### `plugins/games/`（11）

- [ ] `@zhin.js/plugin-blackjack` — `plugins/games/blackjack`
- [ ] `@zhin.js/plugin-dice-duel` — `plugins/games/dice-duel`
- [ ] `@zhin.js/plugin-dungeon-expedition` — `plugins/games/dungeon-expedition`
- [ ] `@zhin.js/plugin-guess-number` — `plugins/games/guess-number`
- [ ] `@zhin.js/plugin-game-hub` — `plugins/games/hub`
- [ ] `@zhin.js/plugin-idiom-chain` — `plugins/games/idiom-chain`
- [ ] `@zhin.js/plugin-roulette` — `plugins/games/roulette`
- [ ] `@zhin.js/plugin-rps` — `plugins/games/rps`
- [ ] `@zhin.js/plugin-text-adventure` — `plugins/games/text-adventure`
- [ ] `@zhin.js/plugin-tic-tac-toe` — `plugins/games/tic-tac-toe`
- [ ] `@zhin.js/plugin-word-riddle` — `plugins/games/word-riddle`

### `plugins/services/`（2）

- [ ] `@zhin.js/service-activity-feedback` — `plugins/services/activity-feedback`
- [ ] `@zhin.js/service-typesafe` — `plugins/services/typesafe`

### `plugins/utils/`（18）

- [ ] `@zhin.js/plugin-60s` — `plugins/utils/60s`
- [ ] `@zhin.js/plugin-answers` — `plugins/utils/answers`
- [ ] `@zhin.js/plugin-bilibili` — `plugins/utils/bilibili`
- [ ] `@zhin.js/plugin-calendar` — `plugins/utils/calendar`
- [ ] `@zhin.js/plugin-code-runner` — `plugins/utils/code-runner`
- [ ] `@zhin.js/plugin-content-moderation` — `plugins/utils/content-moderation`
- [ ] `@zhin.js/plugin-earthquake` — `plugins/utils/earthquake`
- [ ] `@zhin.js/plugin-group-suite` — `plugins/utils/group-suite`
- [ ] `@zhin.js/plugin-ledger` — `plugins/utils/ledger`
- [ ] `@zhin.js/plugin-link-poster` — `plugins/utils/link-poster`
- [ ] `@zhin.js/plugin-lottery` — `plugins/utils/lottery`
- [ ] `@zhin.js/plugin-music` — `plugins/utils/music`
- [ ] `@zhin.js/plugin-nettools` — `plugins/utils/nettools`
- [ ] `@zhin.js/plugin-qrcode` — `plugins/utils/qrcode`
- [ ] `@zhin.js/plugin-reminder` — `plugins/utils/reminder`
- [ ] `@zhin.js/plugin-repeater` — `plugins/utils/repeater`
- [ ] `@zhin.js/plugin-rss` — `plugins/utils/rss`
- [ ] `@zhin.js/plugin-short-url` — `plugins/utils/short-url`
