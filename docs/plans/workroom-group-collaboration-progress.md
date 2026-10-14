---
sidebar: false
---

# Workroom 重构进度表

方案见 [workroom-group-collaboration-redesign.md](./workroom-group-collaboration-redesign.md)。这张表由定时任务每次运行时读取和更新。

## 规则

- 按顺序取第一个 `[ ]` 且没有标记 `阻塞` 的条目执行。每次运行做 1 个条目；时间充裕时最多做 2 个。
- 做完一个条目：构建、type-check、相关测试都通过，Opus 审查没有 Blocking 问题之后，才能勾选 `[x]`，并在条目下写一行：日期、提交标题（同一个提交里拿不到自己的哈希，所以不写哈希）、一句话结果。
- 遇到需要维护者决定的问题：把条目标记为 `阻塞`，写清楚问题和选项，然后跳到下一个不依赖它的条目。
- 每个阶段的最后一个条目必须跑通 `pnpm check:all`。
- 只在本地提交，不推送、不开 PR、不合并到 main。
- 分支：阶段 A 在 `refactor/workroom-split-a1` 上；阶段 B 和 C 在 `feat/workroom-group-collab` 上（从阶段 A 的最新提交切出）。

## 阶段 A：拆包，不改行为

- [x] A1 `plugin-runtime/` 中的 workroom 文件移到 `workroom-runtime/`
  - 2026-10-13 · 0da7b2039 · 67 个文件，`@zhin.js/agent/runtime` 导出名称不变
- [x] A2a 断开 init / config / routing / agent-host-port 的反向依赖
  - 2026-10-13 · 46527ec1d, da6677193 · 新增 `workroomHostToken`；Workroom 存储先校验后激活
- [x] A2b 处理 Opus 对 A1 / A2a 的审查意见（见“审查记录”第 1 轮的 Should fix 3、4、6 和 Nit）：
  - 在 `basic/cli/tests/plugin-runtime/workroom/persistence-coordinator.test.ts` 补一个顺序不变量测试：`workroom_events` 中有损坏的行时，激活被拒绝，`zhinAgent.configure` 和 `upgradeProfilesToDatabase` 都没有被调用，journal 和 catalog 保持未激活
  - 在 `scripts/check-architecture-layers.mjs` 的 `agentRuntimeRoots` 中加入 `packages/im/agent/src/workroom-runtime`
  - 按审查第 6 条修正方案文档中的事实错误（反向依赖清单、A1 路径、行数、状态行）
  - Nit：`persistence-coordinator.ts` 中执行不到的 `useDatabase === false` 分支；`agent-console.ts` 合并时断言两边的 key 不重叠；`publication-coordinator.test.ts` 断言两个 console 的精确 key 集合；`docs/authoring/host-tokens.md`（中英文）补充 `workroomHostToken`
  - 2026-10-13 · 「fix: 处理 A1/A2a 审查意见」· 顺序不变量测试、架构检查覆盖 workroom-runtime、方案文档事实修正、Console key 重叠断言、host-tokens 文档；首次用工作流脚本执行
- [x] A2b-1 收紧 `basic/cli/tests/plugin-runtime/workroom/persistence-coordinator.test.ts` 的顺序不变量测试：参照 `packages/im/agent/tests/workroom/database-journal-integrity.test.ts` 的 databaseFixture，先写入一条合法事件再篡改 digest，断言 cause 包含 `stored event digest`，确保拒绝的原因确实是损坏行，而不是其他更早的失败。顺带在方案 §1.2 补一句：入口文件的 re-export 是兼容层，A4 处理
  - 2026-10-13 · 「test: 收紧 Workroom 激活顺序不变量测试」· 先写合法事件再篡改，断言 cause 含 `stored event digest`；方案 §1.2 补兼容层说明
- [x] A2c 拆分 `plugin-runtime/deferred-capability-plan.ts`：`WorkroomCapabilityRealization`、`bindWorkroomCapabilityRealization`、`createWorkroomDeferredCapabilityPlan` 等 workroom 部分移到 `workroom-runtime/`；通用的 `createDeferredCapabilityPlan` 不能再 import workroom 类型，改为接收一个注入的“能力上限”接口。完成后，`packages/im/agent/src` 中除 `workroom/`、`workroom-runtime/`、`portfolio/`、`data-governance/` 之外，只有 `plugin-runtime/index.ts` 和根 `index.ts` 的 re-export 允许引用这四个目录
  - 2026-10-13 · 「refactor: 拆分 deferred capability plan 的 Workroom 部分」· Workroom 天花板移入 `workroom-runtime/`，通用计划改为注入 `ceiling`；架构检查新增四目录引用约束；导出名不变
- [x] A2c-1 处理第 4 轮审查意见：`createDeferredCapabilityPlan` 收到遗留的 `authority` 字段时抛错（fail-closed，补测试）；`check-architecture-layers.mjs` 的四目录引用约束覆盖 `import type` / `export type` / `import()`，白名单 barrel 只放行 `export ... from`（补自测）；顺带：校验 ceiling 返回的是子集；`workroom_` 前缀提成常量并注释说明
  - 2026-10-14 · 「fix: 收紧 deferred capability plan 与四目录引用检查」· 遗留 `authority` 抛错、ceiling 子集校验、引用检查覆盖 type-only 与 `import()`、barrel 只放行 re-export、`RESERVED_CONTROL_TOOL_PREFIX` 常量
- [x] A2c-2 处理第 5 轮审查意见：删掉 `scripts/lib/parse-imports.mjs` 中重复的 `export type * from` 正则（会让 barrel 检查把合法的 `export type *` 误报为违规），补 `export type * from` 放行用例和“parseImports 不返回重复项”的测试；`export` 正则支持 `* as ns`，补 `export * as ns` / `export type * as ns` 用例；changeset 补充新导出 `RESERVED_CONTROL_TOOL_PREFIX`（或取消导出）
  - 2026-10-14 · 「fix: 修正 parseImports 重复匹配并支持 export * as ns」· 删掉重复的 `export type *` 正则，`export` 正则支持 `* as ns`，补去重 / barrel 放行 / 命名空间 re-export 用例；changeset 注明 `RESERVED_CONTROL_TOOL_PREFIX`
- [x] A3 断开 `data-governance ↔ workroom` 的循环依赖：抽出共享类型，方向固定为 workroom → data-governance
  - 2026-10-14 · 「refactor: 断开 data-governance 对 workroom 的反向依赖」· `canonical-value.ts`、`durable-file-store.ts` 原样移入 `data-governance/`，旧路径改为 `export *` 兼容层（有身份测试）；架构检查新增方向约束（抽出 `find-forbidden-imports.mjs` 并补自测）；导出名不变
- [x] A3-1 处理第 7 轮审查 Nit：`check-architecture-layers.mjs` 方向约束的报错信息按命中的目录（workroom / workroom-runtime / portfolio）生成；方向约束自测补 `import('../workroom/x.js').X` 内联类型和 `export { x } from` 两个用例；`data-governance/canonical-value.ts` 注释改为“Workroom 与 Data Governance 共享，名称中的 Workroom 前缀为兼容保留”
  - 2026-10-14 · 「chore: 处理 A3 审查 Nit」· 方向约束报错按命中目录生成；自测补内联 `import()` 类型、`export { x } from`、同目录负例和 root 断言；`canonical-value.ts` 注释更新
- [x] A4a 新建包 `packages/im/workroom`（`@zhin.js/workroom`），参照现有包的 package.json / tsconfig / exports（development 条件）。先把 `workroom/`、`portfolio/`、`data-governance/` 搬过去；agent 侧临时 re-export 保持兼容
  - 2026-10-14 · 「refactor: 新建 @zhin.js/workroom 包并迁入 workroom/portfolio/data-governance」· 112 个源文件纯移动，新包只依赖 `@zhin.js/im-contract`；agent 侧 `export *` 兼容层，导出名不变；架构检查、typecheck 别名、changeset 同步更新
- [x] A4a-1 处理第 9 轮审查意见：`check-architecture-layers.mjs` 的 A2c 引用边界检查（`resolveDomain`）也识别 `@zhin.js/workroom` 及其子路径的裸说明符，barrel 与非 barrel 分支一致，补正反用例；顺带：`tsconfig.typecheck.json` 的 `include` 加入 `packages/im/workroom/src/**/*`；agent 侧兼容层补一个轻量测试（只含 `export * from '@zhin.js/workroom/...'`）；changeset 或 README 注明 `./workroom/*.js` 等深路径导出为临时，A4b/A5 后收窄
  - 2026-10-14 · 「fix: 引用边界检查识别 @zhin.js/workroom 裸说明符」· `resolveDomain` 先识别裸说明符（抽出 `scripts/lib/workroom-specifier.mjs`）；typecheck 包含新包 src；112 个兼容层逐个断言只含一行 `export *` 且目标存在；changeset / README 注明深路径导出为临时
- [x] A4b 把 `workroom-runtime/` 搬进新包；把 `@zhin.js/agent`、`@zhin.js/agent/runtime` 中的 workroom 导出改为从 `@zhin.js/workroom` 导出，修改所有使用方（basic/cli、packages/host/*、plugins、examples、tests）。agent 包不再依赖 workroom 包
  - 2026-10-14 · 「refactor: 将 workroom-runtime 迁入 @zhin.js/workroom」· agent 不再以任何形式引用 workroom（架构检查强制，含 barrel）；删除 112 个兼容层与重复 fixture；workroom 相关测试随代码迁入新包；快照与 changeset 更新
- [ ] A4b-1 处理第 11 轮审查意见：`basic/cli/package.json` 中 `@zhin.js/workroom` 改为 devDependency + 可选 peerDependency（与 `@zhin.js/agent` 一致，恢复“AI 另装”的安装图），`@zhin.js/a2a` 考虑把 workroom 也设为 peer 避免出现两份 agent / plugin-runtime 实例；`.changeset/move-workroom-runtime.md` 补 `"zhin.js": patch` 并说明 `zhin.js/agent` 用户改从 `@zhin.js/workroom` 导入；`packages/im/agent/README.md` 删掉或迁走 Workroom Kernel / Journal / Projection Outbox 段落。顺带 Nit：`ZhinAgentPrivate` 从 `@zhin.js/agent/core` 公开导出，标 `@internal` 或改窄接口（可留给 A5）；`check-architecture-layers.mjs` 中 workroom 与 zhin 同为 level 5，补注释或调整层级
- [ ] A4c CLI 改为可选加载 workroom（未安装时 Agent 照常工作，Console 的 workroom 页面降级）。前置条件（审查第 5 条）：`agent-console.ts` 在缺少 Workroom 端口时只返回 agent console，`AgentConsolePort` 的 `workroom*` 字段改为可选，Workroom 路由自己返回 503；同步修改 `api.test.ts` 中“缺少 Workroom 端口时返回 null”这个测试。更新 api-surface / plugin-runtime-api 快照
- [ ] A5 `check:architecture` 增加规则：`@zhin.js/agent` 禁止导入 `@zhin.js/workroom`。CLI 测试改为通过公开接口测试，不再 import 内部 coordinator。补 changeset。跑通 `pnpm check:all`

## 阶段 B：新 Room 核心（在 `@zhin.js/workroom` 内，与旧机制并存）

- [ ] B1a Room / Member / Role 定义与校验，从现有 `catalog-definition` 简化而来（见方案 §3.1）
- [ ] B1b Endpoint 上报登录后的平台账号 `selfUserId`（先做 ICQQ / OneBot，以及 Sandbox）；进程级 Peer Registry。复用已有实现：`plugins/adapters/icqq/src/icqq-inbound.ts` 的 `isSelf` 过滤、`kook/src/endpoint.ts` 的 `selfId`
- [ ] B1c 入站 `origin` 标签（self / member / peer_bot / human）与发送 ledger 关联兜底；`[sender:...]` 标签增加 origin；`stripUserSpoofedSenderPrefix` 改为转义正文中所有伪造标签（方案 §3.4）
- [ ] B2 **入站去重 / 单一入口选举**（审查第 7 条）：群里每个成员 Bot 都会收到同一条人类消息，N 个 Endpoint 会产生 N 个入站事件。按 平台 + 会话 + 平台消息 id 去重，或者每个 Room 选一个入站 Endpoint，保证每条消息只路由一次。同时更新方案 §3.2 / §3.4
- [ ] B2b Room Router（@ / 回复 → 对应成员；否则交给 coordinator，没有 coordinator 就按角色匹配）和 Room Bus（handoff 事件 + 走正常发送链的群内可见投影）
- [ ] B3 Task 状态机（created → assigned → in_progress → done / blocked / cancelled，加 handoff），使用事件溯源，并用 `@zhin.js/database` 持久化
- [ ] B4 护栏：handoff 深度上限、每分钟 turn 上限、同一 Room 串行发言、人类取消、敏感操作只接受配置的人类账号、**每个账号的发送频率上限**（QQ 个人号有被平台风控封号的风险）
- [ ] B5 重写 `examples/multi-agent-room`：Sandbox 里 3 个 Bot（coordinator / researcher / writer）在同一个群里协作，作为端到端验收测试。跑通 `pnpm check:all`

## 阶段 C：切换与清理

- [ ] C1 检查 Generation Projection / Tool Runtime 里程碑的状态。已经可用的话，把成员 turn 接到 generation 上，把 handoff / task 工具接到 Tool Runtime 上；还不可用的话，标记为 `阻塞` 并写明缺什么，继续做 C2
- [ ] C2 默认切到新 Room，配置中提供选择开关
- [ ] C3 删除 legacy 迁移代码（`legacy-*-migration`、`agent-legacy-payloads` 命令），已确认没有线上数据
- [ ] C4 移出主路径：remote dispatch / callback / issuance（冻结，不做 A2A）、portfolio、scheduler / preemption、data-governance、overlay-pack / github / self-delivery；能删就删，不能删就移到可选插件
- [ ] C5 简化 acceptance：去掉独立的验收引擎，reviewer 改为普通角色
- [ ] C6 文档：在 `agent-workroom-orchestration-decision-map.md` 中把冲突条目标为 Superseded，新增 ADR，更新 README / 示例文档，补 changeset。跑通 `pnpm check:all`，在本文末尾写总结

## 审查记录

### 第 1 轮（2026-10-13，审查 A1 + A2a）

- Blocking 1 `plugin-runtime-api` 快照没有更新 → 已修复（da6677193）
- Blocking 2 缺少 changeset → 已修复（`.changeset/split-workroom-runtime.md`）
- Should fix 3 顺序不变量缺少测试 → A2b
- Should fix 4 架构检查没有覆盖 `workroom-runtime` → A2b
- Should fix 5 合并后的 Console 视图让 agent console 依赖 Workroom → A4c 的前置条件
- Should fix 6 方案文档有事实错误 → A2b
- Should fix 7 多个 Bot 会重复处理同一条人类消息 → 新增 B2
- 补充：每个账号的发送频率上限 → B4
- Nit 若干 → A2b

### 第 2 轮（2026-10-13，审查 A2b）

- 无 Blocking
- Should fix：顺序不变量测试只断言 `cause: expect.any(Error)`，证明不了是损坏行导致的拒绝 → A2b-1
- Nit：方案 §1.2 没有提到入口文件的 re-export（并入 A2b-1）；Console key 重叠测试没有覆盖 symbol key（不处理）

### 第 3 轮（2026-10-13，审查 A2b-1）

- 无 Blocking，无遗留问题

### 第 4 轮（2026-10-13，审查 A2c）

- 无 Blocking
- Should fix：公开的 `createDeferredCapabilityPlan` 把 `authority` 改名为 `ceiling`，旧字段被静默忽略，是 fail-open → A2c-1
- Should fix：新的引用约束检查复用 `parseImports`，跳过了 type-only import → A2c-1
- Nit：ceiling 返回值未校验为子集；barrel 整文件豁免而非只放行 re-export；`workroom_` 前缀写死在 generic 层 → 并入 A2c-1

### 第 5 轮（2026-10-14，审查 A2c-1）

- 无 Blocking
- Should fix：`parse-imports.mjs` 对 `export type * from` 匹配两次，barrel 检查会误报（目前 barrel 未使用该写法，潜伏）→ A2c-2
- Nit：`export * as ns from` 未被解析，非 barrel 文件可绕过引用检查；`RESERVED_CONTROL_TOOL_PREFIX` 成为公开导出但 changeset 未提 → 并入 A2c-2

### 第 6 轮（2026-10-14，审查 A2c-2）

- 无 Blocking，无遗留问题

### 第 7 轮（2026-10-14，审查 A3）

- 无 Blocking
- Nit：方向约束报错信息只提 workroom/；自测未覆盖内联 `import()` 类型与 `export { x } from`；`canonical-value.ts` 注释过时 → A3-1

### 第 8 轮（2026-10-14，审查 A3-1）

- 无 Blocking，无遗留问题

### 第 9 轮（2026-10-14，审查 A4a）

- 无 Blocking
- Should fix：搬迁后 agent 内其他文件可以通过 `@zhin.js/workroom` 裸说明符绕过 A2c 引用边界检查（目前没有文件这样做）→ A4a-1
- Nit：agent 侧 112 个兼容层没有身份 / 内容测试；`tsconfig.typecheck.json` 未显式包含新包 src；新包深路径导出一经发布就是公开面；`capacity-control-outbox-fixture.ts` 在两个包各有一份（A4b 删除 agent 侧即可，不单独处理）→ 前三项并入 A4a-1

### 第 10 轮（2026-10-14，审查 A4a-1）

- 无 Blocking，无 Should fix（A4a-1 是审查后续条目，以下 Nit 只记录，不新建条目，阶段末统一评估）
- Nit：新用例只测了 `isWorkroomPackageSpecifier` 等辅助函数，没测到 `check-architecture-layers.mjs:489` `resolveDomain` 的接线；删掉那一行检查测试仍全过。建议把 agent 引用边界判定抽成 `scripts/lib/` 纯函数（file、content、isBarrel → 违规列表），或对临时 fixture 跑一次检查脚本。可在 A5 改架构检查时顺带处理
- Nit：README / changeset 说深路径在 A4b/A5 后“移除或收窄”并且“together with those compatibility stubs”，而兼容层测试与 stub 标记写的是 stub 在 A4b 删除，时间说法不一致。建议统一为：stub 在 A4b 删除，深路径导出最晚在 A5 收窄。可在 A4b 顺带改

### 第 11 轮（2026-10-14，审查 A4b）

- 无 Blocking
- Should fix：CLI 把 `@zhin.js/workroom` 设为必需依赖，经由它连带强制安装 agent，违背“AI 另装”且属于阶段 A 不允许的行为变化 → A4b-1
- Should fix：changeset 未列 `zhin.js`，而 `zhin.js/agent` 公开面也缩小了 → A4b-1
- Should fix：agent README 仍描述已迁走的 workroom 目录 → A4b-1
- Nit：`ZhinAgentPrivate` 成为 `@zhin.js/agent/core` 公开导出；workroom 与 zhin 同为 level 5 且控制台输出顺序不一致 → 并入 A4b-1

## 运行日志

（每次运行追加一行：时间、做了哪个条目、结果或阻塞原因）

- 2026-10-13 交互会话：完成 A1、A2a，以及第 1 轮审查的两个 Blocking；配置定时任务
- 2026-10-13 交互会话：用 step-workflow.js 完成 A2b（4 个 agent，约 4 分钟，验证全部通过，审查无 Blocking）
- 2026-10-13 18:49 定时运行：完成 A2b-1（4 个 agent，约 2.5 分钟，相关测试 / type-check / 架构与 API 快照检查通过，审查无问题）
- 2026-10-13 定时运行：完成 A2c（4 个 agent，约 5.5 分钟，build / type-check / 436 个 plugin-runtime 测试 / 架构与 API 快照 / workroom-ssot 检查通过，审查无 Blocking，2 个 Should fix 新增为 A2c-1）
- 2026-10-14 手动触发运行：完成 A2c-1（4 个 agent，约 3.7 分钟，build / type-check / 401 个测试 / 架构与 API 快照检查通过，审查无 Blocking，1 个 Should fix 新增为 A2c-2）
- 2026-10-14 08:46 定时运行：完成 A2c-2（4 个 agent，约 1.9 分钟，脚本自测 27 个 / deferred-capability-plan 22 个测试、type-check、check:architecture、API 快照检查通过，审查无问题）。备注：Workflow 工具拒绝 `scriptPath` 指向 scheduled-tasks 目录（会话不可读），改为内联传入同一脚本，内容未改
- 2026-10-14 定时运行（同一次）：完成 A3（4 个 agent，约 2.7 分钟，agent build / type-check / 36 个脚本自测 / 145 个相关测试 / check:architecture / API 快照检查通过，审查无 Blocking，3 个 Nit 新增为 A3-1）
- 2026-10-14 09:39 定时运行：rebase 到最新 origin/main（11 个提交无冲突），build 通过；完成 A3-1（4 个 agent，约 1.9 分钟，42 个架构脚本自测 / agent build / type-check / check:architecture / API 快照 / eslint 通过，审查无问题）。备注：`scriptPath` 仍被拒绝，继续内联传入同一脚本
- 2026-10-14 同一次定时运行：完成 A4a（4 个 agent，约 17 分钟，两包 build / type-check / 1193 + 428 个相关测试 / check:architecture、domain-module-boundaries、workroom-ssot、harness-paths / API 快照通过，审查无 Blocking，1 个 Should fix 新增为 A4a-1）。备注：eslint 对 3 个 .mjs 脚本是忽略状态，未实际 lint
- 2026-10-14 10:49 定时运行：rebase 到最新 origin/main（13 个提交无冲突），install / build 通过；完成 A4a-1（4 个 agent，约 9.8 分钟，两包 build / type-check / 874 个相关测试 / check:architecture / API 快照 / eslint 通过，审查无 Blocking，2 个 Nit 只记录）。备注：继续内联传入 step-workflow.js，内容未改
- 2026-10-14 同一次定时运行：完成 A4b（4 个 agent，约 19.6 分钟，四包 build / type-check / 2987 个相关测试 / check:architecture、domain-module-boundaries、harness-paths、no-removed-plugin-api / API 快照 / eslint 0 error 通过，审查无 Blocking，3 个 Should fix 新增为 A4b-1）
