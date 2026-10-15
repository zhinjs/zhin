---
title: npm 发布与可信发布
---

# npm 发布与可信发布

`.github/workflows/publish.yml` 用 changesets 发布全部非 private 包（`pnpm pub` → `changeset publish` → `pnpm publish` → npm CLI）。认证方式正在从长期 npm token 迁移到 [npm 可信发布](https://docs.npmjs.com/trusted-publishers)（OIDC）。

## 工作方式

发布步骤对每个包按下面的顺序认证，由 npm CLI 自己完成，不需要脚本判断：

1. **可信发布（OIDC）**：job 有 `id-token: write`，npm CLI 用 GitHub 签发的短期 OIDC token 向 npmjs.com 换取只对该包有效的发布凭据。只要这个包在 npmjs.com 配置了匹配的可信发布者，就走这条路。
2. **token 回退**：包还没有可信发布者（或配置已过期）时，换取失败，npm 继续使用 `NODE_AUTH_TOKEN`。它取 `secrets.NPM_TOKEN`，没有则取 `secrets.PERSONAL_TOKEN`。

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

在此之前不要删除 `PERSONAL_TOKEN`：它同时用于安装 GitHub Packages 上的 `@icqqjs/*` 依赖。

## 新包首次发布

npm 目前**不能**用 OIDC 发布一个从未发布过的包：可信发布者只能在已存在的包的设置页上配置（[npm/cli#8544](https://github.com/npm/cli/issues/8544)）。所以新包仍需一次手动首次发布，`pnpm check:unpublished` 门禁会在 CI 里拦下并列出这些包。最小步骤：

```bash
pnpm build
(cd path/to/pkg && npm publish --access public)   # 维护者本机，npm login + 2FA
npm trust github <包名> --repo zhinjs/zhin --file publish.yml --env npm-production --allow-publish --yes
```

然后重跑 **Build and Publish**。`npm trust` 需要 npm ≥ 11.15.0 且账号开启 2FA，也可以改在网页上配置（见下文）。

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

以下 95 个非 private 包都需要配置可信发布者（由各 `package.json` 生成；新增包后同步更新本清单）。

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
- [ ] `@zhin.js/plugin-test-kit` — `packages/toolkit/plugin-test-kit`
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

### `plugins/games/`（10）

- [ ] `@zhin.js/plugin-blackjack` — `plugins/games/blackjack`
- [ ] `@zhin.js/plugin-dice-duel` — `plugins/games/dice-duel`
- [ ] `@zhin.js/plugin-dungeon-expedition` — `plugins/games/dungeon-expedition`
- [ ] `@zhin.js/plugin-guess-number` — `plugins/games/guess-number`
- [ ] `@zhin.js/plugin-game-hub` — `plugins/games/hub`
- [ ] `@zhin.js/plugin-idiom-chain` — `plugins/games/idiom-chain`
- [ ] `@zhin.js/plugin-rps` — `plugins/games/rps`
- [ ] `@zhin.js/plugin-text-adventure` — `plugins/games/text-adventure`
- [ ] `@zhin.js/plugin-tic-tac-toe` — `plugins/games/tic-tac-toe`
- [ ] `@zhin.js/plugin-word-riddle` — `plugins/games/word-riddle`

### `plugins/services/`（2）

- [ ] `@zhin.js/service-activity-feedback` — `plugins/services/activity-feedback`
- [ ] `@zhin.js/service-typesafe` — `plugins/services/typesafe`

### `plugins/utils/`（13）

- [ ] `@zhin.js/plugin-60s` — `plugins/utils/60s`
- [ ] `@zhin.js/plugin-calendar` — `plugins/utils/calendar`
- [ ] `@zhin.js/plugin-code-runner` — `plugins/utils/code-runner`
- [ ] `@zhin.js/plugin-content-moderation` — `plugins/utils/content-moderation`
- [ ] `@zhin.js/plugin-group-suite` — `plugins/utils/group-suite`
- [ ] `@zhin.js/plugin-link-poster` — `plugins/utils/link-poster`
- [ ] `@zhin.js/plugin-lottery` — `plugins/utils/lottery`
- [ ] `@zhin.js/plugin-music` — `plugins/utils/music`
- [ ] `@zhin.js/plugin-qrcode` — `plugins/utils/qrcode`
- [ ] `@zhin.js/plugin-reminder` — `plugins/utils/reminder`
- [ ] `@zhin.js/plugin-repeater` — `plugins/utils/repeater`
- [ ] `@zhin.js/plugin-rss` — `plugins/utils/rss`
- [ ] `@zhin.js/plugin-short-url` — `plugins/utils/short-url`
