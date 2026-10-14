# 插件作者本地联调指南

本页面向在**自己的 Bot 项目**里联调本地插件（或 zhin 源码）的作者，汇总最常见的三类问题：依赖来源混用、本地与已发布版本不一致、端口与退出不干净。内容以当前 `main` 的实现为准。

## 1. 依赖来源：`link:` / `workspace:` 与 npm 不要混用

Zhin 在一个 generation 内要求**同一个包只有一个物理位置**。项目图（`packages/im/runtime/src/project-graph.ts`）在遍历 Root 插件、子插件及其声明的 Feature（如 `@zhin.js/command`、`@zhin.js/tool`）时：

1. 从**声明方插件自己的目录**出发解析每个依赖包；
2. 对包根目录做 `realpath`；
3. 同名包若出现两个不同的根目录，直接抛出：

```text
zhin: Multiple package locations for @zhin.js/command are not supported in one generation
```

即使两份代码版本号相同（例如都是 `1.1.5`），只要磁盘位置不同，就是两个模块实例：Token、品牌标记、`instanceof` 都不互通，所以这是**有意的硬错误**，不是误报。

### 典型触发方式

Bot 项目大部分依赖来自 npm，却把某个插件用 `link:` 指向另一个 zhin 源码仓库：

```json
{
  "dependencies": {
    "zhin.js": "latest",
    "@zhin.js/plugin-calendar": "link:../zhin/plugins/utils/calendar"
  }
}
```

被链接的插件在源码仓库里把 `@zhin.js/command` 声明为 `workspace:*` / `workspace:^`，于是它解析到**源码仓库**的 `packages/im/command`，而其他插件解析到项目 `node_modules/.pnpm` 里的 npm 版本。

### 诊断

```bash
# 1. 看有哪些包依赖它、是否出现多个版本或变体
pnpm why @zhin.js/command

# 2. 看 link 进来的插件实际解析到哪里（逐个替换插件路径）
readlink -f node_modules/@zhin.js/plugin-calendar/node_modules/@zhin.js/command
readlink -f node_modules/.pnpm/node_modules/@zhin.js/command

# 3. 找出所有 link / file / workspace 依赖
grep -nE '"(link|file|workspace):' package.json plugins/*/package.json
```

若第 2 步的两个路径不同（一个在别的仓库的 `packages/im/command`，一个在 `.pnpm/@zhin.js+command@x.y.z`），就是本问题。`node_modules/.pnpm` 里残留多个历史版本目录本身无害，以实际解析路径为准。

## 2. 本地源码与已发布 zhin.js 不一致

即使解决了多副本问题，本地插件也可能依赖**尚未发布**的 zhin.js 能力。常见症状：

- 加载插件时报 `TypeError: Schema....effect is not a function`（本地 Schema API 比 npm 版新）；
- 启动时报 `Invalid Plugin config ... must NOT have additional properties (additionalProperty: xxx)`：插件配置 Schema 未能按本地写法生效，或 npm 上同名插件是旧版本、没有这些字段。

判断方法：对比插件 `peerDependencies` 与项目实际安装的版本，并确认所用 API 是否已在发布版中：

```bash
node -p "require('./node_modules/zhin.js/package.json').version"
npm view zhin.js version
npm view <插件包名> version peerDependencies
```

## 3. 推荐做法：在 zhin 仓库内开发插件

需要用到**未发布**的框架能力、或同时改框架与插件时，最省心的方式是直接在 zhin 源码仓库（monorepo）里开发：插件放在 `plugins/<分类>/<名字>`，测试 Bot 放在 `examples/<名字>`，所有 zhin 依赖都写 `workspace:*`。整个工作区只有一条解析路径，天然不会出现第 1 节的多副本错误，也不需要维护 overrides 列表。

```bash
git clone https://github.com/zhinjs/zhin.git && cd zhin
pnpm install
# 新插件：plugins/utils/my-plugin（package.json 中 zhin.js、@zhin.js/* 写 "workspace:*"）
# 测试 Bot：复制 examples/minimal-bot 为 examples/my-bot，在其依赖里加
#   "@zhin.js/plugin-my-plugin": "workspace:*"
# 并在 package.json 的 zhin.plugins 与 zhin.config.yml 中声明
pnpm install
pnpm build
cd examples/my-bot && pnpm exec zhin runtime start --once
```

已在当前 `main` 上验证：`examples/test-bot`、`plugins/utils/calendar` 中的 `@zhin.js/command` 都解析到同一个 `packages/im/command`；`examples/minimal-bot` 在 `pnpm build` 后执行 `zhin runtime start --once` 输出 `"started": true`。

其他方式对比：

- **`pnpm link` / `link:` 单个插件**：不推荐。被链接插件的 `workspace:` 依赖会解析到源码仓库，正是第 1 节错误的成因。
- **yalc**：本质与 tarball 相同（复制发布产物），不能使用未发布的框架 API，且需额外安装工具；未在本仓库验证。
- **tarball（见下表）**：适合在**自己的外部项目**里试用本地插件、框架仍用 npm。
- **`pnpm zhin:local link`**：外部项目需要使用本地框架时的推荐方式（见第 4 节），自动生成全部 tarball overrides 并可一键恢复；手写 `pnpm.overrides` 作为兜底。

## 4. 外部项目的三种可行组合

| 方案 | 做法 | 适用 | 注意 |
|------|------|------|------|
| 全部 npm | 插件也用已发布版本（`^x.y.z`） | 日常运行、生产 | 只能用已发布的 API 与配置字段 |
| 全部本地 | 推荐 `pnpm zhin:local link`（见下文）；或手动用 `pnpm.overrides` 把 `zhin.js` 及所有 `@zhin.js/*` 统一指向同一个本地源码仓库（`link:`），并先在源码仓库 `pnpm build` | 同时改框架与插件 | 所有 zhin 包必须来自**同一个**仓库；漏掉一个就会回到第 1 节的错误 |
| 打包 tarball | 在插件目录 `pnpm pack`（会把 `workspace:` 改写成真实版本），项目里依赖 `file:./vendor/xxx.tgz` | 只想试用本地插件、框架用 npm | 插件不能依赖未发布的框架 API；每次改动需重新打包并 `pnpm install` |

**外部项目推荐用一键命令**代替手写 overrides。在 zhin 源码仓库根目录执行：

```bash
pnpm zhin:local link ../my-bot     # 检测项目用到的 zhin.js / @zhin.js/*，构建并打包完整依赖闭包，写入 tarball overrides，执行 pnpm install
pnpm zhin:local unlink ../my-bot   # 原样恢复 package.json 与 pnpm-lock.yaml，再执行 pnpm install
```

- 本地源码改动后再次执行 `link` 即可重新构建并刷新 tarball（幂等）；
- 备份与 tarball 存放在项目内的 `.zhin-local/`，建议加入项目的 `.gitignore`；
- `package.json`/`pnpm-lock.yaml` 有未提交改动、已有 zhin 相关 `pnpm.overrides`、或 link 后 `package.json` 被手动修改时，命令会拒绝执行并说明原因；
- 所有 zhin 包来自同一份打包产物，不会出现第 1 节的多副本错误。

无法使用该命令时，可手写 `pnpm.overrides`（`link:` 指向同一个源码仓库），但必须覆盖项目依赖闭包中的**全部** zhin 包（含 `@zhin.js/runtime` 等间接依赖）。

修改后执行 `pnpm install`，再用第 1 节的命令确认每个包只有一个解析路径。

临时停用某个插件时，需要同时移除 `package.json` 的依赖、`zhin.plugins` 中的声明，以及 `zhin.config.yml` 里 `plugins.<instanceKey>` 配置（否则会报 `/plugins must NOT have additional properties`）；可以把配置注释保留以便接回。

## 5. 端口与干净退出

控制面默认监听 `http.host`/`http.port`（未配置时为 `127.0.0.1:8086`）。启动报 `EADDRINUSE` 时先找占用者：

```bash
lsof -nP -iTCP:<端口> -sTCP:LISTEN
```

只结束你确认属于自己的进程（按 PID），避免 `pkill -f "zhin runtime start"` 误伤其他项目的实例。

当前进程的退出行为：

- **Ctrl+C（SIGINT）/ SIGTERM / SIGHUP**：开始优雅停止，依次关闭 HTTP/WS 监听、Runtime（适配器、插件资源）、调度、数据库，正常结束退出码为 `0`，端口随之释放。
- **5 秒未停完**：stderr 输出一行 `{"forcedExit":"budget","stillStopping":[...]}` 指出仍在停止的组件，并强制退出（SIGINT `130`、SIGTERM `143`、SIGHUP `129`）。
- **停止期间再次 Ctrl+C**：立即退出（`130`），输出 `"forcedExit":"repeated-signal"`。
- **Console 重启 / 依赖变更需要重启**：完整停止后以退出码 `75` 自然退出，由 supervisor 重新拉起；插件管理操作进行中时不会被依赖变更打断，由管理流程的“应用/重启”步骤统一触发。
- 终端或脚本会话关闭会发送 SIGHUP，同样触发优雅停止；后台长期运行请使用 `--daemon` 或进程管理器。

插件自己的定时器、连接要在 dispose 中释放；dispose 永不完成会被 5 秒预算强制结束，并在 `stillStopping` 中显示为 `runtime`。

## 6. 联调检查清单

- [ ] `grep` 出的 `link:`/`file:`/`workspace:` 依赖都在预期内；
- [ ] `pnpm why @zhin.js/command`（及 `zhin.js`、`@zhin.js/tool` 等）每个包只有一个实际解析路径；
- [ ] 本地插件用到的 API 与配置字段在当前安装的 zhin.js 版本中存在；
- [ ] 优先在 zhin 仓库内开发（全 `workspace:*`）；外部项目则选定一种组合（全 npm / tarball / `zhin:local link`），没有混用；
- [ ] 修改依赖后执行了 `pnpm install`，本地源码改动后执行了 `pnpm build`；
- [ ] 启动前确认端口空闲，旧实例已按 PID 停止；
- [ ] Ctrl+C 后 5 秒内退出且无 `forcedExit` 输出；若有，按 `stillStopping` 排查对应组件的释放逻辑。
