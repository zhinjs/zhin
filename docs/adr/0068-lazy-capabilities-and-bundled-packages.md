---
sidebar: false
---

# ADR 0068：约定目录能力按清单惰性加载，官方包发布时打包成少量文件

状态：提议（草案，待所有者拍板第 6 节的开放问题）。依据：zhinjs/zhin#1250 用户反馈 `eager-load-all-capabilities`（生产实例常驻约 600MB；42 个插件、913 个约定目录文件在启动时全部加载；官方包按文件发布，`@zhin.js/agent` 一个包 541 个文件）。核对基线：`feat` 分支 `9916ecd64`。本文只是方案，不改任何源码。

关联：[ADR 0040](./0040-controlled-self-change.md)（受控自我进化：试跑要求「装配成功、声明的指令 / 工具可被发现」，生效后做健康检查）、[ADR 0054](./0054-management-gateway.md)（网关监管实例，`zhin.js/instance` 是装配根）、#1250 `metadata-worker`（Console 页面元数据放进短命 worker，先例见下文）。

## 1. 背景

### 1.1 现状：约定目录的发现与加载路径（逐项核实）

一次完整 generation 的装配顺序在 `GenerationAssembler.prepare()`（`packages/im/runtime/src/root-runtime-diagnostics.ts:383-390`）：先加载 Feature provider，再 `setupTree()`，再 `#discover()`，最后投影。

| # | 步骤 | 做了什么 | 位置 |
|---|---|---|---|
| L1 | 加载 Feature provider | 每个 `zhin.features` 包的入口 `import` 一次，拿到 `FeatureProvider` | `root-runtime-diagnostics.ts:424-446` |
| L2 | 插件入口 | `plugin.ts` 被 `import` 并执行 `setup()`；无入口插件按包名合成定义 | `packages/im/runtime/src/plugin-scope-assembler.ts:243-249`、`:287` |
| L3 | 能力图扫描 | 只读目录、不 import，产出 `capabilityGraph.features`（供 Console / 快照展示） | `plugin-scope-assembler.ts:296`；`packages/im/runtime/src/convention-feature-scanner.ts:124-212` |
| L4 | 约定目录发现 | 对每个 provider 的每个 convention：先 `discover()` 列出源文件，**紧接着对每个源文件 `convention.load()` 再 `validate()`** | `packages/im/feature-kit/src/discovery.ts:45-75`（加载在 `:66`，校验在 `:67`） |
| L5 | 通用目录模块加载 | `directoryModules().load()` 就是 `host.loadModule(source)` 取 `default` | `packages/im/feature-kit/src/directory-module-convention.ts:36-39` |
| L6 | 模块加载器 | `NativeDevelopmentModuleRuntime.load()`：静态分析依赖（`es-module-lexer`，不执行），给 URL 加 `?zhin-generation=N` 后原生 `import()` | `packages/im/runtime/src/native-development-runtime.ts:104-138`；静态分析 `packages/im/runtime/src/module-dependency-index.ts:58`、`:228-236` |
| L7 | 投影 | provider 的 `runtime.project(slots)` 用已加载的定义建索引（`CommandIndex` / `ToolIndex` / `HandlerIndex` …） | `root-runtime-diagnostics.ts:390-392` |

热重载的三条增量路径同样在发现时立即加载：`SlotGenerationPreparer`（`packages/im/runtime/src/slot-generation-preparer.ts:43-55`，用 `selection` 只重载变动的槽，见 `discovery.ts:59`）、`SubtreeGenerationPreparer`（`subtree-generation-preparer.ts:108-113`）、`TopologyGenerationPreparer`（`topology-generation-preparer.ts:332-351`）。

结论：**L4 把「发现」和「加载」绑在同一个循环里**，所以每个约定目录文件在启动时都被 import、执行顶层代码并常驻。各类能力的实际情况不同：

| 能力 | 加载方式 | 注册（投影）时必须知道的 | 只在执行时才用到的 | 位置 |
|---|---|---|---|---|
| commands | import 模块；校验后按目录形态绑定参数 | 路由段（来自目录）、`alias`、`preferredAliasI18n`、`params` / `options`（类型、`optional`、`rest`、`default`）、`permit`、`adapter`、`shortcut`、`match`、`description`（菜单 / 帮助）、`execution` | `execute`、`reply` | provider `packages/im/command/src/provider.ts:19-40`；字段 `packages/im/command/src/definition.ts:327-378`；投影 `packages/im/command/src/command-index.ts:266-331`、菜单 `:407`；执行 `:617`、`:718` |
| handlers | import 模块 | `event`（未写时由路径推出）、`adapter` | `handle` | `packages/im/handler/src/provider.ts:13-16`；`packages/im/handler/src/handler-index.ts:52`（分桶）、`:113`（执行） |
| tools（含 `agents/*/tools`、`skills/*/tools`） | import 模块 | `description`、`keywords` / `tags`（`discover` 检索）、`inputSchema` 的 JSON Schema（给模型）、`requiresApproval` / `risk` / `permissions` / `platforms` / `requiresCapabilities` / `readOnly` / `alwaysLoaded` / `hidden`、`isAvailable`（每回合调用的函数） | `execute`；`inputSchema.safeParse`（执行前校验） | `packages/im/tool/src/provider.ts:13-37`；字段 `packages/im/tool/src/definition.ts:166-231`；`packages/im/tool/src/tool-index.ts:83`（`isAvailable`）、`:105`（`safeParse`） |
| components | import 模块 | 名字、`previewProps` | `render` | `packages/im/component/src/component-index.ts:35`、`:72` |
| middlewares / adapters / schedules / prompt-sections | import 模块 | 几乎全部（每条消息、每个回合或按 cron 都要跑） | — | 各自 `provider.ts` |
| pages / layouts | **不在 Node 里 import**：读源码，元数据在短命 worker 里用 TypeScript 解析，再用 esbuild 打成浏览器模块写到 `.zhin/client/` | 页面元数据（标题、图标、权限……） | 浏览器端代码 | `packages/console/page/src/provider.ts:35-42`；`packages/console/pagemanager/src/client-build/typescript-builder.ts:278-321`；`metadata-worker.ts:1-14` |
| skills / agents | **不 import**：读 `SKILL.md` / `agent.json` 与 Markdown 文本 | 全部（文本本身） | — | `packages/im/skill/src/provider.ts:51-53`；`packages/im/agent-feature/src/provider.ts:38-40`、`:96`、`:111` |

所以反馈里「页面在启动时被加载」只说对了一半：页面不进 Node 模块图，代价是启动时的打包 CPU 和 esbuild 子进程；真正进模块图的是 commands、tools（尤其是技能 / 子 Agent 私有工具）、handlers、components、middlewares、adapters。

注册期必须执行模块代码的另外几个原因：

- **函数或对象字段**：`params.*.default` 可以是函数（`definition.ts:67-69`、`:96`），`shortcut` 的预填值也可以是函数；`match` 是 `RegExp`；`tools.isAvailable` 是每回合调用的函数；`inputSchema` 是带 `safeParse` 的 Schema 对象（`packages/im/tool/src/input-schema.ts:35-39`）。
- **校验报错**：`parseCommandDefinition()`（`definition.ts:616-629`）、参数目录规则（`provider.ts:133-228`）和路由冲突、`assertParameterSegment`（`command-index.ts:331`）都在启动时报错；ADR 0040 §3 试跑把「`PluginScopeAssembler` 不抛错、声明的指令 / 工具可被发现」当作通过条件。
- **工厂导出**：本仓库 219 个命令里有 54 个（约 25%）的 `default` 不是字面量 `defineCommand({...})`，而是工厂产物（例如 `plugins/adapters/discord/commands/discord/endpoint/list/index.ts:3` 的 `export default discordEndpointCommands.list`），描述、权限只有执行模块后才知道。

另外有两处现成的接口没人用：`FeatureProvider.build?: FeatureBuildAdapter`（`packages/im/feature-kit/src/provider.ts:108-123`）在仓库里没有任何实现；插件打包时 `prepack` 已经会跑 `scripts/build-plugin-runtime-entries.mjs`，把约定目录里的 `.ts` 逐个转成 `.js`（`scripts/build-plugin-runtime-entries.mjs:7-21`、`:24-60`），可以顺带产出清单。

### 1.2 官方包的发布形态

官方包都是 `tsc` 逐文件输出到 `lib/`：`@zhin.js/agent`（`build: tsc`，`files: ["lib"]`，21 个 exports 子路径）、`zhin.js`（19 个子路径）、`@zhin.js/core`、`@zhin.js/ai`（各 10 个）。`development` 条件指向 `src/`，生产走 `lib/`。`check:api-surface` 读的是 `src/index.ts` 的导出语句（`scripts/check-api-surface.mjs:7-20`），typedoc 的入口也全是 `src/`（`typedoc.json` `entryPoints`），都不读 `lib/`。

### 1.3 现状数据（本次实测）

方法：在本工作树 `pnpm exec turbo run build --filter='test-bot^...'`（先 `minimal-bot^...` 44 个包约 67 秒，再补 48 个包约 53 秒；增量构建，冷缓存合计约 2 分钟），用 `scripts/measure-instance-memory.mjs` 的同一套探针（`--standalone`、`NODE_ENV=production`、lib 产物、等待后 6 次 `gc()` 采样），另把探针加载的 URL 列表落盘按目录归类。test-bot 用 `zhin.config.example.yml`（sandbox + 14 个插件，未接 AI 模型）。单机单次采样，堆数字受 GC 时机影响，只看量级。

| 项目 | 已加载模块 | 官方框架包 | 第三方 npm | 插件约定目录文件 | 插件其他文件 | 堆（GC 后） | RSS |
|---|---|---|---|---|---|---|---|
| minimal-bot（两次） | 1645 | 1078（7.2MB 源码，含 basic/） | 约 560 | 11 | — | 104.7–104.9MB | 273–294MB |
| test-bot | 2497 | 1520（10.6MB） | 690（5.3MB） | 127（0.31MB） | 160（0.50MB） | 75.1MB | 287.8MB |

test-bot 里按包排前几位：`@zhin.js/agent` **541** 个文件（与反馈一致）、`@zhin.js/core` 122、`zhin.js` 119、`@zhin.js/ai` 115、`undici` 109、`zod` 107。实际被 import 的约定目录入口：commands 67、tools 21、middlewares 10、components 3、adapters 2、handlers 1、schedules 1。

仓库内全部插件（69 个带 `zhin` 清单的包，含示例）的约定目录入口静态计数：commands 219、pages 39、adapters 27、skills（`SKILL.md`）27、agents（`agent.json`）24、middlewares 22、components 5、schedules 4、prompt-sections 3、handlers 1、根 tools 1；另有子 Agent 私有工具约 152 个、技能私有工具约 212 个（两者路径有重叠，按 `find` 计）。

**打包对照实验**（`node --expose-gc`，只 import 一个入口，前后各 6 次 `gc()`；用仓库已有的 esbuild 0.28.1 `--bundle --packages=external --format=esm` 把包内文件合成一个，跨包依赖保持外部；三次重复）：

| 入口 | 包内模块 | 总模块 | 堆 | RSS |
|---|---|---|---|---|
| `@zhin.js/agent` `lib/index.js` | 376 | 1204 | 33.3MB | 133.4–138.0MB |
| 同上打成 1 个文件 | 1 | 829 | 30.4MB（−2.9） | 118.6–121.5MB（−12～−19） |
| `@zhin.js/core` `lib/index.js` | 76 | 381 | 11.9MB | 76.0–76.7MB |
| 同上打成 1 个文件 | 1 | 306 | 11.5MB（−0.45） | 74.9–75.6MB（约 −1.2） |

折算：**每少一个 ESM 模块，堆约省 6–8KB，RSS 约省 16–40KB**（模块记录、ScopeInfo、源码字符串的重复、文件读缓冲等；agent 的 RSS 差值噪声较大）。源码本身的字节不会因为打包而消失。

### 1.4 由数据得到的判断

1. 按 1.3 的单价，反馈场景里的 913 个约定目录文件即使**全部**不加载，也只省约 6–7MB 堆、15–37MB RSS，外加这些模块顶层创建的对象（例如工具的 zod schema）和它们独占的第三方依赖；官方包约 1500 个文件打包成几十个，约省 9–12MB 堆、25–55MB RSS。两项合计大约是 600MB 的 **5%–15%**。模块数量是一个真实的、可以收回的开销，但**不是 600MB 的主因**；本方案第一阶段必须先拿堆快照把其余部分（会话 / 记忆缓存、日志缓冲、数据库驱动、esbuild 子进程、tsx 加载器等，后两项见 #1250 `tsx-loader-for-one-jsx-file`）分清楚。
2. 两项里「官方包打包」对每个项目都生效、不改变任何语义；「惰性加载」的收益和插件数量成正比，但改变报错时机，牵动 HMR、ADR 0040 试跑和 Feature provider 协议。

## 2. 方案选项

### 方案 A：清单 + 惰性加载

**做法**：每个约定目录源文件对应一条清单记录，运行时按记录注册能力槽，槽里的定义是一个「替身」：注册元数据是真值，执行入口（`execute` / `handle` / `render`）第一次被调用时才 `import` 真模块并缓存。

- **清单内容**（每条）：`feature`、`localName`、`source`（相对包根）、`sourceHash`、`closureHash`（入口加上静态 import 闭包的内容哈希，闭包用现有的 `ModuleDependencyIndex.analyze()` 求，不执行代码，见 `module-dependency-index.ts:58`）、`engine`（zhin 引擎版本与 provider 协议号）、`metadata`（由 provider 序列化的注册字段），以及 `lazy: false` 的原因（见下）。
- **插件作者 API 不变**：`defineCommand()` / `defineAgentTool()` / `defineHandler()` / `defineComponent()` 的签名和类型都不动；类型安全照旧来自源码，清单只是运行时产物。
- **Feature provider 协议**：在 `FeatureAuthoring`（`packages/im/feature-kit/src/provider.ts:64-69`）加两个**可选**钩子：`describe(definition)` 把已校验定义转成可 JSON 序列化的元数据，返回 `undefined` 表示「这个定义不能惰性」；`hydrate(metadata, load)` 用元数据和一个记忆化的 `load()` 造出替身定义，替身必须能通过本 provider 自己的 `validate()`。没实现这两个钩子的 provider（第三方 Feature、adapters、middlewares 等）保持现在的即时加载。`FeatureDiscovery.discover()`（`discovery.ts:66`）改为：有可用清单记录且 provider 支持时走 `hydrate`，否则照旧 `load` + `validate`。
- **哪些定义不能惰性**（`describe` 返回 `undefined`，按即时加载处理）：`params` / `options` 的 `default` 是函数，`shortcut` 含函数值，工具声明了 `isAvailable`，以及任何 provider 判定无法序列化的字段。`match` 存 `source` 与 `flags`；工具的 `inputSchema` 存 `toJsonSchema()` 结果，`safeParse` 前先 `load()`。本仓库现状：219 个命令里函数默认值 0 个、`shortcut` 1 个、`match` 8 个，214 个工具里 `isAvailable` 0 个，所以绝大多数可以惰性。
- **替身加载后的漂移检查**：真模块加载后重新 `validate()` 并与清单 `metadata` 比较；不一致说明清单过期（例如绕过哈希的动态内容），本次调用拒绝并给出原因，同时请求一次 generation 重载（走现有 `RootRuntime.reload()`），不在旧路由上执行新逻辑。

**清单怎么生成**：

| 方式 | 说明 | 结论 |
|---|---|---|
| 静态分析（TypeScript AST，同 `static-metadata.ts:15-30` 的页面做法） | 不执行代码，但 25% 的命令是工厂导出，描述 / 权限来自常量、i18n 表、函数返回值时都解不出来 | 只适合作为补充，不能当唯一来源 |
| 执行一次后缓存（推荐） | 在**短命 worker 线程**里 import 每个约定目录模块、`validate()`、`describe()`，把结果写回主线程后结束 worker，模块从此不占主 isolate；先例是 Console 页面元数据 worker（`metadata-worker.ts:1-14`，空闲 2 秒释放） | 覆盖所有写法；代价是顶层代码在 worker 里多执行一次 |

生成时机：**发布的包**在 `prepack` 里生成（`build-plugin-runtime-entries.mjs` 之后），清单随包发布，`check:plugin-capability-publish` 校验 `files` 里带上它；**本地插件和没带清单的第三方包**在首次启动时由 worker 生成，缓存在 `.zhin/cache/capabilities/`。

**缓存失效**：键是 `closureHash + engine + provider 协议号`；任一不符就丢弃该条重新生成。包清单只信任 `node_modules` 里随包发布的、且 `sourceHash` 与磁盘一致的记录。

**热更新 / HMR**：

- 变更映射不受影响：`InvalidationPlanner` 用 `affectedSources()` 找受影响入口（`invalidation-planner.ts:92`），这份依赖图来自静态分析；替身入口在生成清单时就把闭包登记进 `ModuleDependencyIndex`，没真正 import 过的命令改了 helper 也能找到所属槽。
- 槽重建走现有 `SlotGenerationPreparer`（`slot-generation-preparer.ts:43-55`），新槽是新替身，旧替身的缓存随旧 generation 退役；入口 revision 和 ESM 缓存淘汰沿用 `native-development-runtime.ts:104-138`、`:240-300`，`commitGeneration(ownership.moduleSources())`（`hmr-coordinator.ts:328`）保留的来源包含替身的 `source`，惰性 import 时会用到当前 generation 的 revision。
- 一个边角：helper 已被别的入口以同一 revision 加载过、之后又改了，而替身入口还没 import——静态闭包登记能让 planner 把替身入口也标为受影响，从而换 revision；这一点需要专门的测试覆盖。
- **开发态（`--watch`）默认仍然即时加载**，第一阶段只在 `--mode production` / `--no-watch` 打开，开发者改完立刻看到错误。

**ADR 0040 兼容**：试跑运行时（§3 第 3 步）强制即时加载，「装配成功、声明的指令 / 工具可被发现」的语义不变；生效后的健康检查（§6）在 worker 里对本次变更涉及的约定目录文件做一次完整加载校验，失败照常回滚。

**报错时机变化与缓解**：语法错误、import 失败、`validate()` 失败从「启动即报」变成「首次调用才报」。缓解：

1. 清单生成本身就在 worker 里执行并校验每个模块，所以**首次启动和任何文件变更后，错误仍在启动期由 worker 报出**，只有「清单命中缓存、而运行时环境变了」（依赖被改、Node 版本变化）才会推迟。
2. 实例就绪后在 worker 里后台预检全部替身（低优先级、可关），失败写日志和 Console 关注项，并把对应命令标为不可用、回复里给出原因，不静默。
3. `zhin doctor` 增加「约定目录能力可加载」检查（同一 worker），CI 和部署前可跑。
4. 替身首次加载失败时按 ADR 0061 记录入站结局与原因，用户看到「这个指令暂时不可用」而不是沉默。

**收益估算**：按 1.3 单价，反馈场景若 commands 和技能 / 子 Agent 私有工具里约 70% 平时不被调用，约少常驻 600 个模块及其独占依赖：堆约 4–5MB、RSS 约 10–25MB，加上这些模块顶层对象，合计估 10–50MB（占 600MB 的 2%–8%）。启动时间同步缩短（少 import、少执行顶层代码），首次调用多一次 import 的延迟（单个命令通常是毫秒级）。

**风险**：清单与真模块漂移；顶层副作用在 worker 里多跑一次（需要把「约定目录模块导入时不得有副作用」写成规则并加检查）；provider 协议扩展；HMR 边角。

**迁移成本**：中到高。改动集中在 `@zhin.js/feature-kit`（协议钩子、`FeatureDiscovery`）、`@zhin.js/runtime`（清单 worker、缓存、HMR 登记）、`@zhin.js/command` / `@zhin.js/tool` / `@zhin.js/component` / `@zhin.js/handler`（各自的 `describe` / `hydrate`）、`basic/cli`（`zhin doctor`）、`scripts/build-plugin-runtime-entries.mjs`。

### 方案 B：官方包发布时打包

**做法**：官方包的 JS 改由打包器产出，类型声明仍由 `tsc --emitDeclarationOnly` 产出；`exports` 子路径一个不少，`development` 条件继续指向 `src/`。

- **打包器**：首选仓库已有依赖 esbuild 0.28.1（`packages/im/zhin`、`packages/console/pagemanager` 已依赖），**所有 exports 子路径作为同一次构建的多个入口并开启 `splitting`**，共享代码进公共 chunk。不能每个子路径单独打包：模块顶层状态（`createToken()` 生成的 Token、单例、缓存）会被复制成多份，Scope DI 会对不上。tsdown / rolldown 能更好地处理声明和 chunk 命名，但要新增开发依赖，留作开放问题。
- **跨包依赖保持外部**（`--packages=external`），所以 `@zhin.js/core` 与 `@zhin.js/agent` 之间的 `instanceof`、Token 身份不变。
- **包内现有的动态 `import()` 必须保持为独立 chunk**（splitting 下默认如此）。这些按需加载是已有的省内存手段，打进主文件会反而变大。打包前要审计每个包里的 `import.meta.url` / `import.meta.dirname` 与相对路径动态 import（粗略计数：agent 1 / 12、ai 2 / 4、zhin 2 / 8、runtime 2 / 3、pagemanager 3 / 1、gateway 3 / 3 个文件），例如 `metadata-worker.ts` 用自身模块 URL 去加载 `static-metadata`，打包后路径会变。
- **source map**：随包发布 `.map`，默认不开 `--enable-source-maps`（开了会常驻映射表，本身也吃内存），排障时由用户打开；日志里的栈帧会指向 chunk 文件名。

**对 HMR 与开发体验**：本仓库开发走 `development` 条件读 `src/`，不受影响；`node_modules` 里的包本来就不在监听范围（`packages/im/runtime/src/source-ownership.ts:43`），所以生产 HMR 也不受影响。受影响的是「在用户项目里对官方包打断点 / 改 lib 调试」，靠 source map 缓解。

**对检查与发布流程**：`check:api-surface` 读 `src/`，不受影响；typedoc 读 `src/`，不受影响；`check:architecture` 检查的是源码导入方向，不受影响。需要新增一个打包完整性检查：每个 `src` 文件恰好进入一个输出 chunk（esbuild metafile）、每个 exports 子路径都能 `import` 成功且导出名集合与 `tsc` 产物一致、产物里不残留指向 `src/` 的相对路径。发布流程只改各包的 `build` 脚本，Changesets、`publish.yml` 不变。

**收益估算**：test-bot 里官方框架包约 1520 个文件，按每包「入口数 + 少量公共 chunk」估算可降到约 60–100 个文件，少约 1400 个模块：堆约 9–12MB、RSS 约 25–55MB（占 600MB 的 4%–9%）；`@zhin.js/agent` 单包实测 RSS 少 12–19MB。启动时少约 1400 次文件解析与模块链接，冷启动也会更快。

**风险**：模块状态被复制（splitting 配置错误时）；`import.meta.url` 自引用失效；栈帧可读性下降；构建时间变长（esbuild 本身很快，主要是 `tsc` 声明输出不变）。

**迁移成本**：低到中，可以一个包一个包地切，任何一步都可以把 `build` 脚本改回 `tsc` 回滚；插件作者 API 完全不变。

### 方案 C（可选）：只对纯执行期能力做惰性，命令保持即时

**做法**：commands、handlers、middlewares 保持即时加载；只惰性化技能私有工具、子 Agent 私有工具（模型在技能激活或子 Agent 被调用前根本看不到它们，`load_skill` / `load_tool` 时才需要 schema，见 `packages/im/agent/src/plugin-runtime/deferred-capability-plan.ts:499`）和 components；页面改为首次被浏览器请求时再打包（元数据仍在启动时由 worker 读出，供导航使用）。

**收益**：仓库里私有工具约 360 个入口，是约定目录文件里占比最大的一类，而且调用频率最低，惰性收益集中在这里；页面不进 Node 模块图，延后打包主要省启动 CPU 和 esbuild 子进程的启动内存，常驻内存收益很小。技能 / 子 Agent 本身是文本，没有可惰性的模块。

**风险与成本**：比 A 小：不碰命令路由、菜单、别名冲突这些启动期校验，ADR 0040 的「声明的指令可被发现」完全不受影响；仍需要 A 的清单与 `hydrate` 机制，只是只给 `@zhin.js/tool`（私有工具）和 `@zhin.js/component` 实现。

**插件作者 API**：不变。

### 方案比较

| | A 清单 + 惰性 | B 官方包打包 | C 只惰性私有工具 / 组件 / 页面打包 |
|---|---|---|---|
| 常驻内存收益（反馈场景估算） | 10–50MB，随插件数增长 | 25–55MB，所有项目都有 | 5–25MB |
| 启动时间 | 明显缩短 | 缩短 | 小幅缩短 |
| 语义变化 | 报错推迟、漂移、HMR 边角 | 无 | 只影响私有工具报错时机 |
| 插件作者 API | 不变 | 不变 | 不变 |
| Feature provider 协议 | 新增可选钩子（`@zhin.js/feature-kit` 公开 API） | 不变 | 同 A，但只有两个 provider 实现 |
| 迁移成本 | 中到高 | 低到中，可逐包 | 中 |
| 回滚 | 关开关 | 改回 `tsc` | 关开关 |

## 3. 推荐

**先 B，后 C，再视测量结果决定是否把 A 扩到命令。**

理由：B 对每个项目都有效、不改语义、可逐包回滚，实测单包就能省十几 MB RSS；C 拿下惰性收益最大且风险最小的一块（私有工具），同时把清单 / 替身机制在小范围里跑稳；命令的惰性涉及路由校验、ADR 0040 试跑和报错时机，收益却只占几 MB 到几十 MB，应当在第 0 阶段的堆快照证明「剩下的大头确实是约定目录模块」之后再做。无论选哪项，第 0 阶段都先做：反馈的 600MB 里模块只占约 5%–15%，不先测清楚就无法验收。

## 4. 分阶段实施计划

每个阶段单独一个 PR，可独立合并、独立测量（同一台机器、同一项目、用扩展后的 `scripts/measure-instance-memory.mjs` 前后各跑 3 次取中位数）、独立回滚。版本按 `.changeset/version-policy.json` 默认 patch；新增公开 API 需要所有者批准 minor 并登记 `approvedNonPatchReleases`（见 [开发指南](../contributing/development.md) 版本策略一节）。

| 阶段 | 内容 | 改动位置 | 测试与检查 | 公开 API / 版本 | 回滚 |
|---|---|---|---|---|---|
| P0 基线与归因 | 测量脚本增加 `--breakdown`（按包 / 约定目录归类已加载模块，本文 1.3 的做法）、`--heap-snapshot`（写 `.heapsnapshot` 供归因）和 test-bot 用例说明；产出一份 600MB 量级场景的归因表 | `scripts/measure-instance-memory.mjs`；`docs/contributing/development.md` 增加用法 | 脚本自测（minimal-bot 跑通，输出字段齐全） | 无（根脚本，不发布）；不需要 changeset | 删脚本选项 |
| P1 打包试点：`@zhin.js/agent` | esbuild 多入口 + splitting 产出 JS，`tsc --emitDeclarationOnly` 产出声明；审计并修正 `import.meta.url` 自引用与相对动态 import | `packages/im/agent/package.json`（`build`）、`packages/im/agent/tsconfig.json`、新增 `scripts/bundle-package.mjs`；新增 `check:bundle-integrity`（`scripts/check-bundle-integrity.mjs`，接入 `check:all`） | agent 全量测试（`pnpm vitest run packages/im/agent`）、`check:api-surface`、`check:bundle-integrity`、`pnpm test:e2e:gateway` 一次；P0 脚本对比模块数与 RSS | 无公开 API 变化；`@zhin.js/agent` patch | `build` 改回 `tsc` |
| P2 打包推广 | 按模块数从大到小：`@zhin.js/core`、`zhin.js`、`@zhin.js/ai`、`@zhin.js/runtime`、`@zhin.js/adapter`、`@zhin.js/plugin-runtime`、`@zhin.js/command`、`@zhin.js/gateway`、`@zhin.js/host-http` 等；每批 2–4 个包 | 各包 `package.json` / `tsconfig.json` | 同 P1；full-validation 矩阵（Windows 路径） | 无；各包 patch | 逐包改回 |
| P3 清单与替身基础设施（默认关闭） | `FeatureAuthoring` 增加可选 `describe` / `hydrate`；`FeatureDiscovery` 支持清单记录；清单 worker、`.zhin/cache/capabilities/` 缓存与失效；静态闭包登记进 `ModuleDependencyIndex`；内部开关（环境变量 `ZHIN_LAZY_CAPABILITIES=1`）默认关 | `packages/im/feature-kit/src/{provider,discovery}.ts`；`packages/im/runtime/src/`（新 `capability-manifest-worker.ts`、`capability-manifest-cache.ts`，`node-discovery-host.ts`、`root-runtime-diagnostics.ts`、三个 generation preparer） | feature-kit / runtime 单测：清单命中、哈希失效、漂移拒绝、worker 失败退回即时加载、HMR 改 helper 后替身换 revision；开关关闭时全量测试不变 | `@zhin.js/feature-kit` 新增公开可选字段，需所有者批准 **minor**；`@zhin.js/runtime` patch | 开关默认关，无需回滚代码 |
| P4 方案 C 落地 | `@zhin.js/tool` 为私有工具实现 `describe` / `hydrate`（`safeParse` 前先加载）；`@zhin.js/component` 同样；生产模式默认开启，开发态与 ADR 0040 试跑强制即时；就绪后 worker 后台预检，失败进日志、Console 关注项与 ADR 0061 结局 | `packages/im/tool/src/provider.ts`、`definition.ts`；`packages/im/component/src/provider.ts`；`packages/im/agent/src/self-change/trial.ts`（强制即时）；`basic/cli/src/commands/doctor.ts`（新增检查） | 工具：未激活技能的私有工具不在模块列表里、激活后可用、schema 一致；`zhin doctor` 能报出坏模块；ADR 0040 试跑回归测试 | 生产默认行为变化；若新增配置项（见开放问题 2）则 `@zhin.js/runtime` 的配置 schema 属公开 API，需 minor；否则 patch | 关开关 |
| P5 发布时清单 | `prepack` 生成 `zhin-capabilities.json`；`check:plugin-capability-publish` 校验 `files` 包含清单且与源码哈希一致 | `scripts/build-plugin-runtime-entries.mjs`、`scripts/check-plugin-capability-publish.mjs`；官方插件 `package.json#files` | 打包产物测试（`pnpm pack` 后解包核对清单）；首次启动不再起清单 worker | 清单文件格式写进文档，属新公开约定，需所有者确认版本级别 | 删除清单文件即退回 worker 生成 |
| P6（视 P0 结果）命令惰性 | `@zhin.js/command` 实现 `describe` / `hydrate`；菜单、别名、`permit` 从清单投影，`execute` / `reply` 走替身 | `packages/im/command/src/provider.ts`、`definition.ts`、`command-index.ts` | 路由冲突、参数目录规则仍在启动期由清单 worker 报错；命令首次调用延迟测量 | 同 P4 | 关开关 |
| P7（可选）页面延后打包 | `TypeScriptClientBuilder.load()` 启动时只读元数据，`bundlePageEntry` 推迟到首次请求 `/assets/client/*` | `packages/console/pagemanager/src/client-build/typescript-builder.ts:278-321`；`packages/im/zhin/src/instance/console/host.ts` | Console 页面首访与刷新、页面 HMR | 无；patch | 恢复启动时打包 |

验收口径（每阶段 PR 描述里写明）：已加载模块数、GC 后堆、RSS、冷启动到就绪的时间，各给前后中位数；P4 及以后再加「首次调用延迟」。

## 5. 不做的事

- 不改 `defineCommand()` / `defineAgentTool()` / `defineHandler()` / `defineComponent()` / `definePage()` 的签名，不要求插件作者手写清单。
- 不惰性化 adapters、middlewares、schedules、prompt-sections 和 `plugin.ts` 里 `setup()` 注册的能力。
- 不把约定目录文件打进官方包的 bundle（它们必须按目录被发现）；方案 B 只处理官方包的 `lib/`。
- 不用纯静态分析作为清单的唯一来源。

## 6. 开放问题（需要所有者拍板）

1. **是否先做 P0 归因再投入 A / C？** 实测与估算表明模块只占 600MB 的约 5%–15%；如果所有者希望直接解决 600MB，需要同时立项排查其余部分。
2. **惰性加载的开关形态**：只用内部环境变量；还是在 `zhin.config.yml` 增加配置项（例如 `runtime.lazyCapabilities: off | production | always`），后者是配置 schema 的公开变更，需要 minor 批准。
3. **默认范围**：生产模式默认开启、开发态默认关闭，是否接受？ADR 0040 试跑强制即时，是否接受？
4. **报错推迟的处理**：后台预检失败时只告警，还是把该能力标为不可用（推荐）、甚至让该插件的 generation 失败？
5. **清单漂移的处理**：替身加载后发现与清单不一致时，拒绝本次调用并重载 generation（推荐），还是直接用新定义执行？
6. **打包工具**：用已有依赖 esbuild（推荐），还是新增 tsdown / rolldown 开发依赖？
7. **source map**：随包发布 `.map`（包体变大约一倍）是否接受？是否需要在 `zhin doctor` 或文档里说明如何打开 `--enable-source-maps`？
8. **Feature provider 协议**：在协议 1 上加可选钩子（`@zhin.js/feature-kit` minor），还是升协议 2？
9. **第三方插件**：是否要求它们在发布时生成清单（改 `zhin plugin` 发布模板），还是只靠首次启动的 worker 缓存？
10. **约定目录模块的「导入无副作用」规则**：清单 worker 会多执行一次顶层代码；是否把这条写进插件规范并在 `check:plugin` / `zhin plugin check` 里检查？
11. **handlers 是否纳入惰性**：常用事件（如 `message.receive`）的 handler 第一条消息就会加载，收益很小；建议不纳入。
