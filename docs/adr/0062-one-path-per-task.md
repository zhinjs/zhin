---
sidebar: false
---

# ADR 0062：每件事只留一条路——重复入口清单与收敛建议

状态：已接受（Accepted，2026-11-14）。所有者决定：总原则 Q0a–Q0c 与 Q1–Q25 **全部按推荐处理**，见文末「决定」；被否决的替代选项保留在同一张表里作为记录。另有一条与 ADR 0061 共同的决定（IM 回合审批接入 `ToolApprovalQueue`），见「决定」表后的说明。

关联：
- [ADR 0049](./0049-console-rbac.md)（Console 访问控制）
- [ADR 0050](./0050-layered-feature-config.md) / [ADR 0055](./0055-conversation-feature-config.md)（功能分级覆盖）
- [ADR 0052](./0052-console-information-architecture.md)（Console 信息架构）
- [ADR 0053](./0053-console-onboarding.md)（Console 引导）
- [ADR 0054](./0054-management-gateway.md)（管理网关）
- [ADR 0056](./0056-chat-roles.md)（聊天角色）
- [ADR 0057](./0057-config-storage.md)（配置与状态存放）
- [ADR 0059](./0059-gateway-storage-isolation.md)（网关存储隔离）
- [ADR 0061](./0061-inbound-message-outcomes.md)（每条入站消息都有结局与原因）
- ADR 0060（聊天身份与角色的唯一事实来源）：在 #1250 批次分支上已接受，尚未合入本分支，所以这里不加链接。

来源：issue zhinjs/zhin#1250 的真实部署反馈（文中的 `代号` 都是该 issue 里的条目代号）。

编号说明：0060 已被聊天身份 ADR 使用，0061 留给并行起草的「消息结局」ADR。本 ADR 取当前索引最大编号（0059）+ 3，也就是 0062，中间留出空隙，避免并行提交时撞号。

## 背景

所有者的目标是**每件事只留一条路，其余的删掉或者标为高级用法**。

#1250 里有很多困惑不是因为某个功能坏了，而是同一件事有好几个入口，这些入口之间不同步。归纳下来有四种情况：

1. **种子文件被悄悄忽略。** yml 里的 `endpoints`、`ai.plan.yml`、`assistant.profile.yml` 只在第一次启动时导入数据库，之后再改不会生效，也没有提示（`endpoint-config-drift`、`profile-routine-toggle-not-synced`、`host-account-add-path`）。
2. **文档之间互相矛盾。**
   - 快速开始说「在 Console 里完成初始化」（`docs/getting-started/index.md` 第 2 节），配置参考第一段却说「第一次配置时，先运行 `npx zhin setup`」（`docs/configuration/index.md:10`）。
   - `docs/ai/index.md:29` 说 `ai.plan.yml` 首次启动会自动导入；自动生成的 `docs/configuration/generated.md:480` 却说它「不会自动加载」。
   - 脚手架 FAQ 让用户改 `ai.agents.zhin.model`，这个字段已经废弃（`scaffold-faq-model-source`）。
3. **CLI 和 Console 各有一套，能力还不一样。** 例子：
   - `zhin install` 和 `zhin packages install` 是两套安装命令（`packages-list-misleading`）。
   - `zhin config set` 会把敏感字段写成明文，Console 不会（`config-set-secret-plaintext`）。
   - Sandbox 账号在 Console 里没法管理，只能用 CLI 把整个数组覆盖掉（`sandbox-endpoint-no-console-management`）。
4. **旧别名一直不删。** 例如 `zhin runtime start`、`zhin add`、`--no-watch`、六种配置文件名、带连字符的旧命令名。它们没有弃用期，也没有删除计划，所以文档和 AI 知识库会继续引用它们。

### 盘点范围与判定口径

- **基线**：`feat/friendly-volta-ejc3wl` @ `3fa46a02b`。#1250 批次里已有、但还没合入这个基线的修复，在下文标为「（批次中）」。
- **读过的资料**：
  - `README.md` / `README.zh-CN.md`
  - `docs/` 下的快速开始、配置、CLI、Console、AI、路径、方案页
  - CLI 命令注册：`basic/cli/src/cli.ts`、`basic/cli/src/commands/*.ts`
  - Console 路由：zhinjs/console `console-ui/src/console-routes.mjs`，以及相关页面
  - 配置 Schema：`docs/configuration/generated.md`
  - 脚手架：`packages/toolkit/create-zhin`、`packages/toolkit/scaffold-wizard`
- **什么算「重复入口」**：满足下面任一条就算。
  - 同一个用户意图，有两个或更多**可写**入口；
  - 同一个对象有两个或更多**事实来源**；
  - 同一个对象在同一个界面里有两个或更多可编辑位置。
- **什么不算**：
  - **分层覆盖**（全局 / 适配器 / 账号 / 会话，以及模型的部署 / 账号 / 场景 / 个人选择）。每一层是不同的意图，只要每一层只有一个入口就不算重复。
  - **同一后端操作的多个前端**，例如 Console 功能页和聊天里的「功能 设置」。只要它们走同一个 RPC、写同一个存储，并且新用户文档只教其中一个，就不算重复（见原则 R4）。

## 盘点：25 项重复入口

每一项都按同样的格式写：
- 表格：用户意图、现有入口、事实来源与同步关系、困惑证据；
- 「推荐」：唯一推荐路径（已按文末「决定」Q1–Q25 定稿）；
- 「其余」：其余入口怎么处理，分三种——**删除**、**高级**（保留，但在 UI 和文档里降级，只出现在「高级用法」里）、**种子**（保留为只读导入种子，有差异时显式提示）；
- 「迁移」和「文档」：需要的迁移与兼容，以及对新用户文档的影响。

### A. 运行与运维

#### 1. 启动 Bot

| 项 | 内容 |
| --- | --- |
| 意图 | 把 Bot 跑起来 |
| 入口 | `zhin start`（后台）、`zhin start --foreground`、`zhin start --once`、`zhin runtime start`（`basic/cli/src/commands/runtime.ts:41`，`--foreground` 的别名）、`zhin start --standalone`（仅开发 / 测试）、`pnpm dev`（`--foreground --watch source config`）、`pnpm start`（`--foreground --mode production --no-watch`）、`--no-watch`（兼容参数） |
| 事实来源 | 都是同一个网关加实例，只是参数组合不同；`--standalone` 不经过网关，没有受管重启 |
| 证据 | README 的注释写 `pnpm dev # zhin start --foreground`，快速开始写的是 `--watch source config`；`restart-gateway-foreground`；`start-bg-no-setup-link`（后台启动不打印带令牌的链接） |

- **推荐**：开发时用 `pnpm dev`，服务器上用 `zhin start`。
- **其余**：
  - `--foreground`：高级（给进程管理器用，由 `pnpm start` 和服务文件封装）。
  - `zhin runtime start`：删除，先弃用一个 minor。
  - `--standalone`：在 `--help` 里隐藏，只给测试用。
  - `--no-watch`：删除，不传 `--watch` 本来就是不监听。
- **迁移**：`runtime start` 和 `--no-watch` 先打印一次弃用告警，下一个 major 删除；后台 `zhin start` 在 Console 还没初始化时打印 `#token=` 链接。
- **文档**：快速开始只写 `pnpm dev` 和 `zhin start`。README 注释与快速开始保持一致。

#### 2. 托管与开机自启

| 项 | 内容 |
| --- | --- |
| 意图 | 让 Bot 常驻、开机自启 |
| 入口 | 脚手架在项目根目录一次生成 5 套方案：<br>① pm2（devDependency + `ecosystem.config.cjs` + 6 个 `pm2:*` 脚本，`packages/toolkit/create-zhin/src/workspace.ts:127-132`、`:303`）<br>② `com.zhinjs.<name>.plist`（`:197`）<br>③ `<name>.service`<br>④ `<name>-task.xml`（`:251`）<br>⑤ `install-service.ps1`（`:247`）<br>另外还有 `zhin service install`，生产文档里还有 Docker 方案 |
| 事实来源 | 都是外部进程管理器，彼此不知道对方存在；`zhin stop` 也不认识 launchd / systemd |
| 证据 | `scaffold-service-file-clutter`（新手不知道该用哪个、哪些能删）；`service-keepalive-vs-stop`（`KeepAlive: true` 时 `zhin stop` 停不下来）；`service-plist-npx-path` |

- **推荐**：`zhin service install`，按当前系统在现场生成服务文件。
- **其余**：
  - 脚手架默认不再生成任何服务文件，也不再加 pm2 依赖。
  - pm2 改成 `create-zhin-app --with pm2` 的可选项，属于高级。
  - Docker 留在生产部署文档的高级用法里。
- **迁移**：老项目里已有的文件不动；`zhin doctor` 提示「这些文件可以删除，改用 `zhin service install`」；`zhin stop` 检测到进程由服务托管时，提示改用 `zhin service stop`。
- **文档**：快速开始不出现任何守护方案；生产部署页只写 `zhin service install`，其余放进高级用法。

#### 3. 查看运行状态与日志

| 项 | 内容 |
| --- | --- |
| 意图 | 看 Bot 是不是在跑、为什么不回复 |
| 入口 | `zhin status`、`zhin watch`（定时刷新的面板）、`zhin doctor --live`、`zhin packages status --live`、`zhin logs`、Console 首页 / 实例页 / 日志页、直接读 `.zhin/logs/instance.log` 和 `gateway.log` |
| 事实来源 | `status` / `logs` 走网关控制套接字；`watch`、`doctor --live`、`packages status --live` 走 HTTP 加 API 令牌；Console 走网关 HTTP。三种传输方式，看到的字段和措辞各不相同 |
| 证据 | `logs-two-formats-ansi`、`logs-mixed-kv-styles`、`logs-cli-no-filter`、`console-offline-no-reason`、`hmr-status-generation-stale` |

- **推荐**：普通用户看 Console 首页和日志页；运维用 `zhin status [--json]` 和 `zhin logs`。
- **其余**：
  - `zhin watch`：合并为 `zhin status --watch`，然后删除。
  - `zhin doctor --live`：合并为 `zhin status --json --host <url>`，然后删除。
  - `packages status`：保留，它回答的是插件级问题，不重复；但要改到统一的插件命令下（见第 11 项）。
- **迁移**：两个命令先改成转发并打印告警，一个 minor 之后删除。日志统一成一种格式，CLI 和 Console 共用。
- **文档**：快速开始只提「Console 首页」和 `zhin status`。

#### 4. CLI 怎样连到运行中的实例（凭据）

| 项 | 内容 |
| --- | --- |
| 意图 | 让 CLI 操作正在运行的 Bot |
| 入口 | 本地控制套接字 `.zhin/gateway.sock`（`start` / `stop` / `status` / `logs` / `install` / `enable` / `console`）；HTTP 加 `ZHIN_CONSOLE_TOKEN`（`config` / `schedule` / `send` / `watch` / `packages --live` / `doctor --live`）；`--token-env <name>`；回退到配置里的 `http.token`（`docs/cli/index.md:189`，`basic/cli/src/utils/host-http.ts:59`） |
| 事实来源 | 各命令自己决定走哪条通道。网关不在时，HTTP 会退回到「按配置端口连接」 |
| 证据 | `cli-falls-through-to-other-project`（项目 B 的网关没启动时，命令打到了项目 A，可能改错项目的配置）；`doctor-http-token-after-init` |

- **推荐**：本机操作一律走控制套接字；远程操作必须显式写 `--host <url>`，再配一个 API 令牌（`ZHIN_CONSOLE_TOKEN`）。
- **其余**：
  - 退回 `http.token`：删除。初始化之后它本来就会被拒绝。
  - 没写 `--host` 时退回 HTTP：删除，改为直接报「本项目网关未运行」。
  - `--token-env`：高级。
- **迁移**：属于行为变更。先在 minor 里打印告警，并在连上后核对对方的项目根目录 / 实例 id；下一个 minor 改为报错（方向已由 Q4 决定；每次 minor 发版仍按 `.changeset/version-policy.json` 由所有者批准）。
- **文档**：CLI 参考的「操作运行中的 Bot」改成「本机：直接用；远程：`--host` + API 令牌」。

#### 5. 诊断与修复

| 项 | 内容 |
| --- | --- |
| 意图 | 「哪里不对，帮我修」 |
| 入口 | `zhin doctor`（别名 `health`）、`zhin doctor --fix`、`zhin doctor --upgrade-l4`、`zhin config check`（别名 `validate`）、`zhin config check --fix`、Console 自检页 `/ops/self-check`、Console「需要你处理」 |
| 事实来源 | `doctor` 和 `config check` 各自实现配置检查，两个 `--fix` 修的范围不一样 |
| 证据 | 快速开始、配置参考、CLI 参考分别推荐 `doctor` 和 `config check`；`doctor-fix-noop-silent`、`doctor-duplicate-stale-store` |

- **推荐**：`zhin doctor`，加 `--fix` 修复。浏览器里看 Console「需要你处理」。
- **其余**：
  - `zhin config check`：高级，给 CI 用（`--strict --json`），内部和 `doctor` 共用同一份检查。
  - `config check --fix`：并入 `doctor --fix`。
  - 别名 `health`、`validate`：删除。
- **迁移**：别名先打印告警，一个 minor 之后删除；`config check --fix` 先改为转发。
- **文档**：所有页面「遇到问题」一节只写 `npx zhin doctor`。

#### 6. 升级 Zhin

| 项 | 内容 |
| --- | --- |
| 意图 | 把项目升级到新版本 |
| 入口 | `zhin migrate`、`zhin migrate instances`（配置升到 v2）、`zhin migrate inference`（旧 AI 配置）、`zhin runtime migrate`（插件能力代码迁移）、`zhin console migrate`（Console 账号库）、`zhin config check --fix`、`zhin update`（依赖更新）、启动时的自动迁移（功能覆盖、聊天角色） |
| 事实来源 | 每个迁移各自记录进度；用户要自己判断该跑哪个 |
| 证据 | `migrate-no-actual-upgrade`、`migrate-writes-latest`、`migrate-ignores-overrides`、`migrate-legacy-scaffold-files`（迁移会补出新脚手架已经不生成的文件）；README 顶部有两段不同的升级提示 |

- **推荐**：`zhin migrate`（先 `--dry-run`）作为唯一的升级入口。它检测项目状态，按顺序编排需要的子迁移：依赖、配置 v2、AI、Console 账号库。
- **其余**：
  - `migrate instances`、`migrate inference`、`console migrate`：高级，保留为子步骤（单独重跑、回滚）。
  - `runtime migrate`：它是插件作者用的代码迁移，改名到插件开发命令组（见第 12 项）。
  - `zhin update`：保留。它管第三方依赖，意图不同，文档里要写清楚和 `migrate` 的区别。
- **迁移**：`zhin migrate` 先加上编排能力（minor），子命令保持不变。
- **文档**：升级页只写 `zhin migrate --dry-run` 然后 `zhin migrate`；子命令放进「出问题时」。

### B. 项目与初始化

#### 7. 首次配置（数据库、所有者、AI、平台）

| 项 | 内容 |
| --- | --- |
| 意图 | 新项目配到能用 |
| 入口 | `create-zhin-app` 的问答和 `--adapter` / `--ai` / `--database` 参数；Console 引导 `/onboarding`（ADR 0053）；`zhin console init`；`zhin setup` 及其 `--database` / `--adapters` / `--ai` / `--bootstrap` / `--locale` / `--global` / `--decisions`；`zhin onboard`（`basic/cli/src/commands/onboard.ts:339`，描述也是「引导与配置向导」） |
| 事实来源 | Console 引导走网关服务（`packages/host/gateway/src/onboarding/`）。`zhin setup` 复用 scaffold-wizard，直接写 yml 和 `.env`。`zhin onboard` 是另一套向导 |
| 证据 | 快速开始第 2 节说在 Console 里初始化，却又说「AI 这一页先跳过，之后再用 `npx zhin setup --ai` 或 Console 打开」（`docs/getting-started/index.md:43`），「下一步」又让用户 `npx zhin setup --adapters`（`:173`）。配置参考第一句是「先运行 `npx zhin setup`」（`docs/configuration/index.md:10`）。`console-init-default-db-restart` |

- **推荐**：Console 引导（`create-zhin-app` → `pnpm dev` → 打开链接）。
- **其余**：
  - `zhin console init`：高级，给没有浏览器的服务器和容器用。
  - `zhin setup`：降为高级。交互式向导弃用，只保留非交互参数（`-y --adapter … --enable-ai --install`）给自动化用；`--bootstrap` 见第 18 项，`--locale` 改由 `zhin config set locale` 完成。
  - `zhin onboard`：删除。
  - `create-zhin-app --adapter / --ai / --database`：高级，给脚本用。
- **迁移**：
  - `onboard` 先打印告警，一个 minor 之后删除。
  - `setup` 在 `public-api-surface` 中是 `stable`，交互模式要到下一个 major 才能删除；在那之前，运行时提示「推荐在 Console 完成」。
- **文档**：快速开始、路径页、客户手册、适配器页、AI 总览里的 `zhin setup` 一律换成 Console 的对应页面，CLI 写法挪进「高级：无浏览器环境」。

#### 8. 配置文件名

| 项 | 内容 |
| --- | --- |
| 意图 | 写项目配置 |
| 入口 | 可以用六种文件名：`config.yml` / `config.yaml` / `config.json` / `zhin.config.yml` / `zhin.config.yaml` / `zhin.config.json`（`packages/im/plugin-runtime/src/root-config-file.ts:1-8`）；同时存在多个时报错 |
| 证据 | 文档说「建议统一用 `zhin.config.yml`」，但 Console 文件白名单、CLI 和 AI 自我变更都要同时支持六种 |

- **推荐**：只用 `zhin.config.yml`。
- **其余**：另外五种名字全部删除。
- **迁移**：启动时遇到其他名字给出告警，`zhin doctor --fix` 负责改名；下一个 major 不再接受。
- **文档**：「配置文件的位置」一节只写 `zhin.config.yml`。

### C. 插件

#### 9. 插件配置（全局默认值）

| 项 | 内容 |
| --- | --- |
| 意图 | 改某个插件的设置 |
| 入口 | 手改 `zhin.config.yml`；Console「运维 → 配置」`/ops/config`；Console「功能 → 全局」`/features/global/:plugin`（两页都渲染同一个 `PluginConfigForm`，见 zhinjs/console `pages/config.tsx:230`、`pages/features/global-config.tsx:87`）；Console 文件编辑 `/ops/files` 直接改 yml；Console 用途流程 `/use-cases/group-welcome`；`zhin config set`；聊天里私聊发 `config set`；AI 自我变更 `config_patch`（`packages/im/agent/src/plugin-runtime/native-self-change-tools.ts:100`）；`zhin setup` |
| 事实来源 | yml 是事实来源（ADR 0057），写入都经过网关配置事务（`/ops/files` 除外，它是整文件写入）。各入口的校验范围不一样：聊天只能改「聊天安全」的叶子字段；CLI 曾经会把敏感字段改成明文 |
| 证据 | `config-set-secret-plaintext`、`console-config-form-labels`、`config-apply-status-internal-ids`、`config-cli-internal-errors`；Console 里同一个插件的表单出现在两个菜单下 |

- **推荐**：Console「功能」页里的插件配置表单（`/features/global/:plugin`）。
- **其余**：
  - `/ops/config`：只保留 Host 段（`http` / `database` / `ai.*` 等），插件段改成只读，加「在功能页编辑」的链接。
  - `/ops/files` 编辑 yml：高级，打开时提示「建议用表单」。
  - `zhin config`：高级，给自动化用。
  - 聊天 `config set` 和 AI `config_patch`：ADR 0057 留下的「待定」由本 ADR Q9 决定——聊天只保留 `config get / fields`（只读），`set / unset` 删除；AI 改配置只能走自我变更审批（ADR 0040）。
  - `zhin setup` 写插件配置：删除（见第 7 项）。
- **迁移**：
  - 聊天 `config set` 删除前先弃用一个 minor，回复里提示去 Console。
  - Console 的改动跟着 zhinjs/console 的 minor 发布。
- **文档**：配置参考保留字段说明，但「怎么改」只写 Console 功能页；「在聊天中管理配置」挪进高级用法。

#### 10. 插件启用 / 停用

| 项 | 内容 |
| --- | --- |
| 意图 | 关掉或打开一个插件 |
| 入口 | Console 插件页开关（RPC `plugin:set-enabled`）；Console 功能矩阵的全局开关（RPC `feature.set-enabled`，`level: 'global'`）；`zhin enable` / `zhin disable`；手改 `disable_plugins`；聊天「功能 开启 / 关闭」的全局级（ADR 0057 待定）。适配器 / 账号 / 会话级只有 Console 对象页和聊天「功能」两个入口，共用同一个后端，不算重复 |
| 事实来源 | 都写 `disable_plugins`。ADR 0054 已经把两个 RPC 合成同一笔启停事务，但对外仍是两个 RPC 名 |
| 证据 | `toggle-plugin-restarts-instance`（停用一个小游戏会让所有适配器重新登录）；`feature-matrix-adapter-only`（矩阵里的适配器开关没有说明后果） |

- **推荐**：Console 功能页的全局开关（`feature.set-enabled`）。
- **其余**：
  - `plugin:set-enabled`：删除，弃用一个 Console 版本周期之后删。
  - Console 插件详情页的开关：改成只读状态，加「到功能页」的链接。
  - `zhin enable` / `zhin disable`：高级，给运维用。
  - 手改 `disable_plugins`：高级。
- **迁移**：`console-protocol` 里给 `plugin:set-enabled` 标弃用（minor），网关继续接受，并在审计里记录 `deprecated_rpc`；下一个 major 删除。
- **文档**：「停用插件」只写 Console 功能页。

#### 11. 安装、卸载、更新、搜索插件

| 项 | 内容 |
| --- | --- |
| 意图 | 加一个插件或者去掉一个插件 |
| 入口 | 安装：Console 插件市场 `/marketplace`、Console 引导里的适配器安装、`zhin install`、`zhin add`（隐藏的旧写法，`install.ts:387`）、`zhin packages install`、`zhin setup --adapters --install`、`create-zhin-app --adapter`<br>卸载：`zhin uninstall plugin <x>` / `zhin uninstall adapter <x>`、`zhin packages remove`、Console 插件详情<br>更新：`zhin update`、`zhin packages update`、Console 插件详情<br>搜索：`zhin search` / `zhin info`（描述就写着「等价于 zhin packages search / info」，`search.ts:209-217`） |
| 事实来源 | npm 插件都经网关依赖事务写 `package.json` 和 yml；`packages` 还兼管技能包（`.zhin/packages/`） |
| 证据 | `packages-list-misleading`（两套命令动词不一致，uninstall 对 remove；`zhin packages list` 只列技能包，组描述却是「插件生态入口」，`packages.ts:25`、`:169`）；`enable-hint-wrong-package`；`install-rollback-leaves-instance-down` |

- **推荐**：普通用户用 Console 插件市场；运维用 `zhin install` / `zhin uninstall <名>` / `zhin update` / `zhin search`。
- **其余**：
  - `zhin packages install / remove / update / search / info`：npm 插件部分删除。
  - `packages` 只保留技能包和插件状态（`status` / `verify` / `apply` / `verification-plan`）。是否改名为 `zhin skills` 加 `zhin plugin status`，按 Q11 的决定另行决定，不在本 ADR 范围。
  - `zhin add`：删除（还容易和 `zhin create` 混淆）。
  - `uninstall plugin | adapter`：合成 `zhin uninstall <名>`，旧写法高级。
  - `setup --adapters --install`：见第 7 项。
- **迁移**：重复的子命令先改为转发并打印告警，一个 minor 之后删除；`packages list` 立即改成分组列出插件和技能包（patch）。
- **文档**：快速开始和客户手册只写 Console 插件市场；CLI 参考只保留一套动词。

#### 12. 插件开发命令

| 项 | 内容 |
| --- | --- |
| 意图 | 新建、构建、发布插件 |
| 入口 | 新建：`npm create zhin-app`（Bot 项目）、`zhin new`（插件包）、`zhin create <类型>`（能力文件）、`zhin add`（安装的旧写法）<br>构建：`zhin build`、`zhin runtime build`<br>发布：`zhin pub`、`zhin runtime publish`<br>迁移：`zhin runtime migrate`<br>页面写法：`pages/<name>/index.tsx`（`definePage`）和纯 `.ts` 的 `definePageBlueprint` |
| 事实来源 | `build` / `pub` 和 `runtime build` / `runtime publish` 是两套实现（前者按 `plugins/` 路径，后者按项目结构生成计划） |
| 证据 | `create` / `new` / `add` / `create-zhin-app` 的命名会让人混淆；README 写「零 `.tsx`」，CLAUDE.md 和约定目录表写 `index.tsx` |

- **推荐**：`zhin new` → `zhin create` → `zhin plugin check` → `zhin pub`。页面写法推荐 Blueprint（`.ts`）。
- **其余**：
  - `runtime build` / `runtime publish`：先和 `build` / `pub` 合并实现，然后删除。
  - `runtime migrate`：并入 `zhin plugin migrate`。
  - `runtime inspect` / `runtime codegen`：挪到 `zhin plugin` 组。
  - `zhin add`：删除（见第 11 项）。
  - `.tsx` 页面：高级。
- **迁移**：属于开发者 API，按插件作者的弃用期处理：先告警一个 minor，下一个 major 删除。
- **文档**：「编写第一个插件」只走推荐链路。

### D. 账号与身份

#### 13. 平台账号（endpoints）

| 项 | 内容 |
| --- | --- |
| 意图 | 新增、修改、停用一个平台账号 |
| 入口 | yml `<adapter>.endpoints[]`；Console 适配器页「连接管理」；Console 引导的平台步骤；`zhin setup --adapters`（把账号合并写进 yml 的 `endpoints`，`packages/toolkit/scaffold-wizard/src/apply.ts:70-97`）；`zhin config set <adapter>.endpoints '<整段 JSON>'`；数据库快照（`PersistentEndpointRepository`） |
| 事实来源 | 数据库快照是事实来源；yml 的 `endpoints` 只在还没有快照时作为种子（`packages/im/adapter/src/adapter.ts:606`）。导入之后，`setup --adapters` 和 `config set` 写进 yml 的账号**不会生效**，也没有提示 |
| 证据 | `endpoint-config-drift`（部署反馈「最反直觉的限制」第 4 条）；`console-configured-endpoint-no-enable`；`console-adapter-page-duplication`（同一账号在适配器页出现两次：「聊天账号」表和「连接管理」卡片）；`adapter-migration-notice-no-action`；`sandbox-endpoint-no-console-management` |

- **推荐**：Console 适配器页的「连接管理」（只有这一个账号列表）。数据库是事实来源。
- **其余**：
  - yml `endpoints`：种子。`endpoints[i]` 在 `docs/contributing/public-api-surface.md` 中是 `stable`，所以分两步：阶段 2（minor）只做“导入 + 标为已导入（R1 ②）+ 弃用告警”，yml 里的 `endpoints` 仍被读取作种子、不被删除；阶段 3（major）才按 ADR 0057 §3 在导入后从 yml 移除，并把 `public-api-surface` 中的 `endpoints[i]` 改为 `deprecated` → `removed`。两个阶段里，yml 与数据库不一致时，启动日志、「需要你处理」和 `zhin doctor` 都报差异，并给出「导入 / 写回」按钮（批次中：`endpoint-drift` / `endpoint-import` / `endpoint-writeback` RPC）。
  - `zhin setup --adapters`：改为经网关账号 RPC 写入数据库，不再写 yml；交互模式随第 7 项弃用。
  - 导入之后 `zhin config set <adapter>.endpoints`：拒绝，并提示去 Console。
  - Console 适配器页：合成一个账号列表（Console 仓库）。
  - Sandbox 也要支持在 Console 增、停、启、删账号。
- **迁移**：阶段 2 导入并告警，同时提供导出功能，导出的凭据写成 `${VAR}` 占位；阶段 3（major）按 ADR 0057 §3 的步骤（备份到 `.zhin/backups/`，再从 yml 删除）。
- **文档**：「一个适配器登录多个账号」改成 Console 操作；yml 写法挪到「高级：用文件做首次种子」。

#### 14. 谁是管理员（聊天身份）

| 项 | 内容 |
| --- | --- |
| 意图 | 让某人在聊天里有管理权限 |
| 入口 | 聊天角色（Console「角色」页 / 聊天 `角色 授予`）、`ai.personalPrincipals`、适配器 `owner` / `master`、插件自建的 `masters` / 白名单、Console 账号 |
| 证据 | `identity-lists-fragmented`、`chat-role-bootstrap`、`sandbox-console-identity-owner`、`role-grant-identity-picker` |

- **推荐与处理**：沿用 ADR 0060 的决定（批次中，已接受）。
  - 聊天角色是唯一事实来源；配置里的人员名单只作为首次种子；
  - 插件不再自建 `masters`，改用框架提供的读取 API；
  - Console 账号和聊天身份只通过一次性绑定码显式链接，链接不传递权限；
  - 第一位 owner 通过 Console 绑定或认领码产生。
- 本 ADR 不重复这些决定，只把它列为 R1 原则的样板。

### E. AI

#### 15. 聊天用哪个模型（用途绑定）

| 项 | 内容 |
| --- | --- |
| 意图 | 换聊天模型 |
| 入口 | Console「AI 与模型 → 用途」；`ai.plan.yml` 的 `purposes`（首次导入）；yml `ai.agents.<name>.model`（已废弃，出现时启动进入迁移模式）；脚手架 `knowledge/faq.md`（让 AI 回答「去改 yml」）。另外还有适配器 / 账号 / 场景 / 个人 Session 几层选择，这是分层，不算重复 |
| 事实来源 | 数据库的模型图。`ai.plan.yml` 只在图为空时导入 |
| 证据 | `scaffold-faq-model-source`（批次中已修 FAQ）；`docs/configuration/generated.md:480` 和 `docs/ai/index.md:29` 互相矛盾；`docs/showcase/personal-assistant.md:104` 写「在 `ai.plan.yml` 或 Console 里新增」；`ai-purposes-select` |

- **推荐**：Console「AI 与模型 → 用途」。
- **其余**：
  - `ai.plan.yml`：种子。导入后移到 `.zhin/backups/`（ADR 0057 §3），再出现时提示差异；Console 提供导出。
  - `ai.agents.*.model`：删除。现在已经拒绝或进入迁移，下一个 major 连迁移识别也删掉，只留错误提示。
  - 个人 Session 选择：保留（属于分层）。
- **迁移**：同 ADR 0057 §3；修正 `generated.md` 的 Schema 描述（patch）。
- **文档**：AI 总览、路径页、showcase 只写 Console 用途页；`ai.plan.yml` 挪到「高级：用文件做首次种子 / 跨项目迁移」。

#### 16. 模型服务账号与 Key

| 项 | 内容 |
| --- | --- |
| 意图 | 加一个模型 Key |
| 入口 | `ai.plan.yml` 的 `accounts`（首次导入）；Console「账号」新建；Console「导入」（`POST /plan`）；`zhin ai account add / rename-env / test`（批次中）；`zhin setup --ai`（生成 `ai.plan.yml`）；`zhin migrate inference` |
| 事实来源 | 数据库，凭据加密保存。账号属于 Host 还是 Console 用户，决定了能不能引用 `.env` 里的变量 |
| 证据 | `host-account-add-path`、`console-account-env-key-impossible`、`account-env-ref-immutable`、`ai-account-status-stale`（部署反馈「最反直觉的限制」第 5 条：首次导入之后，就没有任何方法新增引用 env 的账号） |

- **推荐**：Console「AI 与模型 → 账号」。全局 owner 可以引用 `env://*_API_KEY`（批次中），账号页提供「测试连接」。
- **其余**：
  - `zhin ai account`：高级，给自动化和无浏览器环境用。
  - `ai.plan.yml`：种子（见第 15 项）。
  - `zhin setup --ai`：不再生成 `ai.plan.yml`，只装 AI 依赖并开启 `ai.enabled`，模型在 Console 配置。
  - `migrate inference`：只作为升级子步骤（见第 6 项）。
- **迁移**：`setup --ai` 的行为变更走 minor，并打印提示。
- **文档**：AI 快速开始改成「装依赖 → Console 加账号 → 选用途」。

#### 17. 密钥写在哪、用什么写

| 项 | 内容 |
| --- | --- |
| 意图 | 填一个 token 或密码 |
| 入口 | 手改 `.env`；Console「运维 → 环境变量」`/ops/env`；`zhin doctor --fix`（把字面值搬到 `.env`）；`zhin config set`（批次中已改为敏感字段写 `.env`）；`zhin console init --database-password-*`；直接在 yml 写字面值（会有警告）；模型账号「设置密钥」（数据库加密） |
| 事实来源 | ADR 0057 §1 / §4：平台与基础设施的密钥放 `.env`，yml 只写 `${VAR}`；模型 Key 放数据库加密存储，或引用 env |
| 证据 | `config-set-secret-plaintext`、`console-account-env-key-impossible` |

- **推荐**：
  - 平台和基础设施的密钥，在填写所在的那个表单里输入（Console 字段带 `x-zhin-secret`，自动写进 `.env`）；
  - 模型 Key 在 Console 账号页填写。
- **其余**：
  - `/ops/env`：高级。
  - 手改 `.env`：高级。
  - yml 字面值：继续告警，下一个 major 改为启动报错（Q17 已决定）。
  - CLI 各参数：高级。
- **文档**：只说「在表单里填，系统会替你放进 `.env`」。

#### 18. 机器人人设与引导文件

| 项 | 内容 |
| --- | --- |
| 意图 | 定义机器人是谁、怎么说话、怎么用工具 |
| 入口 | `SOUL.md`、`AGENTS.md`、`TOOLS.md`（`packages/im/agent/src/bootstrap.ts:30-33`）；`BOT.md`（批次中：有它时代替 `AGENTS.md` 给机器人读）；`assistant.profile.yml` 的 `persona.soul` / `agents` / `tools`，优先级高于上面的文件（`packages/im/agent/src/assistant/profile-loader.ts:74-85`）；yml `ai.agent.persona`（`packages/im/agent/src/config/zhin-agent-config.ts:89`）；`ai.agents.<k>.nickname` 和适配器 `nickname`；`HEARTBEAT.md`。生成方：`create-zhin-app`、`zhin setup --bootstrap`、`zhin migrate`（会给不用 AI 的项目补出这些文件） |
| 事实来源 | 三处可以写人设，profile 覆盖文件，`ai.agent.persona` 是默认值；改了 `SOUL.md` 却不生效、或在不该出现的地方生效的情况都可能出现 |
| 证据 | `bootstrap-dev-vs-bot`（根目录 `AGENTS.md` 同时给编码代理和机器人读，每轮多约 2k token）；`migrate-legacy-scaffold-files` |

- **推荐**：机器人的引导内容只放在项目根的 `BOT.md`（人设、回复风格、工具约定分节写）；`AGENTS.md` 只给编码代理。
- **其余**：
  - `SOUL.md` / `TOOLS.md`：先作为兼容回退继续读，并打印一次「合并进 `BOT.md`」的提示（`zhin doctor --fix` 可以自动合并）；下一个 major 删除。
  - profile 的 `persona.soul` / `agents` / `tools`：删除，profile 只保留 `routines` 和 `devices`。
  - `ai.agent.persona`：删除，内置默认值保留在代码里。
  - `zhin setup --bootstrap`：删除，交给脚手架生成。
  - `zhin migrate`：不再给不用 AI 的项目生成这些文件。
- **迁移**：先弃用一个 minor，下一个 major 删除，迁移由 `zhin doctor --fix` 完成。
- **被否决的替代方案**：保留 `SOUL.md` / `BOT.md` / `TOOLS.md` 三个文件，只删掉 profile 和 yml 里的那两处（见「决定」Q18）。
- **文档**：AI 页只介绍 `BOT.md`。

### F. 定时任务

#### 19. 定时任务与提醒

| 项 | 内容 |
| --- | --- |
| 意图 | 让 Bot 定时做事或提醒 |
| 入口 | AI 工具（`schedule_add` / `schedule_list` / `schedule_pause` / `schedule_resume` / `schedule_remove` / `schedule_preview`）；`zhin schedule add / list / pause / resume / remove`；Console「运维 → 定时任务」`/ops/schedules`（「定时提醒」「管理员任务」「助手任务」几个页签）；提醒插件聊天命令 `remind create / at / every / list / cancel`；提醒插件自己的页面；`assistant.profile.yml` 的 `routines`（启动时同步成任务）；`HEARTBEAT.md`；插件 `schedules/` 约定目录（`defineSchedule`，例如 `plugins/utils/rss`、`group-suite`、`ledger`）；旧文件 `data/schedule-jobs.json` |
| 事实来源 | 至少三个存储：Assistant 调度库（AI / CLI / profile）、提醒插件自己的表（聊天 / 管理员任务）、插件代码里声明的内部任务（运行时注册）。profile 和已落库的任务**不同步** |
| 证据 | `profile-routine-toggle-not-synced`、`profile-workday-job-never-fires`、`schedule-legacy-files-stale`、`schedules-page-classification`（21 个插件内部轮询任务被归成「定时提醒」）、`cli-schedule-add-im-crash`、`schedule-target-invisible`、`use-cases-stale-wording`（「任务中心」） |

- **推荐**：先把概念分成两类。
  1. **插件内部任务**（`defineSchedule`）：只能在代码里声明。Console 定时任务页另开「插件内部任务」分组，默认折叠、只读。
  2. **用户任务**（提醒、AI 例行任务）：
     - 普通用户在聊天里创建：提醒用 `remind`；要让 AI 执行的任务直接跟 AI 说；
     - 管理员在 Console 定时任务页统一查看和管理，一个列表，按「提醒 / AI 任务」分类，并显示投递目标。
- **其余**：
  - `zhin schedule`：高级，给自动化用。
  - AI 工具：保留（这是聊天入口的实现方式）。
  - `assistant.profile.yml` 的 `routines`：种子。首次导入数据库之后，以数据库为准；profile 再改时提示差异，并提供「按 profile 对齐」的操作。
  - `HEARTBEAT.md`：并入 `BOT.md` 的一节，或者改成 routine 的提示词字段。二者都符合 Q18 / Q19 的决定，具体选哪个在阶段 1 的定时任务 PR 中确定。
  - 提醒插件自己的页面：并进 Console 定时任务页，插件页删除（见第 24 项）。
  - `data/schedule-jobs.json`：迁移后改名为 `.migrated`。
- **迁移**：存储合并要 minor；页面分类走 Console 仓库的 minor；旧文件改名属于 patch。
- **文档**：「提醒」方案页只写聊天 `remind` 和 Console 定时任务页；CLI 写法挪进高级用法。

### G. 聊天侧

#### 20. 群问答：教学（teach）和关键词（keyword）

| 项 | 内容 |
| --- | --- |
| 意图 | 「有人说 X 就回 Y」 |
| 入口 | group-suite 的 `teach` / `teach-regex` / `teach-list` / `forget`，和 `keyword-add` / `keyword-list` / `keyword-remove`（`plugins/utils/group-suite/commands/`）；`zhin use-cases keyword-reply` 指南 |
| 事实来源 | 两套存储，各自有上限，都会自动回复；`teach` 教的内容在 `keyword-list` 里看不到 |
| 证据 | `group-suite-two-qa-systems`（批次中只在文档里写清了区别） |

- **推荐**：合成一套「问答」：`问答 添加 <问> <答> [--正则] [--包含]`、`问答 列表`、`问答 删除`；英文写法是 `qa add / list / remove`。用一份存储，匹配方式作为字段（精确 / 包含 / 正则）。
- **其余**：`teach*`、`forget`、`keyword-*` 改成转发到新命令的别名，回复里附一句「以后可用 `问答 …`」；下一个 major 删除。
- **迁移**：数据迁移把两张表合成一张，冲突时保留两条，并在 Console 提示；属于 `@zhin.js/plugin-group-suite` 的 minor。
- **文档**：插件 README 和用途指南只写「问答」。

#### 21. 命令命名

| 项 | 内容 |
| --- | --- |
| 意图 | 在聊天里调一个功能 |
| 入口 | 同一种操作有多种写法：连字符（`rss-list`、`ledger-add`、`keyword-add`、`stats-card`）、空格子命令（`remind list`）、中文目录名（`点歌`、`地震`）、过于通用的顶层名（`gen`、`scan`、`shorten`），以及只有部分命令有中文别名 |
| 证据 | `command-names-zh`、`plugin-generic-command-names`、`group-suite-zh-alias-partial`（「签到」能用，「我的积分」不能用）、`agent-invents-commands`；批次中已经给部分官方插件加了空格写法和中文别名，也加了「你是不是想用」提示 |

- **推荐**：
  - 规范写法是 `<插件或领域名> <动作>`，用空格分隔；
  - zh-CN 下每个面向用户的命令都要有中文别名和中文描述；
  - 回复里出现的词，都能当命令用。
- **其余**：连字符旧名保留为隐藏别名（不出现在菜单和帮助里）。只针对官方插件，第三方插件靠 `check` 规则和作者文档引导。
- **迁移**：别名长期保留（成本很低），只是从菜单里隐藏；在注册表中登记为 R5 的 `hidden-long-term` 例外（写明 `replacement` 与 `reason`，不写 `removeIn`）；属于 patch 或 minor。
- **文档**：「编写命令」页给出命名规范。

#### 22. 试聊入口（Sandbox）

| 项 | 内容 |
| --- | --- |
| 意图 | 不接平台，先试着聊一句 |
| 入口 | Host 上的本地页 `http://127.0.0.1:8068/sandbox`（Sandbox 插件页面）；Console「会话 → 沙盒」（Console 路由 `/sandbox`）；Console 账号页的「聊天」页签 |
| 事实来源 | 本地页靠 `HTTP_TOKEN` 认证，Console 初始化之后这个令牌就失效了；Console 沙盒用登录态 |
| 证据 | `local-sandbox-dead-after-init`（README 第 2 步在完成第 1 步之后就走不通，消息直接消失）；`console-sandbox-composer`、`sandbox-mention-bot` |

- **推荐**：Console「会话 → 沙盒」。
- **其余**：本地 `/sandbox` 页初始化之后改成跳转到 Console 沙盒，或者显示「请在 Console 中使用」；初始化之前保留，作为高级（离线调试）。
- **迁移**：属于 `@zhin.js/adapter-sandbox` 的 patch。
- **文档**：README、快速开始只写 Console 沙盒（删掉「方式 A / 方式 B」）。

#### 23. 群插话开关

| 项 | 内容 |
| --- | --- |
| 意图 | 让 Bot 在某个群里插话，或者不要插话 |
| 入口 | yml `ai.trigger.ambient.conversations`（只有白名单，`*` 或逐个列出）；Console「AI → 插话」`/features/ai/ambient`；聊天私聊 `config set ai.trigger.ambient.*`（Host 白名单字段）；群管理员的「功能 关闭」**管不到**插话，因为插话不是插件 |
| 证据 | `ambient-allowlist-only`（关掉一个吵的群，得把其余所有群逐个列出，新加的群也不会自动参与） |

- **推荐**：把插话当成一个功能，纳入功能分级覆盖（ADR 0050 / 0055）：
  - 全局默认值仍然是 yml 的 `ai.trigger.ambient`；
  - 适配器 / 账号 / 会话层的开关写进 `feature_overrides`；
  - 群管理员用「功能 关闭 插话」，Console 用对象页的「功能」页签。
- **其余**：
  - `conversations` 白名单：改为种子，首次启动导入成会话级覆盖，之后以数据库为准。（被否决的替代方案：保留为全局层，只新增 `excludeConversations`，见「决定」Q23。）
  - `/features/ai/ambient`：保留，作为插话的说明和全局设置页。
- **迁移**：属于 `zhin.js`（instance）和 `@zhin.js/agent` 的 minor。
- **文档**：「让 Bot 在群里插话」只写功能开关。

### H. Console

#### 24. 插件自带页面和 Console 内置页面

| 项 | 内容 |
| --- | --- |
| 意图 | 在 Console 里管理某个插件或适配器的对象 |
| 入口 | 每个官方适配器都有 `pages/index` 蓝图（`plugins/adapters/*/pages/index`），Console 又内置了适配器对象页（`AdapterConsolePage`）；提醒、RSS、抽奖等插件页面和 Console 定时任务页、功能页管的是同一批对象；群欢迎有 `/use-cases/group-welcome` 流程页和插件配置表单两处 |
| 证据 | `console-adapter-page-duplication`、`plugin-page-manual-target`、`plugin-page-raw-conversation-key`、`lottery-page-disabled-schedule`、`calendar-page-inputs` |

- **推荐**：
  - 通用对象（账号、功能开关与配置、定时任务、角色）只用 Console 内置页；
  - 插件页面只用来展示插件自己领域的视图（例如 RSS 订阅列表、记账报表），挂在插件详情或对象页下作为一个页签，不在侧栏单独再开入口；
  - 适配器只通过 `createAdapterConsoleRpc` 提供数据，界面由 Console 统一渲染。
- **其余**：重复管理通用对象的插件页面改成只读，加跳转链接；页面写法见第 12 项。
- **迁移**：分别属于各官方插件的 patch 或 minor，以及 Console 仓库的 minor。
- **文档**：`docs/authoring/console-pages.md` 增加「什么时候不该写插件页面」。

#### 25. 「我想做 X，从哪开始」的用途指南

| 项 | 内容 |
| --- | --- |
| 意图 | 按用途找配置入口 |
| 入口 | `zhin use-cases`；Console「定时任务 → 管理员任务 → 按用途开始」；`docs/solutions/*` |
| 事实来源 | CLI 和 Console 共用一份用途目录，文档另外写一份 |
| 证据 | `use-cases-stale-wording`（CLI 文案说「任务中心」，Console 里已经没有这个入口） |

- **推荐**：普通用户看文档的「方案」页，Console 里的「按用途开始」挪到首页。
- **其余**：`zhin use-cases`：高级，文案由同一份目录生成，并接入 R3 检查。
- **文档**：每个方案页只教推荐路径。

## 统一原则（可检验）

| # | 规则 | 怎么检验 |
| --- | --- | --- |
| R1 | **运行时状态只有一个事实来源，就是数据库；文件只做首次种子。** 每个种子必须①只在目标为空时导入；②导入后从文件中移除，或者记为已导入；③文件再次出现、或和数据库不一致时，启动日志、「需要你处理」和 `zhin doctor` 三处都要提示，并给出处理按钮。不能悄悄忽略。 | 新增 `scripts/one-path-registry.json`，登记所有种子（`endpoints`、`ai.plan.yml`、`assistant.profile.yml#routines`、`ai.personalPrincipals`、适配器 `owner` / `master`、`ai.trigger.ambient.conversations` 等）。`check:seed-sources` 检查每一项都登记了导入器、迁移记录路径和 attention kind，并且这个 kind 已在 `@zhin.js/console-protocol` 中声明 |
| R2 | **面向新用户的操作只在 Console 和聊天里完成；CLI 面向运维和自动化**，因此 CLI 必须非交互、支持 `--json`、有稳定的退出码。交互式 CLI 向导不再新增。 | `check:one-path-docs`：在 `docs/getting-started/`、`docs/paths/`、`docs/customer/`、README 快速开始里，禁止出现登记为「高级 / 删除」的入口写法（例如 `zhin setup`、`zhin config set`、`zhin schedule add`、`8068/sandbox`），除非写在 `::: details 高级用法` 块里 |
| R3 | **每个文档页只教一条路。** 其他入口只能写在「高级用法」块里，或者链接到参考页。 | 同 R2 的脚本，扫描范围扩大到 `docs/**`（`docs/adr`、`docs/plans`、`docs/cli` 参考页除外） |
| R4 | **一个意图只对应一个后端操作**（RPC 或服务）。Console、聊天、CLI 都只是它的前端，不能各写各的存储，也不能各自做不同范围的校验。 | 注册表里给每个意图登记规范 RPC。`check:one-path-rpc` 检查 `CONSOLE_RPC_PERMISSIONS` 中标为别名的 RPC（如 `plugin:set-enabled`）都带 `deprecated` 元数据 |
| R5 | **别名和旧入口必须有期限。** 每个兼容别名、旧命令、旧字段注册时都要写 `deprecatedSince`、`removeIn`、`replacement`，第一次使用时打印一次告警。**唯一例外是“长期隐藏别名”**：保留成本几乎为零、且删除会打断用户肌肉记忆的旧写法（目前只有 Q21 的官方插件连字符旧命令名），登记为 `kind: "hidden-long-term"`，不写 `removeIn`，但必须写 `replacement` 和 `reason`，不出现在菜单、帮助和文档里，使用时不告警。例外只能逐条登记在注册表的显式清单里，不能按模式放行。 | `check:deprecated-aliases`：①CLI 隐藏命令和别名必须出现在注册表里；②除 `hidden-long-term` 外每一项都有 `removeIn`，当前包版本达到 `removeIn` 时 CI 失败；③`hidden-long-term` 项必须有非空 `replacement` 与 `reason`，且其别名不得出现在菜单、`--help` 与 `docs/**`（R3 扫描范围）中 |
| R6 | **Console 里一个对象只有一个可编辑位置**，其他位置只读，并链接过去。 | Console 仓库新增检查：可编辑的 `PluginConfigForm`、账号编辑器、插件开关，每种在路由树里最多出现一次 |
| R7 | **聊天命令命名统一**：`<领域> <动作>`；zh-CN 下要有中文别名和描述；官方插件的顶层命令目录不用连字符。 | `check:command-names`：扫描 `plugins/**/commands/*`，有白名单 |
| R8 | **快速开始就是验收脚本。** README 和快速开始的每一步都要有 e2e 用例覆盖，保证「只走推荐路径」能跑通。 | 在 `tests/e2e-gateway` 里加一条「新用户路径」用例（create → `pnpm dev` → Console 初始化 → Console 沙盒 `/hello`） |

R1–R7 都只需要静态扫描，可以先以 warning 加入 `pnpm check:all`，到阶段 2 改为 error。

## 分阶段计划

版本级别按 `.changeset/version-policy.json`：默认是 patch，minor 及以上需要所有者批准。删除 `public-api-surface` 中标为 `stable` 的入口（如 `zhin setup`、`zhin start` 的参数、`zhin.config.yml` 的顶层键）必须走 major；其他入口至少弃用一个 minor 之后，才能在后续 minor 中删除。

| 阶段 | 内容 | 涉及的包 | 版本 |
| --- | --- | --- | --- |
| 0 文档与文案 | 快速开始、路径页、客户手册、AI 总览、配置参考第一段都改成只讲推荐路径；修正 `generated.md` 里 `ai.plan.yml` 的描述和 showcase 的矛盾；README 删掉本地 `/sandbox` 方式；`use-cases` 文案；`packages list` 分组列出；新增注册表和 R2 / R3 检查（warning） | `docs`、`README*`、`@zhin.js/cli`、`@zhin.js/scaffold-wizard`、`packages/im/ai`（plan schema 描述） | patch |
| 1 弃用告警与 UI 降级 | CLI：`runtime start`、`--no-watch`、`onboard`、`add`、`watch`、`doctor --live`、`packages` 中的 npm 插件子命令、`uninstall adapter`、`health` / `validate`、`config check --fix` 打印告警或转发；`setup` 交互模式给出提示。配置文件名告警。Console：`/ops/config` 插件段只读、适配器页合成一个账号列表、插件开关只保留一处、「插件内部任务」分组、本地 sandbox 页跳转。脚手架不再生成服务文件，pm2 改成 `--with pm2`。group-suite「问答」，旧命令改别名。官方插件命令别名。人设来源告警（`SOUL.md` / `TOOLS.md` / profile / `ai.agent.persona`）。R5 / R6 / R7 检查（warning） | `@zhin.js/cli`、`create-zhin-app`、`@zhin.js/scaffold-wizard`、`@zhin.js/plugin-runtime`、`@zhin.js/agent`、`@zhin.js/adapter-sandbox`、`@zhin.js/plugin-group-suite`、其他官方插件、`@zhin.js/console-protocol`、zhinjs/console | minor（CLI、agent、group-suite、console-protocol、Console）；其余 patch |
| 2 事实来源收口 | ADR 0057 §3：`ai.plan.yml` 导入后移除，并提供导出；yml `endpoints`（`public-api-surface` 中为 `stable`）只做种子导入、标为已导入并打弃用告警，提供导出，不删除（删除在阶段 3）；`assistant.profile.yml#routines` 变为种子并提示差异；插话纳入功能覆盖；`setup --adapters` 改为经网关账号 RPC；CLI 不再退回 `http.token`、不再跨项目连接；聊天 `config set` 按 Q9 删除（先弃用一个 minor）；定时任务存储合并；检查脚本在 CI 中改为 error | `zhin.js`（instance）、`@zhin.js/adapter`、`@zhin.js/agent`、`@zhin.js/gateway`、`@zhin.js/cli`、`@zhin.js/console-protocol`、`@zhin.js/schedule-feature`、`@zhin.js/plugin-reminder`、zhinjs/console | minor（需批准） |
| 3 删除 | 删除阶段 1 弃用的命令、参数、别名（R5 的 `hidden-long-term` 例外除外）、RPC（`plugin:set-enabled`）；yml `endpoints` 导入后从文件移除（ADR 0057 §3，`public-api-surface` 改为 `removed`）；删除五种备用配置文件名、`ai.agents.*.model` 的迁移识别、`ai.agent.persona`、profile 的人设字段、`SOUL.md` / `TOOLS.md` 回退（Q18）、`zhin setup` 交互模式（Q7）、`runtime build` / `publish` | `@zhin.js/cli` 2.0、`zhin.js` 2.0、`@zhin.js/adapter`、`@zhin.js/plugin-runtime`、`@zhin.js/agent`、`create-zhin-app` | major |

每个阶段都单独开 PR；阶段 1 和阶段 2 可以按领域（运行、插件、账号、AI、定时任务、聊天、Console）拆成多个 PR 并行推进。

## 风险

- **自动化脚本失效**：部署脚本可能用了要删除的命令或别名。缓解办法：阶段 1 只告警、只转发；阶段 3 跟着 major 一起发布，升级文档列出替换表；`zhin migrate --dry-run` 扫描 `package.json` 的 scripts 和服务文件，提示里面用到的旧命令。
- **GitOps 用户失去「文件即真相」**：习惯把账号、模型放在 git 里管理的部署会受影响。缓解办法：Console 导出加种子导入可以覆盖「新环境复制」这个场景；真正的声明式模式（文件持续生效、数据库只做缓存）作为备选方案 B 记录下来，不在本 ADR 内实现。
- **Console 和 Host 版本错位**：Console 先降级了入口，Host 还没提供替代 RPC。缓解办法：沿用能力握手（`unknown-rpc-audited-as-denial` 的修复），新入口不可用时继续显示旧入口。
- **英文文档滞后**：`docs/en/` 需要同步修改，R2 / R3 检查同样扫描 `docs/en/`。
- **第三方插件**：R7 只约束官方插件；第三方插件可能继续自建 `masters` 和连字符命令。缓解办法：插件作者文档和 `zhin plugin check` 只给警告。
- **ADR 之间的耦合**：第 13、15、16 项依赖 ADR 0057 §3 实施；第 14 项依赖 ADR 0060；第 23 项会扩展 ADR 0050 / 0055 的「功能」定义。

## 备选方案

- **A. 保留所有入口，改成双向同步**（yml 和数据库互相写回）。不采用：冲突裁决复杂，而且「两个地方都能改」本身就是困惑的来源。批次中的 `endpoint-writeback` 只作为显式的一次性操作保留。
- **B. 文件是唯一真相，数据库只做缓存（声明式 / GitOps 模式）。** 不作为默认：聊天和 Console 的运行时修改（角色、会话覆盖、提醒）没法回写到文件里，而且会和人手改的内容互相抢写（这正是 ADR 0057 要解决的问题）。将来可以作为「只读运行时」的高级部署模式，单独起 ADR。
- **C. 只改文档，不动入口。** 不采用：AI 知识库、`--help` 和旧博客还会继续教旧入口，弃用告警才是用户真正能看到的信号。
- **D. CLI 优先，Console 只做只读面板。** 不采用：和 ADR 0053（引导在 Console 完成）以及 #1250 的反馈方向（新用户在浏览器里完成操作）相反。

## 决定

所有者于 2026-11-14 拍板：Q0a–Q0c 与 Q1–Q25 **全部按推荐处理**。Q0 是总原则；Q1–Q25 和上面的盘点编号一一对应。「被否决的替代选项」一列保留当时提出的其他方案，作为否决记录。

| # | 项 | 决定 | 被否决的替代选项 | 影响 |
| --- | --- | --- | --- | --- |
| Q0a | 原则 R2 | 新用户操作只在 Console 和聊天里完成；CLI 面向运维和自动化，不再新增交互式向导 | CLI 和 Console 同等对待，两边都教 | 决定第 7、9、11、16、19 项的取舍和快速开始怎么写 |
| Q0b | 弃用节奏 | 至少告警一个 minor；`stable` 入口到 major 才删除 | 一律等到 major 才删 / 直接删除不告警 | 阶段 1–3 的发布顺序 |
| Q0c | 检查脚本 | R1–R7 先以 warning 加入 `check:all`，阶段 2 改为 error | 只写成文档约定，不加脚本 | 新增 5 个 `check:*` 和一个注册表文件 |
| Q1 | 启动 | `pnpm dev`（开发）和 `zhin start`（服务器）；删除 `runtime start` 和 `--no-watch`；隐藏 `--standalone` | 保留 `runtime start` 作为永久别名 | 用 `runtime start` 的旧服务文件需要更新 |
| Q2 | 守护 | 只保留 `zhin service install`；脚手架不再生成服务文件；pm2 改成可选项 | 脚手架只生成当前系统的那一份 | `create-zhin-app` 的产物变化；Windows 和 pm2 用户多一步操作 |
| Q3 | 状态与日志 | Console 首页加 `zhin status` / `zhin logs`；`watch` 并入 `status --watch`，`doctor --live` 并入 `status --json` | 保留 `watch` | 删除两个命令 |
| Q4 | CLI 连接 | 本机只走控制套接字；远程必须写 `--host`；删除 `http.token` 回退 | 保留回退，只加项目核对 | 依赖回退的脚本需要改成 API 令牌 |
| Q5 | 诊断 | `zhin doctor` 唯一；`config check` 只给 CI 用；删除 `health` / `validate` 别名 | 合成 `zhin doctor --config` | CI 脚本可能用了 `validate` |
| Q6 | 升级 | `zhin migrate` 负责编排所有子迁移；`runtime migrate` 移到插件命令组 | 维持现状，只改文档 | `migrate` 的实现量较大 |
| Q7 | 首次配置 | Console 引导；`zhin setup` 交互模式到 major 删除，保留非交互参数；`onboard` 删除；`console init` 作为高级 | `setup` 永久保留为高级入口 / 连非交互参数也删掉 | 文档里约 30 处要改；`public-api-surface` 要改 |
| Q8 | 配置文件名 | 只接受 `zhin.config.yml` | 也允许 `zhin.config.json` | 用其他文件名的项目需要改名（`doctor --fix` 可以自动完成） |
| Q9 | 插件配置 | 只在 Console 功能页编辑；`/ops/config` 只管 Host 段；聊天 `config` 只读；AI 只能走自我变更审批 | 聊天 `config set` 保留，但限定 `owner@global`，并经网关事务（ADR 0057 待定的另一个方案） | 用聊天改配置的部署会失去这个能力 |
| Q10 | 插件启停 | 只用 `feature.set-enabled`（全局）；删除 `plugin:set-enabled`；插件详情页开关改为只读 | 保留两个 RPC 名 | 旧版 Console 兼容需要一个版本周期 |
| Q11 | 安装与搜索 | Console 插件市场；CLI 只保留 `install` / `uninstall` / `update` / `search` / `info`；`packages` 只管技能包和状态；删除 `zhin add` | 反过来以 `packages` 为准 | 删除一组重复子命令；`packages` 是否改名为 `zhin skills` 另行决定 |
| Q12 | 开发命令 | `new` → `create` → `plugin check` → `pub`；`runtime build` / `publish` 合并后删除；页面写法推荐 Blueprint | 保留 `runtime` 组作为高级 | 影响插件作者，走 major |
| Q13 | 平台账号 | Console「连接管理」是唯一入口，以数据库为准；yml `endpoints` 只做种子：阶段 2（minor）导入并弃用告警，因其在 `public-api-surface` 中为 `stable`，导入后从 yml 移除放到阶段 3（major）；`setup --adapters` 改为写数据库 | yml 持续可写，启动时提示差异，由用户选择导入或写回（批次中的漂移方案，不移除） | 依赖 ADR 0057 §3 实施 |
| Q14 | 管理员身份 | 按 ADR 0060 执行 | —（无替代选项） | 已由 ADR 0060 决定 |
| Q15 | 模型绑定 | Console「用途」页；`ai.plan.yml` 只做种子并在导入后移走；major 删除 `ai.agents.*.model` 的识别 | `ai.plan.yml` 保留在根目录，作为显式「预览 → 应用」的输入，不移走 | 文档里约 15 处 |
| Q16 | 模型账号 | Console 账号页（全局 owner 可以引用 env）；`zhin ai account` 作为高级；`setup --ai` 不再生成 plan | 由 `setup --ai` 继续生成 plan 作为种子 | `setup --ai` 行为变更 |
| Q17 | 密钥 | 在所在表单里填，自动写进 `.env`；yml 字面值到 major 改为启动报错 | 永远只告警 | major 之后，写了字面值的项目无法启动 |
| Q18 | 人设与引导文件 | 机器人只读 `BOT.md`；`SOUL.md` / `TOOLS.md` 弃用并由 `doctor --fix` 合并；删除 profile 人设字段和 `ai.agent.persona` | 保留 `SOUL.md` / `BOT.md` / `TOOLS.md` 三个文件，只删 profile 和 yml 两处 | 现有项目的引导文件需要迁移 |
| Q19 | 定时任务 | 分成插件内部任务（只读）和用户任务（聊天创建，Console 统一管理）；profile `routines` 变为种子；合并存储 | profile 继续生效，启动时自动按 profile 对齐 enabled 状态 | 存储迁移，涉及 schedule-feature、reminder、agent |
| Q20 | 群问答 | 合成「问答」一套命令和一份存储，旧命令变别名 | 保留两套，`list` 时一起列出 | group-suite 数据迁移 |
| Q21 | 命令命名 | `<领域> <动作>`，加中文别名；连字符旧名隐藏但长期保留，作为 R5 的 `hidden-long-term` 例外逐条登记（有 `replacement` 与 `reason`，无 `removeIn`） | 连字符旧名到 major 删除 | 官方插件的菜单变化 |
| Q22 | 试聊 | 只用 Console 沙盒；本地 `/sandbox` 初始化后跳转到 Console | 本地页改为接受 API 令牌并继续保留 | README 改动 |
| Q23 | 群插话 | 纳入功能分级覆盖，群管理员用「功能 关闭 插话」；`conversations` 白名单变为种子 | 只加 `excludeConversations`，开关仍是全局配置 | 扩展 ADR 0050 / 0055 的功能定义 |
| Q24 | 插件页面 | 通用对象只用 Console 内置页；插件页面只放插件自己的领域视图，挂成页签 | 插件页面不受限制 | 部分官方插件页面要改为只读 |
| Q25 | 用途指南 | 普通用户看文档方案页和 Console 首页的「按用途开始」；`zhin use-cases` 作为高级 | 删除 `zhin use-cases` | 很小 |

### 与 ADR 0061 共同的决定：IM 回合审批接入 `ToolApprovalQueue`

所有者在 PR #1253 的讨论中同意：IM 会话内的工具确认与 Console「需要你处理」里的工具审批**共用同一个 `ToolApprovalQueue`**，任一处批准或拒绝即生效，另一处同步失效。这是 R4（一个意图只对应一个后端操作）在审批上的落实：审批只有一个后端，聊天与 Console 只是它的两个前端。细节与实施阶段见 [ADR 0061](./0061-inbound-message-outcomes.md) §5.1（归入其 P2）。

### 留给实施 PR 的细节

以下两点不在 Q 表内，所有者在对应 PR 中确认，不影响本 ADR 的决定：

- `HEARTBEAT.md` 并入 `BOT.md` 的一节，还是改成 routine 的提示词字段（第 19 项）。
- `packages` 是否改名为 `zhin skills` 加 `zhin plugin status`（第 11 项、Q11）。

## 不在本 ADR 范围

- 每一项的具体实现方案和代码改动：由各自的 PR 或后续 ADR 处理。
- Console 账号体系（ADR 0049 / 0059）和聊天角色模型（ADR 0056 / 0060）本身。
- 功能分级覆盖的合并规则（ADR 0050 / 0055）；本 ADR 只建议把「插话」纳入其中。
