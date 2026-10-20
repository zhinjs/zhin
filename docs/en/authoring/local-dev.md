# Local Development Guide for Plugin Authors

This page is for authors developing local plugins (or zhin source) together with **their own bot project**. It covers the three most common problems: mixed dependency sources, local vs. published version mismatch, and ports / unclean exit. It reflects the current `main` implementation.

## 1. Dependency sources: don't mix `link:` / `workspace:` with npm

Within one generation Zhin requires **exactly one physical location per package**. While the project graph (`packages/im/runtime/src/project-graph.ts`) walks root plugins, child plugins and their declared features (such as `@zhin.js/command`, `@zhin.js/tool`), it:

1. resolves each dependency starting from **the declaring plugin's own directory**;
2. `realpath`s the package root;
3. throws if the same package name has two different roots:

```text
zhin: Multiple package locations for @zhin.js/command are not supported in one generation
```

Even if both copies have the same version (e.g. `1.1.5`), different locations mean two module instances: tokens, brand markers and `instanceof` don't interoperate. This is an **intentional hard error**, not a false positive.

### Typical trigger

Most dependencies come from npm, but one plugin is `link:`ed to another zhin source checkout:

```json
{
  "dependencies": {
    "zhin.js": "latest",
    "@zhin.js/plugin-calendar": "link:../zhin/plugins/utils/calendar"
  }
}
```

In the source repo the linked plugin declares `@zhin.js/command` as `workspace:*` / `workspace:^`, so it resolves to the **source repo's** `packages/im/command`, while other plugins resolve to the npm copy in your project's `node_modules/.pnpm`.

### Diagnosis

```bash
# 1. Who depends on it, and are there multiple versions/variants?
pnpm why @zhin.js/command

# 2. Where does the linked plugin actually resolve it? (repeat per plugin)
readlink -f node_modules/@zhin.js/plugin-calendar/node_modules/@zhin.js/command
readlink -f node_modules/.pnpm/node_modules/@zhin.js/command

# 3. List all link / file / workspace dependencies
grep -nE '"(link|file|workspace):' package.json plugins/*/package.json
```

If the two paths in step 2 differ (one in another repo's `packages/im/command`, one in `.pnpm/@zhin.js+command@x.y.z`), this is your problem. Stale version directories left in `node_modules/.pnpm` are harmless; only the actual resolved path matters.

## 2. Local source vs. published zhin.js mismatch

Even without duplicate copies, a local plugin may depend on **unreleased** zhin.js features. Common symptoms:

- `TypeError: Schema....effect is not a function` when loading the plugin (local Schema API is newer than npm);
- `Invalid Plugin config ... must NOT have additional properties (additionalProperty: xxx)` at startup: the plugin's config schema didn't take effect as written locally, or the npm plugin of the same name is an older version without those fields.

Compare the plugin's `peerDependencies` with what's installed and check that the APIs you use are released:

```bash
node -p "require('./node_modules/zhin.js/package.json').version"
npm view zhin.js version
npm view <plugin-package> version peerDependencies
```

## 3. Recommended: develop plugins inside the zhin repo

When you need **unreleased** framework features or change framework and plugin together, the easiest path is to develop directly in the zhin monorepo: put the plugin in `plugins/<category>/<name>`, the test bot in `examples/<name>`, and use `workspace:*` for every zhin dependency. The whole workspace has a single resolution path, so the duplicate-copy error from section 1 cannot happen and there is no overrides list to maintain.

```bash
git clone https://github.com/zhinjs/zhin.git && cd zhin
pnpm install
# New plugin: plugins/utils/my-plugin (zhin.js and @zhin.js/* as "workspace:*")
# Test bot: copy examples/minimal-bot to examples/my-bot, add
#   "@zhin.js/plugin-my-plugin": "workspace:*"
# and declare it in the plugins map in zhin.config.yml
pnpm install
pnpm build
cd examples/my-bot && pnpm exec zhin runtime start --once
```

Verified on current `main`: `@zhin.js/command` in both `examples/test-bot` and `plugins/utils/calendar` resolves to the same `packages/im/command`; after `pnpm build`, `zhin runtime start --once` in `examples/minimal-bot` prints `"started": true`.

Other options compared:

- **`pnpm link` / `link:` a single plugin**: not recommended. The linked plugin's `workspace:` dependencies resolve into the source repo, which is exactly the cause of section 1.
- **yalc**: essentially the same as a tarball (copies build output); can't use unreleased framework APIs and needs an extra tool; not verified in this repo.
- **tarball (see table below)**: for trying a local plugin in **your own external project** while the framework stays on npm.
- **`zhin dev link`**: recommended when an external project needs the local framework (section 4); generates all tarball overrides and restores in one step; hand-written `pnpm.overrides` is the fallback.

## 4. Three valid setups for external projects

| Setup | How | Use for | Notes |
|-------|-----|---------|-------|
| All npm | Plugins also use published versions (`^x.y.z`) | Daily use, production | Only published APIs and config fields |
| All local | Prefer `zhin dev link` (writes **one batch of tarball** overrides; see below); or manually use `pnpm.overrides` to `link:` `zhin.js` and every `@zhin.js/*` into the **same** local checkout, and run `pnpm build` there first | Changing framework and plugin together | After `zhin dev link`, re-run it when source changes; with hand-written `link:`, every package must share one checkout or section 1 returns |
| Tarball | Run `pnpm pack` in the plugin dir (rewrites `workspace:` to real versions), depend on `file:./vendor/xxx.tgz` | Trying a local plugin with npm framework | Plugin can't use unreleased framework APIs; repack and `pnpm install` after each change |

**For external projects, use the one-click command** instead of hand-written overrides. Run it **inside your project** (`../zhin` is your local zhin checkout):

```bash
cd my-bot
zhin dev link ../zhin              # detect zhin.js / @zhin.js/* used by the project, build and pack the full closure, write tarball overrides, run pnpm install
zhin dev unlink                    # restore package.json and pnpm-lock.yaml exactly, then run pnpm install
zhin dev link ../zhin --no-install # only rewrite the manifest; run pnpm install yourself later (also works with unlink)
zhin dev link ../zhin --project ../my-bot   # use --project when not in the project directory
```

**Why this guarantees a single instance**: duplicates usually come from replacing only some packages, leaving transitive ones (e.g. `@zhin.js/runtime`) on npm, while a `link:` into the source tree makes its `workspace:*` deps resolve back into the checkout. `zhin dev link` computes the **full workspace dependency closure** of the zhin packages your project uses, runs `pnpm pack` for **every** package in it and writes them all into `pnpm.overrides`; overrides apply to the whole dependency tree (including transitive deps), so each package name resolves to exactly one tarball. The "Zhin 包单实例" check in `zhin doctor` lists zhin packages that still resolve to several physical locations and suggests `zhin dev link`.

The repo script `pnpm zhin:local link/unlink <project>` still works and shares the same `.zhin-local/` state, so either can unlink the other; the notes below apply to both.

- **Writes tarball overrides** (`file:./.zhin-local/packs/*.tgz`), not `link:` — unlike the hand-written `link:` fallback in the table; after source changes you must run `link` again to rebuild and refresh (idempotent);
- For `pnpm zhin:local`, relative paths resolve from the **caller's directory** (pnpm's `INIT_CWD`), not the repo root; `zhin dev link` simply uses the current directory (or `--project`) as the project;
- Backups and tarballs live in the project's `.zhin-local/`; `link` adds it to the project's `.gitignore` automatically (created if missing, never duplicated); `unlink` reverts it: restored exactly if untouched, deleted if `link` created it, otherwise only that line is removed;
- Besides dependencies, zhin packages declared in the main configuration `plugins` map but missing from dependencies are switched too when available locally, with a warning to add the dependency; `@zhin.js/*` packages **not** in this repo stay on npm with a warning;
- The command refuses with a clear message when: the target is inside the zhin repo, dependencies and the main configuration `plugins` map contain no `zhin.js` / `@zhin.js/*` from this repo, `package.json`/`pnpm-lock.yaml` have uncommitted changes on first link, zhin-related `pnpm.overrides` already exist, `.zhin-local/` exists without `state.json`, or `package.json` was edited after linking (blocks both refresh and `unlink`; to discard those edits run `zhin dev unlink --force`, which lists the discarded lines first);
- Every switched zhin package comes from the same packed build, so section 1's duplicate-copy error cannot occur.

If you can't use the command, hand-write `pnpm.overrides` (`link:` into the same checkout), but cover **every** zhin package in the project's closure (including indirect ones like `@zhin.js/runtime`).

Run `pnpm install` afterwards and use the commands from section 1 to confirm each package has a single resolved path.

To temporarily disable an instance, add its alias to `disable_plugins`. Keep its package dependency, `plugins` mapping and top-level business configuration. Removing a declaration deletes the instance; disabling does not uninstall it.

## 5. Trying a standalone plugin in a bot {#standalone-plugin}

A plugin repository created with `zhin new <name> --standalone` has its own `zhin.js` / `@zhin.js/*` dev dependencies for tests and type checks. To try it in a bot, **do not** run `pnpm add <plugin dir>`:

- a `link:` dependency resolves `@zhin.js/tool` and friends from the plugin's **own** `node_modules`, a different physical location from the bot's copy, so startup fails with `Multiple package locations for @zhin.js/tool are not supported in one generation` (section 1);
- packages resolved through `node_modules` are not watched, so edits do not hot reload;
- a bot created with `pnpm create zhin-app` is itself a pnpm workspace, so `pnpm add` would also need `-w`.

Pick one:

| Goal | How | Hot reload |
| --- | --- | --- |
| Check the published artifact | `pnpm pack` in the plugin, `pnpm add -w <plugin dir>/<name>-<version>.tgz` in the bot root, then `plugins: { <instance>: <package> }` in the main config | No; pack and install again after changes |
| Edit and try | `zhin dev link <plugin dir>` (see [hot-reload a standalone plugin](#dev-link-plugin) below); or link the plugin directory into the bot's `plugins/` by hand and mount it by its `./` local path | Yes |

Manual steps without the command, in the bot root:

```bash
ln -s /path/to/my-plugin plugins/my-plugin   # Windows: mklink /J plugins\my-plugin C:\path\to\my-plugin
pnpm install                                 # the plugin becomes a workspace member; its dev deps link to the bot's store
npx zhin doctor                              # "Zhin 包单实例" (single instance) should pass
```

```yaml
# zhin.config.yml
configVersion: 2
plugins:
  my-plugin: ./plugins/my-plugin
```

Then `pnpm dev`. Editing files in convention directories such as `commands/` or `tools/` reloads that capability (log `hmr_reload | scope: capability`). Editing a shared `src/` helper logs `restartRequired`, and dev mode restarts the process. If the plugin's zhin versions differ from the bot's, pnpm installs two copies and `zhin doctor` reports it; align the versions first.

Afterwards remove the `plugins/my-plugin` link and the `plugins` entry, then run `pnpm install`.

### Hot-reload a standalone plugin in a bot {#dev-link-plugin}

A plugin from `zhin new --standalone` is developed and unit-tested in its own directory. To try it in a real bot while you edit, pass the plugin directory to the same command:

```bash
cd my-bot
zhin dev link ../zhin-plugin-glossary            # instance name defaults to the package name without zhin.js- / zhin-plugin-: glossary
zhin dev link ../zhin-plugin-glossary --as terms # pick the instance name
pnpm dev                                          # edits in the plugin directory hot-reload
zhin dev unlink glossary                          # undo
```

`zhin dev link <path>` looks at `<path>/package.json`: with a `zhin` field it is a plugin, otherwise a zhin checkout. Plugin mode does three things, recorded in the bot's `.zhin/dev-plugin-links.json`; `unlink` only reverts what it did and nobody changed since:

1. creates `plugins/<instance>` in the bot as a link to the plugin directory (a junction on Windows);
2. adds `<instance>: ./plugins/<instance>` to the main configuration `plugins` map plus an empty instance block; on `unlink`, an instance block you filled in is kept;
3. points `zhin.js` / `@zhin.js/*` in the plugin's own `node_modules` (dev and test devDependencies) at the copies the bot resolves. Plugin code resolves imports from its real path, so without this the plugin and the bot each load their own copy and startup fails with `Multiple package locations for @zhin.js/command are not supported in one generation`. Packages the bot does not have (such as `@zhin.js/testing`) are left alone.

Why not something else: only `./` references in the main configuration get file watching. `pnpm add ../plugin`, a tarball, adding the plugin directory to the pnpm workspace, or referencing the link under `plugins/` by package name all load the plugin as a `node_modules` package, without hot reload; `pnpm add <dir>` also brings in the plugin's own `@zhin.js/*`.

Notes:

- Neither side's `package.json` or lockfile changes, and no `pnpm install` runs;
- running `pnpm install` in the plugin restores its own dependencies; run `zhin dev link` again afterwards (idempotent);
- keep the bot's zhin versions inside the plugin's `peerDependencies` ranges; while linked, the plugin's unit tests also use the bot's copies;
- editing a shared `src/` module restarts the runtime (`restartRequired`); editing a convention file reloads just that capability.

## 6. Ports and clean exit

The control plane listens on `http.host`/`http.port` (default `127.0.0.1:8086`). On `EADDRINUSE`, find the owner first:

```bash
lsof -nP -iTCP:<port> -sTCP:LISTEN
```

Only stop processes you know are yours (by PID); avoid `pkill -f "zhin runtime start"`, which can hit other projects' instances.

Current exit behavior:

- **Ctrl+C (SIGINT) / SIGTERM / SIGHUP**: graceful stop, closing HTTP/WS listeners, runtime (adapters, plugin resources), scheduler and database in order; exits `0` on success and frees the port.
- **Not stopped within 5 seconds**: stderr prints `{"forcedExit":"budget","stillStopping":[...]}` naming components still stopping, then force-exits (SIGINT `130`, SIGTERM `143`, SIGHUP `129`).
- **Second Ctrl+C while stopping**: exits immediately (`130`) with `"forcedExit":"repeated-signal"`.
- **Console restart / dependency change requiring restart**: after a full stop, exits naturally with code `75` for the supervisor to relaunch; dependency changes don't interrupt an in-progress plugin management operation, whose apply/restart step triggers it instead.
- Closing a terminal or script session sends SIGHUP, which also triggers a graceful stop; use `--daemon` or a process manager for long-running background use.

Plugins must release their own timers and connections in dispose; a dispose that never finishes is cut off by the 5-second budget and shows up as `runtime` in `stillStopping`.

## 7. Checklist

- [ ] Every `link:`/`file:`/`workspace:` dependency found by `grep` is expected;
- [ ] `pnpm why @zhin.js/command` (and `zhin.js`, `@zhin.js/tool`, ...) shows a single resolved path per package;
- [ ] APIs and config fields used by local plugins exist in the installed zhin.js version;
- [ ] Prefer developing inside the zhin repo (all `workspace:*`); for external projects pick one setup (all npm / tarball / `zhin dev link`) without mixing;
- [ ] Ran `pnpm install` after dependency changes; after source changes, ran `pnpm build` when developing inside the repo, or re-ran `zhin dev link <zhin-path>` for an external project using `zhin dev link` (it rebuilds and refreshes tarballs—`pnpm build` alone in the source repo does not update installed `.zhin-local/packs`);
- [ ] Port is free and old instances were stopped by PID before starting;
- [ ] Ctrl+C exits within 5 seconds without `forcedExit`; if not, check the release logic of components listed in `stillStopping`.
