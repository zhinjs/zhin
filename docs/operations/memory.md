---
title: "内存占用与测量"
description: "实例常驻内存由哪些部分组成、怎样用 measure-instance-memory 脚本测量与归因、部署者可以做什么、已知的优化方向"
---

# 内存占用与测量

一个生产实例（`zhin start --mode production --no-watch`）的常驻内存（RSS）不只是 JS 堆。这一页说明怎样测量、各部分占多少、哪些是部署者现在就能调的，以及框架侧已知的优化方向。

::: tip 先说结论
- RSS ≈ V8 已提交的堆 + Node 可执行文件映射（约 63MB，可共享、可回收）+ WebAssembly 内存（test-bot 约 19MB）+ 原生分配与已释放未归还的页（波动大，25–115MB）。
- 堆里最大的是**模块源码字符串**和**编译后的代码**，与加载的模块数成正比；含中文的源文件按双字节存储，比磁盘上大得多。
- 部署者最有效的手段是给 V8 设上限：`NODE_OPTIONS="--max-semi-space-size=2 --max-old-space-size=..."`，本机 test-bot 上 RSS 降了约 25%。`--max-old-space-size` 设得过低会 OOM，而且网关和它拉起的 pnpm / npm 也会继承这个上限，见下文[部署者可以做的事](#部署者可以做的事)。
:::

## 怎样测量

仓库根目录的 `scripts/measure-instance-memory.mjs` 按网关拉起实例的方式（`zhin runtime start --standalone --no-watch`，`NODE_ENV=production`，实例子进程环境）启动一个项目，等它稳定后做 6 次完整 GC，再采样并停止实例。

默认情况下，脚本先把项目复制到临时目录再运行：复制项目自己的文件，`node_modules` 用符号链接，不复制 `.zhin/`、`data/`、`tests/` 和 `.env*`。这样实例不会读到项目的 `.env`，不会和项目里正在跑的开发实例争用 `.zhin/` 与 SQLite 数据库，也不会在项目里留下状态。复制过去的 `zhin.config.yml` 仍然生效，里面配置的适配器和服务仍可能连接外部；需要时用 `--config` 换掉它。加 `--in-place` 则直接在项目目录里运行（与 `zhin start` 一样读取 `.env` 并写入 `.zhin/`）。脚本结束、出错或被中断时都会删除临时目录（`--keep` 除外）。

脚本跑的是构建产物 `lib/`，所以先构建项目用到的包：

```bash
# 只构建 minimal-bot 依赖的包（约 1 分钟）；test-bot 用 --filter='test-bot^...'
pnpm exec turbo run build --filter='minimal-bot^...'

# 基本数字：模块数、GC 后堆、RSS
node scripts/measure-instance-memory.mjs

# RSS 构成、V8 堆空间、代码统计、/proc、子进程、模块按来源分组
node scripts/measure-instance-memory.mjs --breakdown --settle 30

# test-bot：用示例配置替换复制过去的 zhin.config.yml
node scripts/measure-instance-memory.mjs --project examples/test-bot \
  --config examples/test-bot/zhin.config.example.yml --breakdown --settle 30

# 堆快照：GC 后写快照并打印按类型聚合的前 30 项与「谁持有这些字符串」
node scripts/measure-instance-memory.mjs --breakdown --heap-snapshot /tmp/instance.heapsnapshot

# 跑几个 AI 回合后再测一次（本地假模型，无需密钥）
node scripts/measure-instance-memory.mjs --after-turn --turns 10 --idle 30

# 机器可读输出，便于前后对比
node scripts/measure-instance-memory.mjs --breakdown --json > before.json
```

| 选项 | 作用 |
| --- | --- |
| `--breakdown` | 输出 `process.memoryUsage()`、`v8.getHeapStatistics()` / `getHeapSpaceStatistics()` / `getHeapCodeStatistics()`、Linux 下 `/proc/self/status`、`smaps_rollup` 与按映射分组的 `smaps`、子进程 RSS（esbuild 等）、已加载模块按官方包 / 第三方 / 项目分组（前 N 个包）与约定目录计数，以及一张近似的 RSS 归因表 |
| `--heap-snapshot 文件` | GC 后写一份 `.heapsnapshot`（可用 Chrome DevTools 打开），并在脚本里解析：按构造函数 / 类型聚合 self size 前 30，`(compiled code)`、`(system)`、`(array)` 内部细分，`(string)`、`(array)`、ArrayBuffer 按第一个持有者分组。配合 `--after-turn` 时还会写第二份，文件名把路径末尾的 `.heapsnapshot` 换成 `.after-turn.heapsnapshot`（`out.heapsnapshot` → `out.after-turn.heapsnapshot`）。快照大小约为 GC 后已用堆的 0.7–1.5 倍，用完删除；中断时脚本会删掉没写完的快照。解析不是流式的：脚本把整个快照读进一个 Buffer 再逐字节扫描，受 `fs.readFileSync` 限制，2 GiB 及以上的快照无法解析，此时报告里给出提示，请改用 DevTools 打开。写快照本身会让进程 RSS 上涨（本机约 +180MB），比较 RSS 时不要带这个选项 |
| `--after-turn` | 在复制出的项目里写入 minimal-bot 的终端适配器（`adapters/terminal/index.ts`，已有则替换，并补上 Agent 入口要求的 `endpointId`），`ai.plan.yml` 指向脚本内置的 OpenAI 兼容假模型（先调用一次 `discover` 工具，再按结构化回复格式作答），经 stdin 发 `--turns` 条消息，空闲 `--idle` 秒后再采样一次（GC 前后各一组） |
| `--settle` | 启动后等多少秒再采样，默认 8。Console 页面构建、元数据 worker 和 V8 的内存回收器都需要时间，**做对比请用 30 秒以上** |
| `--top` | 包和快照类型列多少项 |
| `--host-tmpdir` | 让实例使用宿主机的临时目录。默认给实例一个空的 `TMPDIR`，原因见下文 tsx 缓存一节 |
| `--config 文件` | 用这个文件替换复制出的项目的 `zhin.config.yml` |
| `--in-place` | 不复制，直接在项目目录里运行；不能与 `--config`、`--after-turn`、`--with-pages` 同用 |
| `--source` / `--with-pages` / `--keep` / `--verbose` / `--json` | 与以前相同：从 TypeScript 源码运行、测带 Console 页面的生成项目、保留临时目录、显示实例输出、输出 JSON |

中断时脚本以 130（Ctrl+C / SIGINT）或 143（SIGTERM）退出。`--breakdown` 估算模块源码时只统计 `.js`、`.mjs`、`.cjs`、`.ts`、`.tsx` 文件，`.json` 和 `.node` 不计入。归因表里的计数器（已提交的堆、ArrayBuffer、external 等）是分配量而不是驻留量，所以各行之和可能超过 100%，这时最后的「remainder」一行记为 0。

单次采样受 GC 时机影响很大（同一项目三次 RSS 可以差 90MB）。比较两个版本时，在同一台机器上各跑 3 次取中位数。

## 归因表（本机测量，只作量级参考）

环境：Linux x86_64，Node.js 22.23，`feat` 分支构建产物，`--settle 30`。test-bot 使用 `zhin.config.example.yml`（sandbox + 14 个插件，AI 开启但未配置模型）。

数字的来源：每个项目不带 `--heap-snapshot` 跑三次，下表的「RSS（三次）」是这三次的范围，其余计数器和下面的构成表取 RSS 为中位数的那一次；堆内细分（源码字符串、编译后的代码、数组等）来自另跑的一次 `--heap-snapshot`，因为写快照会抬高 RSS。

| | minimal-bot | test-bot |
| --- | --- | --- |
| 已加载模块 | 1645 | 2498 |
| 其中官方包 / 第三方 / 项目 | 1067 / 567 / 11 | 1766 / 683 / 49 |
| 约定目录文件 | 11 | 104（commands 68、技能私有工具 18、middlewares 10 …） |
| GC 后已用堆 | 51.4MB | 75.8MB |
| 已提交堆（heapTotal） | 57.4MB | 86.1MB |
| RSS（三次） | 174–177MB | 232–324MB |
| 启动峰值（VmHWM） | 约 217MB | 约 355MB |

test-bot 中位数那次（RSS 284.9MB）的构成：

| 项目 | MB | 占 RSS | 说明 |
| --- | --- | --- | --- |
| 未归因的匿名内存 | 104.3 | 36.6% | V8 已释放但未归还系统的页、glibc malloc 保留的内存、线程栈、worker 线程；三次测量在 50–115MB 之间波动 |
| Node 可执行文件映射 | 63.3 | 22.2% | 文件映射、只读、多个 Node 进程共享（网关与实例各一份但物理页相同），内存紧张时可被内核回收 |
| 模块源码字符串 | 26.3 | 9.2% | V8 为每个 Script 保留源码（ESM 23.5MB + CJS 2.8MB）；磁盘上只有 16MB，见下文「双字节源码」 |
| 编译后的代码与元数据 | 20.3 | 7.1% | 字节码、ScopeInfo、行尾表（4MB）、常量池、反馈向量等 |
| WebAssembly 内存 | 19.2 | 6.7% | 最大一块 16.1MB 是 `es-module-lexer` 的线性内存（实例在 `--no-watch` 下仍做依赖分析）；其余是 shiki 等 |
| 已提交未使用的堆 | 10.3 | 3.6% | heapTotal 减已用堆；空闲 30 秒后新生代缩到 1MB 左右 |
| 数组（属性、元素、Map / Set 表） | 7.8 | 2.7% | |
| V8 内部对象（hidden class、模块记录等） | 7.3 | 2.6% | 其中 `SourceTextModule` 相关约 1.3MB，与模块数成正比 |
| 其他字符串 | 6.7 | 2.4% | 工具描述、Schema 文案、URL 等 |
| 共享库与原生插件 | 4.7 | 1.7% | libc、libstdc++、sqlite3 等 `.so` / `.node` |
| 其他（对象、闭包、malloc） | 14.7 | 5.2% | 普通 JS 对象与闭包，以及上面各行没有覆盖的 malloc 分配；按 RSS 减去以上各行计算，使各行之和等于 RSS |

minimal-bot 的结构相同但规模更小；它有 `.tsx` 组件，所以多一个 **esbuild 子进程（15.6MB，不计入实例 RSS）** 和 tsx 加载器。

脚本里的「RSS attribution」一行一行对应 `process.memoryUsage()` 与 `/proc` 的计数器；上表中的堆内细分来自堆快照。两者口径不同（快照的 self size 不含已提交未用的页），合计不严格相等。

## 主要占用项的解释

### 模块数量决定了大半个堆

源码字符串、编译后的代码、模块记录都与加载的模块数成正比。本机 test-bot 平均每个模块约 30KB 堆（含源码），[#1250](https://github.com/zhinjs/zhin/issues/1250) 报告的 4718 个模块、GC 后 195MB 堆与此量级一致。test-bot 里 `@zhin.js/agent` 一个包就加载了 543 个文件（源码字符串约 6MB）；插件的约定目录文件只有 104 个、0.1MB 源码，**大头是官方框架包**而不是插件自己的命令和工具。

### 双字节源码

V8 把只含 Latin-1 字符的源码存成单字节字符串，只要出现一个中文字符，整份源码就按 UTF-16 双字节存储。test-bot 加载的 2498 个文件里有 1081 个含中文（日志、提示、工具描述、i18n 文案），源码字符串因此从约 16.5MB 变成 26.2MB（脚本按文件内容估算，与快照里的 26.3MB 吻合）。如果把这些字符写成 `\uXXXX` 转义（esbuild 默认的 `charset: 'ascii'` 就是这样输出的），可以省下约 37%。

### 堆「不回落」

`heapTotal` 是 V8 已向系统提交的堆，不是正在使用的量。V8 只在完整 GC 之后才收缩堆，空闲进程里这种 GC 可能很久不发生：本机 test-bot 启动 15 秒时 GC 前 heapTotal 约 137–145MB，强制 GC 后降到 86–92MB，而 RSS 几乎不变（释放的页先留在进程里）。`--max-old-space-size` 让 V8 更早做完整 GC，`--max-semi-space-size` 限制新生代（默认最多 32MB）。

### AI 回合

用 `--after-turn` 跑 test-bot（假模型，每回合两次模型调用、一次工具调用）：3 个回合后 GC 后已用堆 +8.0MB，30 个回合后 +7.7MB，增量主要是编译后的代码（+5.8MB：回合执行到的函数第一次被编译）和按需加载的 AI SDK 模块，属于一次性预热，**没有随回合数增长**；回合结束后 GC 前的 heapTotal 也没有超过启动时的水平。[#1250](https://github.com/zhinjs/zhin/issues/1250) 里「AI 回合把 heapTotal 撑到 340MB 后不回落」在本机的假模型场景下**没有复现**：假模型的上下文很小（每次调用约 20–50KB），真实场景的长历史、记忆、大工具输出和流式响应会产生更多短命对象，配合上一节的 V8 行为就会表现为 heapTotal 停在高位。

### tsx 的磁盘缓存索引

项目里只要有一个 `.tsx` 文件，实例就会注册 tsx 加载器。tsx 第一次转换时会把整个缓存目录（系统临时目录下的 `tsx-用户 id`）的文件列表读进堆里，每个缓存条目一组对象。本机开发环境这个目录有约 27 万个条目，minimal-bot 的 GC 后堆因此从 51MB 变成 106MB。生产主机上条目通常很少，但每次改动源码都会新增条目（7 天过期）。测量脚本默认给实例一个空的临时目录来排除这个干扰，`--host-tmpdir` 可以看本机真实情况。

## 部署者可以做的事

这一节的数字来自较早的一轮测量：settle 15 秒、每种设置跑两次，与上文建议的 settle 30 秒以上、三次取中位数口径不同。15 秒时 V8 多半还没收缩堆，绝对值偏高，只适合看同一轮里的相对变化。

| 做法 | 效果（本机 test-bot，settle 15 秒，各两次） | 注意 |
| --- | --- | --- |
| `NODE_OPTIONS="--max-semi-space-size=2"` | RSS 从 314–337MB 降到 281–287MB | 新生代 GC 更频繁，吞吐略降；对聊天机器人通常无感 |
| 再加 `--max-old-space-size=…` | 加上 192 后降到 250–253MB | 有 OOM 风险，见表下说明 |
| 生产用 `--mode production --no-watch` | 不加载文件监视与 HMR 状态 | 脚手架的 `pnpm start` 默认如此 |
| 避免 `.tsx`（命令和组件写成 `.ts`，或发布前编译成 `.js`） | 少一个 esbuild 子进程（约 15MB）、tsx 自身与它的缓存索引 | `.ts` 由 Node 原生去类型，不需要 tsx |
| 减少插件与不用的适配器 | 模块数线性减少堆 | 每个官方插件会带进它依赖的框架包 |
| 定期清理临时目录里的 `tsx-用户 id` | 避免 tsx 缓存索引变大 | 只在使用 `.tsx` 时有关 |

### 设置 `--max-old-space-size` 之前

- **作用范围**：`NODE_OPTIONS` 对网关本身和网关拉起的所有 Node 子进程都生效，不只是实例。Console 里安装依赖、升级插件或框架时，网关运行的 pnpm / npm 也是 Node 进程，同样受这个上限约束；`--max-old-space-size=192` 足以让一次较大的安装或升级因 OOM 失败。
- **按峰值定上限**：上限要以启动期和 AI 回合中的堆峰值为基准，不能按 GC 后的已用堆来估。本机 test-bot 启动 15 秒时 GC 前的 heapTotal 约 137–145MB，GC 后只有 86–92MB，启动峰值（VmHWM）约 355MB；真实 AI 回合的长历史和大工具输出还会更高。上面的 192 只是本机假模型场景下没有出问题，不能直接照搬；像 [#1250](https://github.com/zhinjs/zhin/issues/1250) 报告的场景（GC 后已用堆 195MB，AI 回合中 heapTotal 到 340MB），需要的上限远高于 192。
- **OOM 的后果**：每次启动都 OOM 时，网关会连续重启实例，触发重启风暴保护（默认 1 分钟内 10 次），之后实例停在 `crashed` 状态。`NODE_OPTIONS` 在网关启动时读入，改完要重启网关才生效（systemd 下 `systemctl restart`，后台网关用 `zhin restart --gateway`），只重启实例不够。

### 怎样设置

- **systemd**：用 `systemctl edit 项目名.service`（用户级服务加 `--user`）写一个 drop-in，不要直接改 unit 文件，因为 `zhin service install` 会重新生成并覆盖它：

  ```ini
  [Service]
  Environment="NODE_OPTIONS=--max-semi-space-size=2"
  ```

  之后 `systemctl restart 项目名.service`（或 `zhin service restart`）生效。
- **Compose / Kubernetes**：写进 `environment` 或 `env`。
- **后台网关（`zhin start`）**：在启动网关的 shell 里 `export NODE_OPTIONS=...`。注意 `zhin restart --gateway` 会用**执行这条命令的 shell** 的环境重新拉起网关；换一个没有设置 `NODE_OPTIONS` 的 shell 来重启，这个设置就丢了。

### 确认实际占用

`zhin status` 只显示网关和实例的 pid，不显示内存。拿到 pid 后：

- `ps -o rss,pid -p PID`（把 `PID` 换成实例的 pid）看 RSS，单位 KB；
- `cat /proc/PID/smaps_rollup` 看 `Rss`、`Pss`、`Private_Dirty`（Linux）；
- 在容器里看 cgroup 的 `memory.current`（cgroup v2，通常是 `/sys/fs/cgroup/memory.current`）。

优先看 PSS 或 `memory.current`，不要把网关与实例的 RSS 直接相加：两者共享 Node 可执行文件的物理页。

## 已知可优化点

按本机测量的收益排序；「阶段」指 ADR 0068（提议中）的分阶段计划，尚未定稿。

| 优化 | 依据 | 预期收益 | 对应 |
| --- | --- | --- | --- |
| 生产实例（`watch: false`）跳过模块依赖分析与 `?zhin-generation=` 失效 | 快照里 16.1MB 的 WebAssembly 内存属于 `es-module-lexer`；test-bot 不加载 tsx，`es-module-lexer` 是它唯一的 WASM 词法器，ArrayBuffer 后备存储合计仍有 19.2MB | 约 16MB RSS 与几张常驻 Map | [#1250](https://github.com/zhinjs/zhin/issues/1250)，不在 ADR 0068 范围 |
| 官方包发布时打包，并输出 ASCII 转义的源码 | 1081 / 2498 个文件是双字节源码；转义后源码字符串约 26MB 降到 16.5MB；打包本身每个模块再省模块记录 | 源码字符串约 −37%，模块记录与 ScopeInfo 随模块数下降 | ADR 0068（提议中）P1 / P2 |
| 约定目录能力按清单惰性加载 | test-bot 里约定目录文件只有 104 个、0.1MB 源码；42 个插件的生产项目约 900 个 | 与插件数成正比；对官方包占大头的项目收益有限 | ADR 0068（提议中）P3–P6 |
| `.tsx` 不注册全局 tsx 加载器 | minimal-bot 多一个 15.6MB 的 esbuild 子进程，tsx 缓存索引随缓存目录增长 | 约 15MB 以上 | [#1250](https://github.com/zhinjs/zhin/issues/1250) |
| 实例不加载 CLI 侧代码与重型可选依赖 | 两个项目都加载了 `@zhin.js/scaffold-wizard` 22 个文件；test-bot 经 `@zhin.js/components` 的代码块组件加载了 shiki | 每项 1–3MB | [#1250](https://github.com/zhinjs/zhin/issues/1250) |

## 相关页面

- [生产部署与运维](./production.md)
- [CLI：zhin start](../cli/runtime.md)
