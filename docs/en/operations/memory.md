---
title: "Memory Usage and Measurement"
description: "What an instance's resident memory consists of, how to measure and attribute it with the measure-instance-memory script, what deployers can do and the known optimizations"
---

# Memory usage and measurement

The resident memory (RSS) of a production instance (`zhin start --mode production --no-watch`) is more than the JS heap. This page shows how to measure it, how much each part takes, what a deployer can tune today and which optimizations are known on the framework side.

::: tip In short
- RSS ≈ the committed V8 heap + the mapped Node executable (about 63MB, shareable and reclaimable) + WebAssembly memory (about 19MB for test-bot) + native allocations and freed-but-not-returned pages (very variable, 25–115MB).
- The largest parts of the heap are **module source strings** and **compiled code**, both proportional to the number of loaded modules; source files containing Chinese are stored as two-byte strings and take far more than on disk.
- The most effective lever for a deployer is capping V8: `NODE_OPTIONS="--max-semi-space-size=2 --max-old-space-size=..."` cut RSS by about 25% for test-bot on the measuring machine. Set `--max-old-space-size` too low and processes run out of memory, and the gateway and the pnpm / npm it runs inherit the limit as well; see [What deployers can do](#what-deployers-can-do).
:::

## How to measure

`scripts/measure-instance-memory.mjs` in the repository root starts a project the way the gateway starts its instance (`zhin runtime start --standalone --no-watch`, `NODE_ENV=production`, the instance-child environment), waits for it to settle, runs six full GCs, samples it and stops it.

By default the script copies the project to a temporary directory first: the project's own files, with `node_modules` linked rather than copied, and without `.zhin/`, `data/`, `tests/` and `.env*`. The instance therefore does not read the project's `.env`, does not compete for `.zhin/` and the SQLite database with a development instance running in the project, and leaves no state there. The copied `zhin.config.yml` still applies, so adapters and services configured in it may still connect to the outside; replace it with `--config` if needed. `--in-place` runs in the project directory itself instead (reading `.env` and writing `.zhin/` like `zhin start`). The temporary directory is removed when the script ends, fails or is interrupted (unless `--keep`).

The script runs the built `lib/` output, so build the packages the project uses first:

```bash
# Build only what minimal-bot depends on (about a minute); for test-bot use --filter='test-bot^...'
pnpm exec turbo run build --filter='minimal-bot^...'

# Basic numbers: module count, heap after GC, RSS
node scripts/measure-instance-memory.mjs

# RSS composition, V8 heap spaces, code statistics, /proc, child processes, modules by origin
node scripts/measure-instance-memory.mjs --breakdown --settle 30

# test-bot with its example configuration replacing the copied zhin.config.yml
node scripts/measure-instance-memory.mjs --project examples/test-bot \
  --config examples/test-bot/zhin.config.example.yml --breakdown --settle 30

# Heap snapshot after GC, plus the top 30 classes and "who holds these strings"
node scripts/measure-instance-memory.mjs --breakdown --heap-snapshot /tmp/instance.heapsnapshot

# Sample again after a few AI turns (local fake model, no key needed)
node scripts/measure-instance-memory.mjs --after-turn --turns 10 --idle 30

# Machine-readable output for before/after comparisons
node scripts/measure-instance-memory.mjs --breakdown --json > before.json
```

| Option | What it does |
| --- | --- |
| `--breakdown` | Prints `process.memoryUsage()`, `v8.getHeapStatistics()` / `getHeapSpaceStatistics()` / `getHeapCodeStatistics()`, on Linux `/proc/self/status`, `smaps_rollup` and `smaps` grouped by mapping, the RSS of child processes (esbuild and others), loaded modules grouped by official / third-party / project (top N packages) and convention directory, and an approximate RSS attribution |
| `--heap-snapshot file` | Writes a `.heapsnapshot` after the GC (open it in Chrome DevTools) and parses it: self size by constructor / type (top 30), breakdowns inside `(compiled code)`, `(system)` and `(array)`, and `(string)`, `(array)` and ArrayBuffers grouped by their first retainer. With `--after-turn` it writes a second one, named by replacing the path's trailing `.heapsnapshot` with `.after-turn.heapsnapshot` (`out.heapsnapshot` → `out.after-turn.heapsnapshot`). A snapshot is about 0.7–1.5 times the heap used after GC; delete it when done. An interrupted run deletes a snapshot it did not finish. Parsing is not streamed: the script reads the whole snapshot into one Buffer and scans its bytes, so because of the `fs.readFileSync` limit it cannot parse a snapshot of 2 GiB or more; the report then says so, and DevTools can still open it. Writing one raises the process's RSS (about +180MB here), so leave it out when comparing RSS |
| `--after-turn` | Writes the minimal-bot terminal adapter to the copied project (`adapters/terminal/index.ts`, replacing an existing one, with the `endpointId` the Agent ingress requires added), points an `ai.plan.yml` at a built-in OpenAI-compatible fake model (it calls the `discover` tool once, then answers in the structured reply format), sends `--turns` messages on stdin, waits `--idle` seconds and samples again (before and after GC) |
| `--settle` | Seconds to wait after start before sampling, default 8. Console page builds, the metadata worker and V8's memory reducer need time; **use 30 or more for comparisons** |
| `--top` | How many packages and snapshot classes to list |
| `--host-tmpdir` | Let the instance use the host's temp dir. By default it gets an empty `TMPDIR`; see the tsx cache section below |
| `--config file` | Replace the copied project's `zhin.config.yml` with this file |
| `--in-place` | Run in the project directory instead of a copy; not with `--config`, `--after-turn` or `--with-pages` |
| `--source` / `--with-pages` / `--keep` / `--verbose` / `--json` | As before: run from TypeScript sources, measure a generated project with Console pages, keep the temp dir, show instance output, print JSON |

An interrupted run exits with 130 (Ctrl+C / SIGINT) or 143 (SIGTERM). The module-source estimate of `--breakdown` counts only `.js`, `.mjs`, `.cjs`, `.ts` and `.tsx` files, not `.json` or `.node`. The counters in the RSS attribution (committed heap, ArrayBuffers, external and so on) are allocated sizes, not resident memory, so the rows can add up to more than 100%; the final "remainder" row is then 0.

A single sample depends heavily on GC timing (three runs of the same project differed by 90MB of RSS). To compare two versions, run each three times on the same machine and take the median.

## Attribution (one machine — orders of magnitude only)

Setup: Linux x86_64, Node.js 22.23, build output of the `feat` branch, `--settle 30`. test-bot uses `zhin.config.example.yml` (sandbox plus 14 plugins, AI enabled without a model).

Where the numbers come from: each project ran three times without `--heap-snapshot`; "RSS (three runs)" below is the range of those three, and the other counters and the composition table come from the run with the median RSS. The breakdown inside the heap (source strings, compiled code, arrays and so on) comes from a separate `--heap-snapshot` run, because writing a snapshot raises RSS.

| | minimal-bot | test-bot |
| --- | --- | --- |
| Loaded modules | 1645 | 2498 |
| Official / third-party / project | 1067 / 567 / 11 | 1766 / 683 / 49 |
| Convention-directory files | 11 | 104 (commands 68, Skill-private tools 18, middlewares 10, …) |
| Heap used after GC | 51.4MB | 75.8MB |
| Committed heap (heapTotal) | 57.4MB | 86.1MB |
| RSS (three runs) | 174–177MB | 232–324MB |
| Startup peak (VmHWM) | about 217MB | about 355MB |

Composition of the median test-bot run (RSS 284.9MB):

| Item | MB | Share of RSS | Notes |
| --- | --- | --- | --- |
| Unattributed anonymous memory | 104.3 | 36.6% | Pages V8 freed but has not returned, memory glibc malloc keeps, thread stacks, worker threads; 50–115MB across three runs |
| Mapped Node executable | 63.3 | 22.2% | File-backed, read-only, shared between Node processes (the gateway and the instance map the same physical pages), reclaimable by the kernel under pressure |
| Module source strings | 26.3 | 9.2% | V8 keeps every Script's source (ESM 23.5MB + CJS 2.8MB); only 16MB on disk, see "Two-byte sources" |
| Compiled code and metadata | 20.3 | 7.1% | Bytecode, ScopeInfo, line-end tables (4MB), constant pools, feedback vectors |
| WebAssembly memory | 19.2 | 6.7% | The largest block, 16.1MB, is the linear memory of `es-module-lexer` (the instance still analyses dependencies under `--no-watch`); the rest is shiki and others |
| Committed but unused heap | 10.3 | 3.6% | heapTotal minus used heap; after 30 idle seconds the young generation shrinks to about 1MB |
| Arrays (properties, elements, Map / Set tables) | 7.8 | 2.7% | |
| V8 internal objects (hidden classes, module records) | 7.3 | 2.6% | About 1.3MB of it is `SourceTextModule` data, proportional to the module count |
| Other strings | 6.7 | 2.4% | Tool descriptions, schema texts, URLs |
| Shared libraries and native addons | 4.7 | 1.7% | libc, libstdc++, sqlite3 and other `.so` / `.node` files |
| Other (objects, closures, malloc) | 14.7 | 5.2% | Plain JS objects and closures, plus malloc allocations none of the rows above cover; computed as RSS minus the rows above, so the rows add up to RSS |

minimal-bot has the same structure at a smaller scale; it has `.tsx` components, so it also runs **an esbuild child process (15.6MB, not counted in the instance's RSS)** and the tsx loader.

The script's "RSS attribution" rows map to the counters of `process.memoryUsage()` and `/proc`; the heap rows above come from the snapshot. The two use different bases (snapshot self sizes exclude committed but unused pages), so the totals do not match exactly.

## What the big items are

### The module count decides most of the heap

Source strings, compiled code and module records all grow with the number of loaded modules. On this machine test-bot uses about 30KB of heap per module (source included), consistent with the 4718 modules and 195MB heap after GC reported in [#1250](https://github.com/zhinjs/zhin/issues/1250). In test-bot `@zhin.js/agent` alone loads 543 files (about 6MB of source strings); the plugins' convention-directory files are only 104 files with 0.1MB of source, so **the official framework packages, not the plugins' own commands and tools, are the bulk**.

### Two-byte sources

V8 stores a source made only of Latin-1 characters as a one-byte string; a single Chinese character makes the whole source a two-byte UTF-16 string. 1081 of the 2498 files test-bot loads contain Chinese (log messages, prompts, tool descriptions, i18n texts), which turns about 16.5MB of source into 26.2MB of strings (the script estimates this from file contents; the snapshot shows 26.3MB). Writing those characters as `\uXXXX` escapes — what esbuild emits with its default `charset: 'ascii'` — would save about 37%.

### A heap that "does not come back down"

`heapTotal` is the heap V8 has committed, not what is in use. V8 shrinks the heap only after a full GC, and an idle process may not run one for a long time: 15 seconds after start test-bot's heapTotal was about 137–145MB before a forced GC and 86–92MB after it, while RSS barely moved (freed pages stay in the process first). `--max-old-space-size` makes V8 run full GCs earlier; `--max-semi-space-size` limits the young generation (up to 32MB by default).

### AI turns

With `--after-turn` on test-bot (fake model, two model calls and one tool call per turn) the heap used after GC grew by 8.0MB after 3 turns and by 7.7MB after 30 turns. The growth is mostly compiled code (+5.8MB: functions the turn runs are compiled for the first time) and AI SDK modules loaded on demand — a one-time warm-up that **does not grow with the number of turns**; heapTotal before GC after the turns did not exceed its level at startup. The observation in [#1250](https://github.com/zhinjs/zhin/issues/1250) that "an AI turn pushes heapTotal to 340MB and it stays there" was **not reproduced** with the fake model here: its context is small (about 20–50KB per call), while real turns with long history, memory, large tool output and streaming create many more short-lived objects, which together with the V8 behaviour above shows up as a heapTotal that stays high.

### tsx's disk-cache index

As soon as a project has one `.tsx` file, the instance registers the tsx loader. On its first transform tsx reads the listing of its whole cache directory (`tsx-` plus the user id under the system temp dir) into the heap, a few objects per cache entry. On the development machine that directory had about 270,000 entries, which took minimal-bot's heap after GC from 51MB to 106MB. Production hosts usually have few entries, but every source change adds one (they expire after 7 days). The script gives the instance an empty temp dir by default to exclude this; `--host-tmpdir` shows the real situation of the host.

## What deployers can do

The numbers in this section come from an earlier round of measurements: settle 15 s and two runs per setting, unlike the settle of 30 s or more and median of three recommended above. At 15 s V8 has usually not shrunk the heap yet, so the absolute values are high; read only the relative change within the round.

| Measure | Effect (test-bot on this machine, settle 15 s, two runs each) | Caveats |
| --- | --- | --- |
| `NODE_OPTIONS="--max-semi-space-size=2"` | RSS from 314–337MB to 281–287MB | More frequent young-generation GCs, slightly lower throughput; rarely noticeable for a chat bot |
| Also `--max-old-space-size=…` | With 192 added: 250–253MB | Risk of running out of memory; see below the table |
| Run production with `--mode production --no-watch` | No file watching or HMR state | The scaffolded `pnpm start` already does |
| Avoid `.tsx` (write commands and components as `.ts`, or compile to `.js` before publishing) | One esbuild child process (about 15MB), tsx itself and its cache index fewer | Node strips types from `.ts` natively; no tsx needed |
| Fewer plugins and no unused adapters | The heap shrinks with the module count | Each official plugin brings in the framework packages it depends on |
| Periodically clean `tsx-` plus the user id in the temp dir | Keeps the tsx cache index small | Only relevant with `.tsx` files |

### Before setting `--max-old-space-size`

- **Scope**: `NODE_OPTIONS` applies to the gateway itself and to every Node child process it starts, not only the instance. When the Console installs dependencies or upgrades plugins or the framework, the pnpm / npm the gateway runs are Node processes too and get the same limit; `--max-old-space-size=192` is enough to make a larger install or upgrade fail with out-of-memory.
- **Size it from the peak**: base the limit on the heap peak during startup and during AI turns, not on the heap used after GC. 15 seconds after start test-bot's heapTotal was about 137–145MB before a forced GC and only 86–92MB after it, and the startup RSS peak (VmHWM) was about 355MB; real AI turns with long history and large tool output go higher. The 192 above only did not fail in the fake-model setup here; do not copy it. A setup like the one in [#1250](https://github.com/zhinjs/zhin/issues/1250) (195MB heap used after GC, heapTotal at 340MB during AI turns) needs a limit far above 192.
- **What OOM does**: when every start runs out of memory the gateway keeps restarting the instance until the restart-storm guard trips (by default 10 restarts within a minute); the instance then stays `crashed`. `NODE_OPTIONS` is read when the gateway starts, so after changing it restart the gateway (`systemctl restart` under systemd, `zhin restart --gateway` for a background gateway); restarting only the instance is not enough.

### How to set it

- **systemd**: write a drop-in with `systemctl edit your-project.service` (add `--user` for a user service) instead of editing the unit file, because `zhin service install` regenerates and overwrites it:

  ```ini
  [Service]
  Environment="NODE_OPTIONS=--max-semi-space-size=2"
  ```

  Then `systemctl restart your-project.service` (or `zhin service restart`).
- **Compose / Kubernetes**: put it in `environment` or `env`.
- **Background gateway (`zhin start`)**: `export NODE_OPTIONS=...` in the shell that starts the gateway. Note that `zhin restart --gateway` starts the new gateway with the environment of **the shell that runs the command**; restart it from a shell without `NODE_OPTIONS` and the setting is gone.

### Checking actual usage

`zhin status` shows the gateway's and the instance's pid, not their memory. With the pid:

- `ps -o rss,pid -p PID` (replace `PID` with the instance's pid) shows RSS in KB;
- `cat /proc/PID/smaps_rollup` shows `Rss`, `Pss` and `Private_Dirty` (Linux);
- inside a container, read the cgroup's `memory.current` (cgroup v2, usually `/sys/fs/cgroup/memory.current`).

Prefer PSS or `memory.current`, and do not add up the gateway's and the instance's RSS: they share the physical pages of the Node executable.

## Known optimizations

Ordered by the benefit measured here; "phase" refers to the phased plan of ADR 0068 (proposed), which is not final.

| Optimization | Evidence | Expected gain | Tracking |
| --- | --- | --- | --- |
| Production instances (`watch: false`) skip module dependency analysis and `?zhin-generation=` invalidation | 16.1MB of WebAssembly memory in the snapshot belongs to `es-module-lexer`; test-bot loads no tsx, `es-module-lexer` is its only WASM lexer, and ArrayBuffer backing stores still total 19.2MB | About 16MB of RSS plus a few resident Maps | [#1250](https://github.com/zhinjs/zhin/issues/1250), outside ADR 0068 |
| Bundle official packages on publish and emit ASCII-escaped sources | 1081 of 2498 files are two-byte sources; escaped, source strings drop from about 26MB to 16.5MB; bundling also saves per-module records | Source strings about −37%; module records and ScopeInfo fall with the module count | ADR 0068 (proposed) P1 / P2 |
| Load convention-directory capabilities lazily from a manifest | test-bot has only 104 convention-directory files with 0.1MB of source; a production project with 42 plugins has about 900 | Proportional to the number of plugins; limited where official packages dominate | ADR 0068 (proposed) P3–P6 |
| Do not register a global tsx loader for `.tsx` | minimal-bot runs an extra 15.6MB esbuild child process; the tsx cache index grows with its cache directory | 15MB or more | [#1250](https://github.com/zhinjs/zhin/issues/1250) |
| Keep CLI-side code and heavy optional dependencies out of the instance | Both projects load 22 files of `@zhin.js/scaffold-wizard`; test-bot loads shiki through the code-block component of `@zhin.js/components` | 1–3MB each | [#1250](https://github.com/zhinjs/zhin/issues/1250) |

## Related pages

- [Production deployment and operations](./production.md)
- [CLI: zhin start](../cli/runtime.md)
