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
- [x] A4b-1 处理第 11 轮审查意见：`basic/cli/package.json` 中 `@zhin.js/workroom` 改为 devDependency + 可选 peerDependency（与 `@zhin.js/agent` 一致，恢复“AI 另装”的安装图），`@zhin.js/a2a` 考虑把 workroom 也设为 peer 避免出现两份 agent / plugin-runtime 实例；`.changeset/move-workroom-runtime.md` 补 `"zhin.js": patch` 并说明 `zhin.js/agent` 用户改从 `@zhin.js/workroom` 导入；`packages/im/agent/README.md` 删掉或迁走 Workroom Kernel / Journal / Projection Outbox 段落。顺带 Nit：`ZhinAgentPrivate` 从 `@zhin.js/agent/core` 公开导出，标 `@internal` 或改窄接口（可留给 A5）；`check-architecture-layers.mjs` 中 workroom 与 zhin 同为 level 5，补注释或调整层级
  - 2026-10-14 · 「fix: 恢复 workroom 可选安装并补全 changeset 与文档」· CLI / a2a 对 workroom 改为 dev + 可选 peer；changeset 补 `zhin.js`；agent README 的 Journal / Outbox 段落迁到 workroom README；`ZhinAgentPrivate` 标 `@internal`；架构检查注释说明同级 level 5
- [x] A4c CLI 改为可选加载 workroom（未安装时 Agent 照常工作，Console 的 workroom 页面降级）。前置条件（审查第 5 条）：`agent-console.ts` 在缺少 Workroom 端口时只返回 agent console，`AgentConsolePort` 的 `workroom*` 字段改为可选，Workroom 路由自己返回 503；同步修改 `api.test.ts` 中“缺少 Workroom 端口时返回 null”这个测试。更新 api-surface / plugin-runtime-api 快照。注意（第 12 轮 Nit）：CLI 的 `agent/host-installer.ts`、`agent/config.ts`、`agent-workroom.ts` 等仍静态导入 `@zhin.js/workroom`，A4c 要把它们改为可选加载，并删除 changeset 中相应的临时说明
  - 2026-10-14 · 「refactor: CLI 可选加载 @zhin.js/workroom」· CLI 对 workroom 只剩 `import type`，取值改为动态加载；只有包本身缺失才降级，已安装但加载 / 激活失败仍报错（有测试）；Console 缺 Workroom 端口时只返回 agent console，6 个 Workroom 路由返回 503；新增边界测试防止静态导入回归；快照无变化
- [x] A4c-1 处理第 13 轮审查 Nit：`basic/cli/src/plugin-runtime/console/agent-console.ts` 解析 `workroomHostToken` 的 `catch {}` 改为用 `isWorkroomPackageMissing` 区分，只有包缺失才降级，其他错误 warn 或置空；两个 import 都完成后再一次性给 `agentModule` 赋值，消除路由短暂返回 503 的窗口；`protocol-host-installer.ts` 的 `.catch` 只在包缺失时包装成 a2a 安装提示，其他错误原样抛出；`optional-workroom-boundary.test.ts` 补副作用导入 `import '@zhin.js/workroom'` 的匹配，并约束 `plugin-runtime/workroom/` 以外的文件只能 `import type` 或动态 `import()` 引用 `workroom/*.js`；顺带清理 basic/cli 中 27 个 `no-duplicate-imports`（`@zhin.js/workroom`）警告和 `agent-workroom.ts` 末尾多余空行
  - 2026-10-14 · 「fix: 区分 Workroom 包缺失与加载失败」· Console 只在包缺失时降级（其他错误 warn），`agentModule` 两个 import 完成后一次赋值；a2a 只在包缺失时给安装提示，其他错误原样抛出；边界测试覆盖副作用导入与目录外 `workroom/*.js` 引用；27 个重复 import 合并
- [x] A5 `check:architecture` 增加规则：`@zhin.js/agent` 禁止导入 `@zhin.js/workroom`。CLI 测试改为通过公开接口测试，不再 import 内部 coordinator。补 changeset。跑通 `pnpm check:all`
  - 2026-10-14 · 「refactor: 收尾阶段 A 的 Workroom 边界检查与 CLI 测试」· A4b 已有的 agent→workroom 规则原样抽成 `scripts/lib/agent-workroom-boundary.mjs` 并测试接线；5 个 CLI 测试改走公开 `module.js`，其余 17 个保留内部导入并写明原因，由允许清单把关；a2a 补包缺失 / 其他错误两个测试；确认深路径导出已在 A4b 移除，README / changeset 说法统一；workroom 对 agent / plugin-runtime 暂留普通依赖并在 README 说明；`pnpm check:all` 通过

## 阶段 B：新 Room 核心（在 `@zhin.js/workroom` 内，与旧机制并存）

- [x] B1a Room / Member / Role 定义与校验，从现有 `catalog-definition` 简化而来（见方案 §3.1）
  - 2026-10-14 · 「feat: 新增 Room / Member / Role 定义与校验」· `@zhin.js/workroom` 新增 `src/room/`，纯定义层、不依赖任何 `@zhin.js/*`；校验收集全部问题后抛 `RoomDefinitionError`，拒绝未知字段与原型污染名，返回深冻结副本；与旧 Catalog 并存；15 个单元测试
- [x] B1a-1 处理第 16 轮审查意见：`validate-room.ts` 的会话归属 key 去掉 endpoint，改为 `adapter:kind:id`（QQ / OneBot 群号平台全局唯一，否则两个启用的 Room 可经不同 Bot 认领同一群），补冲突测试；校验成员 `botEndpoint.adapter` 与 Room 会话 adapter 一致，补测试；agent 名大小写不敏感重复时报错（@ 路由会歧义），补测试。顺带 Nit：`ROOM_CONVERSATION_KINDS`、`ROOM_RESERVED_NAMES` 用 `Object.freeze`；测试补对冻结结果的实际修改断言，以及 `members` 非数组、`accepts` 重复、role `description` 非字符串的用例
  - 2026-10-14 · 「fix: 收紧 Room 定义校验」· 会话归属 key 改为 `adapter:kind:id`；成员 Bot adapter 必须与会话一致；agent 名大小写不敏感去重；常量数组冻结；Room 测试 15 → 20 个
- [x] B1b Endpoint 上报登录后的平台账号 `selfUserId`（先做 ICQQ / OneBot，以及 Sandbox）；进程级 Peer Registry。复用已有实现：`plugins/adapters/icqq/src/icqq-inbound.ts` 的 `isSelf` 过滤、`kook/src/endpoint.ts` 的 `selfId`
  - 2026-10-14 · 「feat: Endpoint 上报 selfUserId 并新增进程级 Peer Registry」· `@zhin.js/adapter` 新增 `peer-registry.ts`（`@internal` 导出），Endpoint 上报登录账号且仅在 generation 激活后登记、回滚不登记、retire 时移除；ICQQ / OneBot11（ws / wss，`get_login_info` 探测）/ Sandbox 接入；无效值不上报、不回退到配置 id；402 个相关测试通过
- [x] B1b-1 处理第 18 轮审查意见：`packages/im/adapter/src/peer-registry.ts` 的 `registerEndpoint` 加登记序号 / generation 归属，旧实例在新实例登记后再次上报时不得覆盖（否则旧实例 retire 会删掉新实例条目），补“新实例登记 → 旧实例重报 → 旧实例 retire → 新条目仍在”测试；`lookup` / `isReady` / `selfOf` 对空或非字符串输入返回未命中而不是抛错（B1c 入站路径会逐条调用），只在写路径严格校验，更新相应测试。顺带 Nit：ICQQ `endpoint.ts` 把上报移到 `#resolveStartOnline` 之后或单独 try/catch；OneBot ws / wss `stop()` 清空 `selfUserId` 且探测结果在 stop 后不再写入；补 wss 路径与 factory 默认 `probeLoginInfo: true` 的测试；`plugins/adapters/sandbox/src/endpoint.ts:7` 的 `no-duplicate-imports` 警告
  - 2026-10-14 · 「fix: Peer Registry 登记归属与读路径容错」· 登记带归属序号，旧实例重报不覆盖已登记的新实例；`lookup` / `isReady` / `selfOf` 对无效输入返回未命中；ICQQ 上报隔离、OneBot ws / wss stop 清空 `selfUserId`；补 wss 与 factory 默认值测试；413 个相关测试通过
- [x] B1b-2 处理第 19 轮审查意见（涉及正确性，所以新建条目）：`packages/im/adapter/src/peer-registry.ts:86` 的归属序号在 owner 首次 `registerEndpoint` 时才分配，旧实例激活后迟迟未上报、新实例先上报时，旧实例的首次上报仍会覆盖新条目，retire 后新实例掉出注册表。把序号分配提前到 Endpoint bind / 激活时（如 internal `reserveClaim(owner)`，或在 `RegisterEndpointInput` 中显式传 generation 序号），补“旧实例激活 → 新实例激活并上报 → 旧实例首次上报 → selfOf 仍为新值 → 旧实例 retire 后新条目仍在”测试。顺带 Nit：`plugins/adapters/onebot11/tests/onebot11-self-user-id.test.ts:146` 的 ws / wss“stop 时探测在途不写入”测试测不到 `#stopped` 判断，改为用手动 deferred 让探测在 stop 之后 resolve 出 user_id，再断言未写入
  - 2026-10-14 · 「fix: Peer Registry 在 Endpoint 激活时预留归属序号」· 新增 `PeerRegistry.reserve()`，Endpoint 激活时（直接激活与 admission `onActivate` 两条路径）即取序号，晚上报的旧实例不再覆盖新条目；registry 与真实 bind / activate / retire 两层补测试；OneBot ws / wss 用手动 deferred 让探测在 stop 后 resolve，测到 `#stopped` 判断
- [x] B1c 入站 `origin` 标签（self / member / peer_bot / human）与发送 ledger 关联兜底；`[sender:...]` 标签增加 origin；`stripUserSpoofedSenderPrefix` 改为转义正文中所有伪造标签（方案 §3.4）
  - 2026-10-14 · 「feat: 入站 origin 标签与发送 ledger 关联兜底」· core 新增 `inbound-origin.ts` / `outbound-ledger.ts`，origin 只依据 Peer Registry、出站 ledger、`roomMembershipToken` 判定，不读 metadata / 正文；self 丢弃，member / peer_bot 只记录不分发；判定出错 fail-closed 为 peer_bot；`[sender:]` 加白名单 origin；伪造标签改为全局转义；changeset 覆盖 core / ai / agent / zhin.js / cli
- [x] B1c-1 处理第 21 轮审查意见（涉及正确性，所以新建条目）：`packages/im/core/src/plugin-runtime/im/inbound-origin.ts:538` 的摘要兜底对私聊和非 Room 群也生效，并且优先级高于明确的 human 判定；命中后映射成 `self`，`inbound-runtime.ts:299-306` 直接 return，不分发也不写 `recordIncoming`，真人 30 秒内复读 Bot 文本会被静默丢弃。收窄：只在 group / channel 会话启用；`registry.isReady(endpointId)` 且 `selfOf` 已知、sender 不等于它且不在 Registry 时不走摘要匹配；摘要命中至少映射为 `peer_bot`（只记录）而不是 `self`。补“已知真人复读 Bot 文本仍按 human 处理（或至少被记录）”测试。同时补运行时层测试（`packages/im/core/tests/plugin-runtime/im-runtime.test.ts:3233` 附近）：peer_bot / member 消息在 conversationEvents 中有入站记录、self 回显没有；注入 `lookup` / `selfOf` / `isMember` 抛错时 `receive` 正常返回 `{matched:false}` 且命令 / 路由未被调用。顺带 Nit：`plugin-runtime/im/index.ts:14` 的 `export *` 改为具名导出公开类型（`MessageOrigin`、`isMessageOrigin`、`RoomMembershipPort`、`roomMembershipToken`），classifier 标 `@internal`
  - 2026-10-14 · 「fix: 收窄入站 origin 摘要兜底并补运行时 fail-closed 测试」· 摘要兜底只在 group / channel 启用，Endpoint 就绪且 `selfOf` 已知、sender 非 self 且不在 Registry 时跳过；命中映射为 `peer_bot` / `member`（只记录）不再是 `self`；补真人复读与运行时层入站记录 / 抛错 fail-closed 测试；`im/index.ts` 改具名导出，classifier 标 `@internal`；patch changeset
- [x] B1c-2 处理第 22 轮审查意见（涉及 fail-closed 不变量的测试覆盖，所以新建条目）：`packages/im/core/tests/plugin-runtime/im-runtime.test.ts` 约 3323-3334 行的 `withRegistry` 用 `{ ...createPeerRegistry(), ...override }` 构造 registry，PeerRegistry 是类、方法在原型上，展开后只剩被覆盖的方法，classifier 调 `isReady` 即抛 not a function 被兜底为 `peer_bot`，“lookup 抛错”“selfOf 抛错”两个用例实际测不到对应路径。改为保留真实实例并只 `vi.spyOn` 目标方法；lookup 用例先登记已知 `selfUserId` 的 Endpoint，确保执行确实走到 `lookup`（可加断言 spy 被调用）。顺带 Nit：在 `inbound-origin.ts` 私聊分支加注释或测试，固定“未就绪 Endpoint 的私聊自回显不走摘要兜底、按 human 处理”这一取舍
  - 2026-10-14 · 「test: 修正 origin 抛错用例的 registry 构造并固定私聊取舍」· 运行时层改用真实 PeerRegistry 实例并只 spy 目标方法，Endpoint 登记 `selfUserId` 后用例确实走到 `lookup` / `selfOf` 且断言 spy 被调用；私聊分支补注释与“未就绪 Endpoint 私聊自回显按 human 处理”classifier 测试；只改测试和注释
- [x] B2 **入站去重 / 单一入口选举**（审查第 7 条）：群里每个成员 Bot 都会收到同一条人类消息，N 个 Endpoint 会产生 N 个入站事件。按 平台 + 会话 + 平台消息 id 去重，或者每个 Room 选一个入站 Endpoint，保证每条消息只路由一次。同时更新方案 §3.2 / §3.4
  - 2026-10-14 · 「feat: Room 会话入站去重」· core 新增 `inbound-dedup.ts`，按 adapter + 会话 + 平台消息 id 同步去重；只在 `RoomMembershipPort.hasRoom(conversation) === true` 时生效（目前无实现，行为不变），重复入站只记录不路由；判定抛错 fail-closed（记录并 publish、告警、不路由）；方案 §3.2 / §3.4 更新；顺带修正 inbound-origin 私聊摘要未消耗的断言
- [x] B2-1 处理第 24 轮审查意见：改写 `.changeset/workroom-inbound-dedup.md`，如实说明 `RoomMembershipPort` 新增可选 `hasRoom(conversation)`，返回 true 时同一会话多 Endpoint 收到的人类消息只路由一次、其余只记录，不实现 `hasRoom` 则行为不变；在方案 §3.2 / §3.4 以及 `inbound-origin.ts` 中 `hasRoom` 的文档注释写明：`hasRoom` 的实现必须与 B2b Room Router 一起上线，Router 必须对所有成员 Endpoint（而不只是去重胜出的 Endpoint）解析 @ / 回复目标以及待回答的 interaction / prompt（涉及正确性约束，所以新建条目）
  - 2026-10-14 · 「docs: 写明 hasRoom 必须与 Room Router 一起上线」· changeset 改为如实描述可选 `hasRoom` 与“未实现则行为不变”；方案 §3.2 / §3.4 与 `inbound-origin.ts` 注释写明 Router 须对所有成员 Endpoint 解析 @ / 回复与待回答 interaction；确认 `inboundDeduper` 已标 `@internal`；不改运行时行为
- [x] B2b Room Router（@ / 回复 → 对应成员；否则交给 coordinator，没有 coordinator 就按角色匹配）和 Room Bus（handoff 事件 + 走正常发送链的群内可见投影）
  - 2026-10-15 第 1 次执行失败（re-review 仍有 Blocking，改动已回滚，半成品 patch 存在当次会话 scratchpad）。重试时必须先处理“审查记录”第 26 轮列出的问题
  - 2026-10-15 · 「feat: 新增 Room Router 与 Room Bus」· 第 2 次执行完成，第 26 轮问题全部处理：平台按钮回调（action 段）跳过 Room 路由与去重、由接收 Endpoint 处理；pending 按内容且只计入属于该会话 fallback 的 payload；目标优先 + 2 秒宽限期回退；@alias 用 Unicode 词边界；Room Bus 只经 `OutboundMessageService.send`；生产代码尚未提供 `roomMembershipToken`，运行时行为不变
- [x] B2b-1 处理第 27 轮审查意见（涉及“不静默丢消息”的正确性，所以新建条目）：`packages/im/core/src/plugin-runtime/im/inbound-dedup.ts:146` 对不是目标、也不在 `decision.fallbacks` 中的 Endpoint 副本直接判为 `duplicate`，只打 debug 日志（`inbound-runtime.ts:267` 的 `room_non_target_copy`）。`hasRoom` 只按会话匹配（`room-membership.ts:18`，不看 Endpoint），所以同进程中的非成员 Bot、以及 `route` 时未就绪的成员 Endpoint 的副本也会被丢弃；例如 Telegram 隐私模式下 `@X hello` 只有非成员 X 收到，route 却选 coordinator，消息无人处理，且 @ 非成员的消息被强制 `mentioned=true` 交给 coordinator。修复：只对接收 Endpoint 是 Room 成员的副本做路由与去重（`hasRoom` / `route` 检查 `conversation.endpoint.id` 是否在 `room.memberByEndpoint`，或 core 把非成员 Endpoint 当作非 Room 群处理）；成员副本因不在 decision 中被丢弃时改为 warn；补 ImRuntime 测试（只有非成员 Endpoint / 不在 fallbacks 的成员收到的副本不丢失）。顺带 Nit：`packages/im/core/tests/plugin-runtime/im-runtime.test.ts:3784` 测试名写“@A”但消息无 mention 段、答复用序号 `1` 而非标签，改为带 A 的 mention 段（或用真实 `createRoomMembershipPort`）并补标签 `Go` 答复用例，或改名
  - 2026-10-15 · 「fix: Room 路由按接收 Endpoint 成员关系判定，避免静默丢消息」· `hasRoom` / `route` 按会话 + 接收 Endpoint 判定，非成员 Bot 按普通群处理；不在 decision 中的成员副本作为最低优先级接管并打 warn；目标副本已到或已有人接管时仍判 duplicate；三层补测试
- [x] B2b-2 处理第 28 轮审查意见（涉及路由正确性，所以新建条目）：`packages/im/workroom/src/room/room-router.ts:139` 人类 `@X hello`（X 为非成员 Bot）且成员 Endpoint 也收到副本时，mentionedMembers 忽略 X、落到 coordinator 分支，coordinator 被强制 `mentioned=true` 插话。修复：mention 段指向的账号都不属于成员时不走 coordinator / role 分支，返回无目标，让成员副本保持原有 mentioned 语义（先到先得、不强制 mentioned）；workroom router 测试补“@ 非成员不交给 coordinator”，ImRuntime 测试补“成员副本不被强制 mentioned”。同时同步方案 `docs/plans/workroom-group-collaboration-redesign.md:132`：hasRoom 按接收 Endpoint 成员关系判定，非成员按普通群处理；不在 `[目标, ...fallbacks]` 中的成员副本作为最低优先级接管并打 warn `room_unlisted_member_takeover`
  - 2026-10-15 · 「fix(workroom): @ 非成员时 Room Router 不交给 coordinator」· mention 都不指向成员时返回无目标，成员副本先到先得、不强制 mentioned；方案 §3 同步 hasRoom 成员关系与 room_unlisted_member_takeover
- [x] B3 Task 状态机（created → assigned → in_progress → done / blocked / cancelled，加 handoff），使用事件溯源，并用 `@zhin.js/database` 持久化
  - 2026-10-15 · 「feat(workroom): Room Task 状态机与事件溯源持久化」· `room/` 下新增小型 decide / evolve / replay 状态机（6 个状态、handoff 回到 assigned）、每个 Room 一条事件流（CAS 追加、批量原子）、数据库 journal（digest / 损坏行 fail-closed）与内存 journal；未接入运行时
- [x] B3-1 处理第 30 轮审查意见：`packages/im/workroom/src/room/room-task-service.ts:110` 的 `dispatch(stored)` 在每个 Room 的串行链内 await 订阅者，订阅者对同一 Room 再次 `execute` 会死锁（C1 把 RoomBus / 工具作为订阅者时容易触发），慢订阅者也会阻塞该 Room 所有命令。改为串行段结束后再分发（serialized 返回已存事件，`execute` 在 run 完成后分发），补“订阅者对同一 Room 调用 execute 不死锁”测试。顺带 Nit：`database-room-task-journal.ts:67` 空批量不校验 `expectedSequence`，与内存 journal 行为不一致，统一并补一个对两种 journal 都跑的契约测试；`room-task.ts:199` 已 `assigned` 时再次 `task.assigned` 会绕过 handoff 的 from 校验且不计 handoffCount，拒绝重派给当前负责人，并在注释或方案中写明 C1 的 authorize 必须限制谁可以对已分配的 Task 重新 assign
  - 2026-10-15 · 「fix(workroom): Room Task 订阅者分发移出串行段并收紧重复指派」· 订阅者在串行段结束后分发（重放命令不分发），补重入不死锁 / 慢订阅者不阻塞 / 重放不重复分发测试；DB journal 空批量校验 `expectedSequence`，两种 journal 共用契约测试；`assigned` 时指派给当前负责人被拒绝，C1 authorize 约束写入 JSDoc 与方案
- [x] B4 护栏：handoff 深度上限、每分钟 turn 上限、同一 Room 串行发言、人类取消、敏感操作只接受配置的人类账号、**每个账号的发送频率上限**（QQ 个人号有被平台风控封号的风险）
  - 2026-10-15 · 「feat(workroom): Room 护栏组件」· `room/` 新增 handoff 深度 / 来回弹跳上限、每分钟 turn 上限与同一 Room 串行发言、人类取消、敏感操作账号白名单（Task authorizer）、按账号的发送频率限制器（包装 Room Bus 的 outbound，仍走发送链）；判定出错 fail-closed；只导出未接入运行时
- [x] B4-1 处理第 32 轮审查意见（涉及安全与 fail-closed，所以新建条目）：`packages/im/workroom/src/room/room-task-authorizer.ts:31` 除 `cancel` 外一律放行，单独接入时任何人都能对已分配 Task 重新 assign，绕过 B4 的 handoff 深度 / 来回弹跳上限；改为可组合且默认 fail-closed（无角色检查时拒绝对 assigned / blocked Task 的 assign，或必须传入 `next` authorizer，或改名为局部检查），补“未提供角色检查时 assign 不被静默放行”测试，删掉锁定“其他命令放行”的用例。`room-send-limiter.ts` 只覆盖 Room Bus 投影，同一账号的 `$reply` / generation 出站不计入：提供可作为 outbound middleware 或包装共享 `OutboundMessageService` 的形态（仍在发送链内），按账号共享同一实例，并在 changeset / 方案写明 C1 必须让成员 Endpoint 的所有出站共用它。顺带：`room-guards.ts:275` `cancelRoom` 任意 human 都能清空队列，限制为清队列需 `authorizeSensitive` 账号（任意 human 仅能中断当前 turn）并补测试；`room-guards.ts:211` 未传 `history` 时静默跳过弹跳检查，改为必填；`admitTurn` 与 `runExclusive` 重复占用窗口，JSDoc 写明或改为内部；`room-task-authorizer.test.ts:60` 恒真的排序用例删除或改为真实并发用例
  - 2026-10-15 · 「fix(workroom): Room 护栏默认 fail-closed 并提供账号级共享发送限流」· 无角色检查时一律拒绝 `assign`，`next` 可组合且抛错视为拒绝；`checkHandoff` 必须传 `history`；清队列需 `room.cancel_queue` 权限（任意 human 仍可中断当前 turn）；`admitTurn` 改为内部；发送限流器提供共享实例的 `send` / `middleware` 两种形态，changeset 写明 C1 让成员 Endpoint 所有出站共用
- [x] B4-2 处理第 33 轮审查意见（涉及 fail-closed 契约与发送链正确性）：`packages/im/workroom/tests/room/room-task-authorizer.test.ts:95` 删掉“next 缺省时放行 start / block / handoff”用例（B4-1 只改了名，仍把 fail-open 锁成契约），只保留“其他命令交给 next”的断言，并在 `next` 的 JSDoc 写明 C1 负责 start / block / handoff 的角色检查。`room-send-limiter.ts:66` 的 `middleware(envelope, next)` 不是 core outbound middleware 的签名（`defineMiddleware({ target: 'outbound' })` 的 envelope 在 `context.input`），直接传 context 会让 `reserve` fail-closed 拒绝所有出站：提供直接返回 outbound middleware 定义的 helper（结构类型，不新增依赖）或在 JSDoc / changeset 给出适配示例。顺带：JSDoc / changeset 写明同一出站路径只能用一种形态（middleware 与 `send` 叠用会重复计数），`createRateLimitedOutbound` 标注仅测试 / 独立使用；`room-guards.ts:306` 非敏感 human 清队列被拒时 `RoomCancelResult` 增加 `queueRefused` 原因或至少 `logger.warn`
  - 2026-10-15 · 「fix(workroom): 收紧 Room 护栏契约并提供 outbound middleware helper」· 删除锁定 fail-open 的用例，`next` JSDoc 写明 C1 负责 start / block / handoff 角色检查；发送限流器新增 `outboundMiddleware()`（结构类型，读 `ctx.input`）；文档写明同一路径只用一种形态、`createRateLimitedOutbound` 仅测试 / 独立使用；清队列被拒时返回 `queueRefused` 并 `logger.warn`
- [x] B5 重写 `examples/multi-agent-room`：Sandbox 里 3 个 Bot（coordinator / researcher / writer）在同一个群里协作，作为端到端验收测试。跑通 `pnpm check:all`
  - 2026-10-15 · 「feat(workroom): 用新 Room 核心重写 multi-agent-room 示例」· 示例内组装 Room 核心（`src/team.ts`，未接入默认运行时），planner 更名 coordinator 并新增 writer；端到端测试用真实 ImRuntime + Sandbox 形状 fixture（无网络 / LLM）覆盖去重路由、两次 handoff、经发送链的群内投影、Task 事件序列与全部 B4 护栏；唤醒按 `event.sequence` 水位去重；`room-task-service.ts` 修正 execute 输入类型（patch changeset）；`pnpm check:all` 通过

## 阶段 C：切换与清理

- [ ] **阻塞** C1 检查 Generation Projection / Tool Runtime 里程碑的状态。已经可用的话，把成员 turn 接到 generation 上，把 handoff / task 工具接到 Tool Runtime 上；还不可用的话，标记为 `阻塞` 并写明缺什么，继续做 C2
  - 阻塞（2026-10-15 检查）：部件已有（generation-owned ToolIndex / SkillIndex、CapabilityIngress、AgentRuntime + FullAgentTurnEngine、`TurnToolRuntime`、`turnJournalStoreToken`），但缺三样：① 没有 Room 的 turn 入口——TurnRequest 的 execution profile 只有 IM 与 `schedule`（`full-agent-turn-engine.ts:64/368/424`），需在 agent 包新增 `room` profile（principal / origin / 会话地址、取消信号与 Room 事件绑定），属跨 agent / core 的公开契约变更，方案未定义；② `room_task_events` 独立 journal 与 `turnJournalStoreToken` 的 JournalStore 没有桥接（方案 §3.6 要求 Room 事件流消费同一个持久化 Journal），也未确认存在持久化 JournalStore 实现；③ Room 工具（handoff / block / complete / assign）走 `tools/*.ts` 所需的 Room token（RoomTaskService、RoomBus、guards）与 workroom 的 `definePlugin` 接线尚不存在，`room_task_events` 也未并入 `defineWorkroomDatabaseModels`
  - 选项：A. 等里程碑收口后再做 C1；B. 先做与里程碑无关的 C1a（已新增，见下）；C. 授权在 agent 包新增 `room` execution profile 并做 Room 事件流 → JournalStore 的桥，作为 C1 的一部分（范围大、改已发布包公开 API，需维护者确认契约）。默认按 A + B 推进
- [x] C1a C1 中与里程碑无关、现在可做的部分（全部在 `packages/im/workroom` 与 `examples/multi-agent-room` 内）：
  - `examples/multi-agent-room/src/team.ts:296` `bus.handoff` 返回 rejection（`!delivery.projected`）时改为 escalate：block 该 Task 并 @人类（注意此时 assignee 已是 `next.to`，block 的 `by` 要符合 `room-task.ts` 的转移校验），保留 `send_rejected` 记录；补用例
  - `team.ts:259` 在 `speak()` 之后、handoff / complete 之前再检查 `signal.aborted`，为真则不再推进；补“speak 期间打断”用例，断言没有 `task.handoff` / `task.completed`，下一个成员未被唤醒
  - `room-task-authorizer.ts` 新增基于 RoomDefinition 的角色授权 helper（作为 `next`）：start / block / complete 要求 `by` 是成员；handoff 要求 `to` 在 `role.handoffTo` 内且是成员；create 的 assignee 必须是成员；assign 只按角色限制（不改 `authorize` 签名）；抛错视为拒绝；更新头注释与测试
  - `room-send-limiter.test.ts:198` 补类型兼容用例：`defineMiddleware(limiter.outboundMiddleware())` 能通过类型检查并实际处理一次
  - 订阅者按 `event.sequence` 排序 / 去重的可复用 helper（乱序缓冲、重复丢弃），示例改用它；方案 §3.5 补一句“订阅者须按 sequence 排序或去重”；补并发 execute 用例
  - 新增公开导出需 changeset（patch）
  - 2026-10-15 · 「feat(workroom): Room 角色授权、事件排序 helper 与示例 handoff 失败升级」· 新增 `createRoomRoleAuthorizer` / `createRoomRoleAssignAuthorizer` 与 `room-event-sequencer.ts`（乱序缓冲、重复丢弃），示例 handoff 投影失败改为 block 并 @人类、speak 后复查打断，方案 §3.5 补排序要求，patch changeset；196 个 room / 示例测试通过
- [ ] C1a-1 处理第 36 轮审查意见（涉及 fail-closed，所以新建条目）：`packages/im/workroom/src/room/room-task-authorizer.ts:175` `createRoomRoleAssignAuthorizer` 拿到 RoomEntry 且没有 roomId 时不比对 `entry.id`，对任何 Room 的 assign 放行（与 `createRoomRoleAuthorizer:135` 不一致），改为拒绝 `unknown room` 并修正 `tests/room/room-task-authorizer.test.ts:199`；`examples/multi-agent-room/src/team.ts:289` `escalateAfterHandoff` 中代 `to` 执行 start / block 抛错时只记 `turn_error`，人类没被询问且排队的唤醒仍会让接收者正常跑 turn（handoff 投影失败后链路静默继续），改为失败时仍 `askHuman`，并丢弃该 handoff 的待唤醒或让 `runMemberTurn` 跳过投影失败的 Task，补强制 start / block 失败的用例；`room-send-limiter.test.ts:211` 的类型兼容用例实际不在 type-check 范围内且用 `as never`，把 `defineMiddleware(limiter.outboundMiddleware())` 放到会被类型检查的位置（如示例 src 的 `satisfies`），并注明为何从 `@zhin.js/core/feature/middleware` 子路径导入。顺带 Nit：`createRoomRoleAuthorizer:159` 的 `default` 分支只对 `assign` / `cancel` 返回 undefined，未知命令拒绝；`team.ts:329` `pendingWakes` / `releasedHandoffs` 在 `dispose()` 中清空；`room-event-sequencer.test.ts:84` 断言 raw 中 0..15 各出现一次或强制交错
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

### 第 12 轮（2026-10-14，审查 A4b-1）

- 无 Blocking，无 Should fix（A4b-1 是审查后续条目，以下 Nit 只记录，不新建条目）
- Nit：changeset 说只装核心时不再拉入 agent / workroom，但 CLI 仍静态导入 `@zhin.js/workroom`（`host-installer.ts:18`、`agent/config.ts:8`），A4c 前发版会让只装 agent 的用户找不到模块 → 已写进 A4c 的注意事项；建议 A4b-1 与 A4c 一起发版
- Nit：workroom 自己仍把 `@zhin.js/agent`、`@zhin.js/plugin-runtime` 列为普通 dependencies，版本不一致时仍可能出现两份实例 → 留给 A5 评估

### 第 13 轮（2026-10-14，审查 A4c）

- 无 Blocking，无 Should fix
- Nit：Console 解析 `workroomHostToken` 时 `catch {}` 不加区分，已安装但加载失败也被当作未安装（启动路径仍 fail-closed）；`agentModule` 分两步赋值有短暂 503 窗口；a2a 的 `.catch` 把所有错误包装成安装提示；边界测试不匹配副作用导入，也不检查间接引用 `workroom/*.js` → 涉及 fail-closed 原则，新增 A4c-1
- Nit：`agent-workroom.ts` 末尾多余空行 → 并入 A4c-1

### 第 14 轮（2026-10-14，审查 A4c-1）

- 无 Blocking，无 Should fix（A4c-1 是审查后续条目，以下 Nit 只记录，不新建条目）
- Nit：`protocol-host-installer.ts:136` 去掉 `.catch` 后，包缺失时报通用的 `WORKROOM_INSTALL_HINT`，不再点名 a2a。可保留一个只在包缺失时包装的 `.catch`，或给 `loadWorkroomPackage` 传上下文参数
- Nit：a2a 路径没有测试覆盖“包缺失 → 安装提示 / 其他错误 → 原样抛出”的区分（只有 Console 路径补了 `agent-console-load.test.ts`）。可在 A5 改 CLI 测试时顺带补

### 第 15 轮（2026-10-14，审查 A5，阶段 A 收尾）

- 无 Blocking，无 Should fix
- Nit：`scripts/check-architecture-layers.test.ts:281` 的接线测试只做字符串匹配并对真实仓库跑一遍，证明不了违规会被报出（结果没有并入 `agentReexportViolations` 也能通过），而且会被脚本中无关的检查失败拖红。可让脚本接受源码根目录参数，用 fixture 断言非零退出
- Nit：`packages/im/workroom/README.md:16` 把 `@zhin.js/agent`、`@zhin.js/plugin-runtime` 留在普通 dependencies 的理由写成“离线无法生成 lockfile”，这是执行环境限制而非设计理由，也没写明第 12 轮的双实例 / Token 身份不匹配风险。**首次对外发布前必须重新评估**（改为 peer，需和 CLI 的 optional-peer 安装图一起设计）
- Nit：`module-boundary.test.ts:31` allowlist 缩进不一致；a2a 用例缺少导入成功的正向基线
- 阶段末评估：以上都不影响正确性或 fail-closed，不新建条目；依赖声明一项留给维护者在发版前决定

### 第 16 轮（2026-10-14，审查 B1a）

- 无 Blocking
- Should fix：会话归属 key 含 endpoint，两个启用的 Room 可经不同 Bot 认领同一 QQ 群，绕过“一个会话只属于一个启用 Room”不变量 → B1a-1
- Should fix：未校验成员 Bot 的 adapter 与 Room 会话 adapter 一致 → B1a-1
- Should fix：agent 名仅大小写不同时被接受，@ 路由会歧义 → B1a-1
- Nit：公开常量数组运行时可变；测试未实际尝试修改冻结结果，缺少几个类型错误用例 → 并入 B1a-1

### 第 17 轮（2026-10-14，审查 B1a-1）

- 无 Blocking，无 Should fix（B1a-1 是审查后续条目，以下 Nit 只记录，不新建条目）
- Nit：`validate-room.ts:216` 大小写冲突报错写 `with member ${index}`，而别名冲突用 `members.${i}.agent` 路径格式，不统一。可在后续改动 Room 校验时顺带统一

### 第 18 轮（2026-10-14，审查 B1b）

- 无 Blocking
- Should fix：`registerEndpoint` 不校验条目归属，热重载时旧 generation 重报会覆盖新条目，旧实例 retire 后新实例掉出注册表（fail-closed 但 Room 协作失效）→ B1b-1
- Should fix：`lookup()` 对空 / 非字符串输入抛 TypeError，B1c 入站逐条调用时会让入站路径抛错 → B1b-1
- Nit：ICQQ 上报在 `#resolveStartOnline` 之前，登记异常会卡住上线流程；OneBot ws / wss `stop()` 不清空 `selfUserId`；缺 wss 路径与 factory `probeLoginInfo` 测试 → 并入 B1b-1
- 未涉及 Room 校验，第 17 轮 Nit 继续保留

### 第 19 轮（2026-10-14，审查 B1b-1）

- 无 Blocking
- Should fix：归属序号在首次登记时才分配，“新实例胜出”只在旧实例此前已登记过时成立；旧实例晚于新实例首次上报仍会覆盖并在 retire 时删掉新条目 → 属于条目要求的正确性不变量，新增 B1b-2
- Nit：ws / wss “stop 时探测在途不写入”测试实际靠 `rejectAllPending` 通过，测不到新加的判断 → 并入 B1b-2

### 第 20 轮（2026-10-14，审查 B1b-2）

- 无 Blocking，无 Should fix（B1b-2 是审查后续条目，以下 Nit 只记录，不新建条目）
- Nit：`plugins/adapters/onebot11/tests/onebot11-self-user-id.test.ts:155`（wss 在 232 行）的“stop 时探测在途不写入”测试缺正向对照：若 `transportState` 的 spy 失效，测试会退回经 `transportState !== 'open'` 分支通过。可补一个不调 `stop()` 的同构用例断言写入 `30003`，或在 stop 后断言 `transportState === 'open'`
- 未涉及 Room 校验，第 17 轮 Nit 继续保留

### 第 21 轮（2026-10-14，审查 B1c）

- 无 Blocking
- Should fix：摘要兜底全局生效且映射为会被丢弃不记录的 `self`，真人复读 Bot 文本会被静默丢弃 → 涉及正确性，新增 B1c-1
- Should fix：运行时层缺“bot 来源消息只记录”和“registry / membership 抛错时入站仍 fail-closed”的回归测试 → 并入 B1c-1
- Nit：`plugin-runtime/im/index.ts:14` `export *` 把 classifier 等实现细节导出到 core 公开面 → 并入 B1c-1
- Nit：origin 联合类型在 core / ai / agent 各写一遍，无编译期关联（可让 agent 复用 ai 导出的 `ConversationActorOrigin`）→ 只记录
- Nit：转义正则未覆盖 `【` / `〔` 等开括号与同形字母；去掉 `trimStart` 后正文前导空白原样进入历史，无专门测试 → 只记录

### 第 22 轮（2026-10-14，审查 B1c-1）

- 无 Blocking
- Should fix：运行时层“lookup / selfOf 抛错”用例的 `withRegistry` 用对象展开覆盖类实例，原型方法丢失，用例因 `isReady` 不存在而提前 fail-closed 通过，测不到目标路径 → 涉及 fail-closed 不变量的测试覆盖，新增 B1c-2
- Nit：私聊不再走摘要兜底，未就绪 Endpoint 的私聊自回显会按 human 处理（按条目要求的取舍，但没有注释或测试固定）→ 并入 B1c-2

### 第 23 轮（2026-10-14，审查 B1c-2）

- 无 Blocking（B1c-2 是审查后续条目，以下问题不涉及正确性 / 安全 / fail-closed，只记录，不新建条目）
- Should fix：`packages/im/core/tests/plugin-runtime/inbound-origin.test.ts:105` 注释称“再按 id 分类一次可证明摘要未被消耗”，但 `OutboundLedger.matchById` 不看 `digestConsumed`，私聊分支“不消耗一次性摘要”实际未测到。可在第一次 classify 后直接断言 `ledger.matchByDigest(...)` 仍命中，或把注释改为“按 id 的回显仍识别为 self”。留待阶段 B 末统一评估

### 第 24 轮（2026-10-14，审查 B2）

- 第一轮 Blocking（已在同一条目内修复）：去重最初对所有 group / channel 生效，重复入站跳过 inboundClaim / interactions / 命令，而 AI 触发按接收 Endpoint 判断 @，被 @ 的后到 Bot 会丢消息 → 改为只在 `hasRoom(conversation) === true` 时去重，补非 Room / 无 port / @ 后到 Endpoint 测试
- 第一轮 Should fix：deduper 抛错时首条也不 publish → 已改为记录并 publish、告警、不路由
- 第一轮 Nit：测试缩进、fixture `as never` 强转、`inboundDeduper` 测试选项进入公开 `ImRuntimeOptions`（修复后是否保留未单独确认）→ 只记录
- 第二轮 Should fix：changeset 仍描述全局去重，且未提 `RoomMembershipPort` 新增可选 `hasRoom` → B2-1
- 第二轮 Nit：测试固定了“Room 内待回答 interaction 在落败 Endpoint 上不会被消费”的已知缺口，方案未要求 Router 跨 Endpoint 解析 interaction / @，也未禁止先于 Router 实现 `hasRoom` → 涉及正确性约束，并入 B2-1

### 第 25 轮（2026-10-14，审查 B2-1）

- 无问题。第 24 轮 Nit 中 `inboundDeduper` 公开选项已确认标 `@internal`

### 第 26 轮（2026-10-15，审查 B2b，第 1 次执行失败）

- 第一轮 Blocking（条目内已修，但修复后又出现新的 Blocking）：`hasPendingAnswer` 只要会话里有任何存活的键盘 fallback（默认 TTL 1 小时）就返回 true，不看发送者，也不看本条消息能否解析成按钮；Router 又把 `pending` 放在最高优先级，导致 1 小时内群里所有人类消息都路由给这个 Bot，并被强制 `mentioned=true` → 修复：只有本条消息能解析到某个按钮（action 段，或标签 / 序号匹配）时才算 pending
- 第二轮 Blocking（未修，导致失败）：Room 内的原生平台按钮回调（如 Telegram callback_query 被 adapter 转成带 action 段的群消息，见 `plugins/adapters/telegram/src/endpoint.ts:555-574`）只有发出键盘的 Bot 收得到。原生键盘平台不调用 `rememberFallback`，JSX payload 也不走 claim，所以 pending 探测为 false，Router 把消息路由到 coordinator 或其他成员，唯一的那份被 `recordOnly='duplicate'` 丢弃。结果是非 coordinator 成员发出的 JSX onClick / payload 按钮全部静默失效。另外 `resolvesLiveFallback` 对任何 action 段都返回 true，不检查 payload 是否属于该成员的键盘。建议：带 action 段（平台回调）的入站视为发给接收它的 Endpoint，跳过 Room 路由和去重，或者只对接收 Endpoint 返回 pending=true；`resolvesLiveFallback` 只在 payload 属于该 fallback map 时计入；补 ImRuntime 测试（有 coordinator 的 Room 中，只被非 coordinator 成员收到的 action 段消息交给该成员的交互处理器）
- Should fix：`route` 选中的 Endpoint 不一定真的收到了这条消息（`isAvailable` 只看 `registry.isReady`）。例如 Telegram 群开启隐私模式时，未 @ 的消息只投递给部分 Bot；选中的 coordinator 没有副本，其他副本又只记录，消息静默丢失。Router 只能在实际收到副本的 Endpoint 中选择，或者在没收到副本时回退
- Should fix：上一轮 Blocking 的修复只有 `resolvesLiveFallback` 单元测试，缺 ImRuntime 层的集成测试（B 有存活键盘时，@A 的消息仍路由给 A，按钮标签答复路由给 B 且只消费一次）
- Nit：`room-router.ts` 的 `@alias` 边界只按 ASCII 判断，CJK 别名 `研究` 会匹配 `@研究员`；`hasLiveFallback` 注释写“只读”，但会触发 `#pruneFallbacks()`；`pending` 探测在 AdapterIndex 不认识的 Endpoint 上会抛错，导致整条消息 fail-closed、没有成员处理

### 第 27 轮（2026-10-15，审查 B2b，第 2 次执行）

- 无 Blocking，第 26 轮问题已全部处理
- Should fix：非目标、非 fallback 的 Endpoint 副本（含同进程非成员 Bot、route 时未就绪的成员）直接判 duplicate 且只打 debug，可能静默丢消息；@ 非成员被强制 mentioned 交给 coordinator → 涉及正确性，新增 B2b-1
- Nit：`im-runtime.test.ts:3784` 测试名与实际验证不符（无 mention 段、答复用序号）→ 并入 B2b-1

### 第 28 轮（2026-10-15，审查 B2b-1）

- 无 Blocking；主要修复正确，“恰好处理一次”与 fail-closed 保持
- Should fix：@ 非成员时成员副本仍落到 coordinator 并被强制 mentioned → 涉及路由正确性，新增 B2b-2
- Should fix：方案 §3 第 132 行“非成员副本永远只记录”与新实现矛盾，会误导 B3 / B4 → 并入 B2b-2
- Nit（只记录）：`im-runtime.test.ts:3789` mock route 只识别 bot-b，“routed to A”用例实际仍测 coordinator 路径；`im-runtime.test.ts:3875` 非成员用例无 mention 段，“not forced mentioned”未真正测到，局部 `route` 遮蔽、多余 `extra: {}`

### 第 29 轮（2026-10-15，审查 B2b-2）

- 无 Blocking / Should fix；第 28 轮 Nit 已顺带处理
- Nit（只记录）：`im-runtime.test.ts:3793`“@ A 路由到 A”用例中 A 同时是 mock coordinator 默认目标，分不清 mention 与 coordinator 路径，可断言 route 返回 `reason: 'mention'` 或把 coordinator 改为 ids[2]
- Nit（只记录）：方案第 131 行与 changeset 未点明“非成员账号”也包括群内其他人类（人类 @ 人类时 coordinator 不插话），建议补半句，供 B3 / B4 参考

### 第 30 轮（2026-10-15，审查 B3）

- 无 Blocking
- Should fix：`room-task-service.ts:110` 订阅者在 Room 串行链内被 await，重入 execute 会死锁 → 新增 B3-1
- Nit：DB journal 空批量不校验 expectedSequence，与内存实现不一致；已 assigned 时再次 assign 可绕过 handoff 规则 → 并入 B3-1

### 第 31 轮（2026-10-15，审查 B3-1）

- 无 Blocking / Should fix
- Nit（只记录，C1 参考）：`room-task-service.ts:135` 分发移出串行段后，同一 Room 并发 execute 的订阅者分发可能交错；JSDoc 已要求订阅者按 `event.sequence` 排序，方案未记录。C1 把 RoomBus 投影接成订阅者时须按 sequence 排序或去重
- Nit（只记录）：`room-task.ts:207` 只在 `assigned` 时拒绝同人指派，`blocked` 时同人 assign 视为解除阻塞；方案 redesign.md:194 与头注释未写明这个例外，可补注释或用例
- Nit（只记录，C1 参考）：`room-task-service.ts:42` 的 `authorize(roomId, command)` 是同步的、拿不到 Task 当前状态，C1 实际只能按角色限制所有 assign，或需要给 authorize 提供 Task 视图
- Nit（只记录）：`room-task-service.test.ts:90` 死锁测试的 2 秒 guard 计时器未 clearTimeout

### 第 32 轮（2026-10-15，审查 B4）

- 无 Blocking
- Should fix：`room-task-authorizer.ts:31` 除 cancel 外全放行，重新 assign 可绕过 handoff 上限；`room-send-limiter.ts` 只覆盖 Room Bus 投影，账号级防风控只部分达成 → 新增 B4-1
- Nit：`cancelRoom` 任意 human 可清空队列；未传 `history` 时弹跳检查 fail-open；`admitTurn` / `runExclusive` 重复计数；恒真的排序测试 → 并入 B4-1

### 第 33 轮（2026-10-15，审查 B4-1）

- 无 Blocking；主要修复满足条目且保持 fail-closed（assign 默认拒绝、`next` 抛错视为拒绝、缺 history 拒绝、清队列需权限、每 turn 只占一个窗口、send / middleware 共享计数）
- Should fix：`room-task-authorizer.test.ts:95` 锁定“其他命令放行”的用例只改名未删除，把 next 缺省时 start / block / handoff 的 fail-open 锁成契约 → 涉及 fail-closed，新增 B4-2
- Nit：`room-send-limiter.ts:66` `middleware` 签名与 core outbound middleware 契约不一致，误接会拒绝所有出站 → 涉及发送链正确性，并入 B4-2
- Nit：同一出站路径叠用 middleware 与 `send` 会重复计数；`cancelRoom` 拒绝清队列时静默返回 0 → 并入 B4-2

### 第 34 轮（2026-10-15，审查 B4-2）

- 无 Blocking / Should fix，第 33 轮问题已全部处理
- Nit（只记录，C1 参考）：`room-send-limiter.test.ts:198` `outboundMiddleware()` 只用对象字面量调用 handle，未验证能被 core 的 `defineMiddleware(limiter.outboundMiddleware())` 接受；C1 接线时可补一个类型兼容用例

### 第 35 轮（2026-10-15，审查 B5，阶段 B 收尾）

- 无 Blocking / Should fix；已处理第 31 轮（按 sequence 去重唤醒）与第 34 轮（`defineMiddleware(limiter.outboundMiddleware())` 类型兼容）Nit
- Nit（只记录，C1 参考）：`examples/multi-agent-room/src/team.ts:296` `bus.handoff` 返回 rejection 时 Task 已在 journal 转给 `next.to`，只记 send_rejected，没人被唤醒，Task 停在 assigned；C1 应改为 escalate（block 并 @人类）
- Nit（只记录，C1 参考）：`team.ts:259` 只在 script 返回后检查 `signal.aborted`，`speak()` 期间的普通打断仍会继续 handoff / complete；C1 应在 speak 后、handoff / complete 前再检查并补用例
- Nit（只记录）：示例 README 中旧机制路径未写明所属包（应为 `packages/im/workroom/src/...`），且未说明 `pnpm dev` 现在启动三个互相独立的 Bot、协作只能通过测试看到
- Nit（只记录）：`multi-agent-room-contract.test.ts:25` owner 仍为 `planner-user`

### 第 36 轮（2026-10-15，审查 C1a）

- 无 Blocking
- Should fix（fail-closed）：`room-task-authorizer.ts:175` assign helper 无 roomId 时不校验 Room → C1a-1
- Should fix（fail-closed）：`team.ts:289` 升级时 start / block 失败只记 `turn_error`，人类未被询问且排队唤醒仍执行 → C1a-1
- Should fix：`room-send-limiter.test.ts:211` 类型兼容用例不在 type-check 范围内 → C1a-1
- Nit：`team.ts:285` 升级时合成的 `task.started` 让 journal 显示接收者开始了 Task，应在 reason 或注释注明是为升级合成（只记录）
- Nit：`team.ts:329` 待唤醒集合不在 `dispose()` 清空；`room-event-sequencer.test.ts:84` 未证明确实发生了交错；`room-task-authorizer.ts:159` 未知命令放行 → 并入 C1a-1

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
- 2026-10-14 14:57 定时运行：rebase 到最新 origin/main（15 个提交无冲突），install / build 通过；完成 A4b-1（4 个 agent，约 3.6 分钟，四包 build / type-check / 1713 个相关测试 / check:architecture / API 快照 / eslint 通过，审查无 Blocking，2 个 Nit 只记录）。备注：`scriptPath` 仍被拒绝，继续内联传入 step-workflow.js，内容未改
- 2026-10-14 同一次定时运行：完成 A4c（4 个 agent，约 12.8 分钟，cli build / type-check / 381 个相关测试 / check:architecture / API 快照 / eslint 0 error（27 个 no-duplicate-imports 警告）通过，审查无 Blocking，4 个 Nit 新增为 A4c-1）
- 2026-10-14 17:10 定时运行：rebase 到最新 origin/main（17 个提交，`docs/authoring/host-tokens.md` 中英文冲突：main 重写了该页，保留 main 版本并重新加入 `workroomHostToken` 一行，来源改为 `@zhin.js/workroom`），install / build 通过；完成 A4c-1（6 个 agent，约 7.7 分钟，cli build / type-check / 354 个相关测试 / check:architecture / API 快照 / no-duplicate-imports 清零通过，审查无 Blocking，2 个 Nit 只记录）。备注：`scriptPath` 仍被拒绝，继续内联传入 step-workflow.js，内容未改
- 2026-10-14 同一次定时运行：完成 A5（4 个 agent，约 13.7 分钟，workroom / cli build、type-check、95 个架构脚本自测、203 + 2524 个相关测试、check:architecture、API 快照、dependency-policy / feature-peers、**`pnpm check:all`** 通过，审查无 Blocking，4 个 Nit 只记录）。阶段 A 全部完成；下次运行从阶段 B 开始，先从本分支最新提交切出 `feat/workroom-group-collab`
- 2026-10-14 17:41 定时运行：rebase 到最新 origin/main（1 个提交无冲突），从阶段 A 最新提交切出 `feat/workroom-group-collab`，install / build 通过；完成 B1a（4 个 agent，约 5 分钟，workroom build / type-check / 15 + 8 个相关测试 / check:architecture / API 快照 / eslint 通过，审查无 Blocking，3 个 Should fix 新增为 B1a-1）。备注：`scriptPath` 仍被拒绝，继续内联传入 step-workflow.js，内容未改
- 2026-10-14 同一次定时运行：B1a-1 首次执行时子 agent 触发会话额度上限（implement / verify 失败），半成品 diff 存到 scratchpad 后 `git restore .`；维护者要求重试后从同一 run 恢复（复用缓存的 plan）完成 B1a-1（4 个 agent，约 2 分钟，workroom build / type-check / 20 个 Room 测试 + 1093 个 workroom 测试 / check:architecture / API 快照 / eslint 通过，审查无问题，1 个 Nit 只记录）
- 2026-10-14 19:35 定时运行：rebase 到最新 origin/main（`tsconfig.typecheck.json` 冲突：main 新增 `packages/im/agent/evals/**/*.ts`，与本分支的 `packages/im/workroom/src/**/*` 两行都保留），install / build 通过；完成 B1b（6 个 agent，约 11.5 分钟，adapter / icqq / onebot11 / sandbox build、type-check、402 个相关测试、check:architecture、API 快照、eslint 0 error（1 个 no-duplicate-imports 警告）通过，审查无 Blocking，2 个 Should fix 新增为 B1b-1）。备注：`scriptPath` 仍被拒绝，继续内联传入 step-workflow.js，内容未改
- 2026-10-14 同一次定时运行：完成 B1b-1（4 个 agent，约 4.2 分钟，四包 build / type-check / 413 个相关测试 / check:architecture / API 快照 / eslint 通过，审查无 Blocking，1 个 Should fix 涉及正确性，新增为 B1b-2）
- 2026-10-14 20:35 定时运行：rebase 到最新 origin/main（23 个提交无冲突），install / build 通过；完成 B1b-2（6 个 agent，约 4.8 分钟，adapter / onebot11 / icqq / sandbox build、type-check、356 个相关测试、check:architecture、API 快照、eslint 通过，审查无 Blocking，1 个 Nit 只记录）。备注：继续内联传入 step-workflow.js，内容未改
- 2026-10-14 同一次定时运行：完成 B1c（6 个 agent，约 16.4 分钟，ai / core / agent / cli build、type-check、1042 个相关测试、check:architecture、API 快照、eslint 通过，审查无 Blocking，2 个 Should fix 涉及正确性，新增为 B1c-1）
- 2026-10-14 21:35 定时运行：rebase 到最新 origin/main（25 个提交；`packages/im/agent/src/turn/index.ts` 与 `basic/cli/src/plugin-runtime/agent/turn/ingress-route.ts` 冲突，main 新增 TurnAdmissionGate 与本分支 workroom port 两边都保留），install / build 通过，cli agent + agent turn 182 个测试通过；完成 B1c-1（6 个 agent，约 5.4 分钟，core build / type-check / 290 个相关测试 / check:architecture / API 快照 / plugin-runtime API / eslint 通过，审查无 Blocking，1 个 Should fix 涉及 fail-closed 测试覆盖，新增为 B1c-2）。备注：继续内联传入 step-workflow.js，内容未改
- 2026-10-14 同一次定时运行：完成 B1c-2（4 个 agent，约 2.8 分钟，core build / type-check / 136 个相关测试 / check:architecture / API 快照 / plugin-runtime API / eslint 通过，审查无 Blocking，1 个 Should fix（测试注释与实际验证不符）只记录）
- 2026-10-14 22:35 定时运行：rebase 到最新 origin/main（无冲突，基线 fc75499c5），install / build 通过；完成 B2（7 个 agent，约 11 分钟，core build / type-check / 153 个相关测试 / check:architecture / API 快照 / plugin-runtime API / eslint 通过；首轮审查 1 个 Blocking 在条目内修复，复审无 Blocking，1 个 Should fix + 1 个 Nit 新增为 B2-1）。备注：`scriptPath` 仍被拒绝，继续内联传入 step-workflow.js，内容未改
- 2026-10-14 同一次定时运行：完成 B2-1（4 个 agent，约 2.3 分钟，core build / type-check / 133 个相关测试 / check:architecture / API 快照 / plugin-runtime API / eslint 通过，审查无问题）。备注：本次会话内 `scriptPath` 指向会话自己保存的脚本副本可用
- 2026-10-15 00:00 定时运行：rebase 到最新 origin/main（29 个提交无冲突），install / build 通过；B2b 执行失败（7 个 agent，约 24 分钟。实现与验证都通过，但 Opus 首轮 1 个 Blocking 修复后，复审又发现新的 Blocking：Room 内原生按钮回调被路由到其他成员后丢弃）。按规则把 diff 和未跟踪文件保存到 scratchpad 后回滚，B2b 记第 1 次失败，审查意见写入第 26 轮。备注：`scriptPath` 仍被拒绝，继续内联传入 step-workflow.js，内容未改
- 2026-10-15 00:35 定时运行：rebase 到最新 origin/main（30 个提交无冲突），install / build 通过；B2b 第 2 次执行完成（4 个 agent，约 12.6 分钟，core / workroom build、type-check、405 个相关测试、check:architecture、API 快照、plugin-runtime API、eslint 通过，审查无 Blocking，1 个 Should fix 涉及正确性，新增为 B2b-1）。备注：`scriptPath` 指向本次会话 scratchpad 中的脚本副本，内容未改
- 2026-10-15 同一次定时运行：完成 B2b-1（4 个 agent，约 4.4 分钟，core / workroom build、type-check、219 + 348 个相关测试、check:architecture、API 快照、plugin-runtime API、eslint 通过，审查无 Blocking，2 个 Should fix 涉及路由正确性，合并新增为 B2b-2，2 个 Nit 只记录）
- 2026-10-15 01:35 定时运行：rebase 到最新 origin/main（2 个提交无冲突），install / build 通过；完成 B2b-2（4 个 agent，约 3.7 分钟，core / workroom build、type-check、220 + 1484 个相关测试、check:architecture、API 快照、plugin-runtime API、eslint 通过，审查无 Blocking / Should fix，2 个 Nit 只记录）。备注：`scriptPath` 指向本次会话 scratchpad 中的脚本副本，内容未改
- 2026-10-15 同一次定时运行：完成 B3（4 个 agent，约 7.1 分钟，workroom build、type-check、101 + 940 个相关测试、check:architecture、API 快照、plugin-runtime API、eslint 通过，审查无 Blocking，1 个 Should fix 新增为 B3-1，2 个 Nit 并入）。顺带在方案第 131 行补充“非成员账号也包括群内其他人类”
- 2026-10-15 定时运行：rebase 到最新 origin/main（无冲突），install / build 通过；完成 B3-1（4 个 agent，约 5.4 分钟，workroom build、type-check、117 个 room 测试、check:architecture、API 快照、plugin-runtime API、eslint 通过，审查无 Blocking / Should fix，4 个 Nit 只记录）。备注：`scriptPath` 仍被拒绝，继续内联传入 step-workflow.js，内容未改
- 2026-10-15 同一次定时运行：完成 B4（4 个 agent，约 8 分钟，workroom build、type-check、148 个 room 测试 + 1221 个 workroom 测试、check:architecture、check:harness-paths、API 快照、plugin-runtime API、eslint 通过，审查无 Blocking，2 个 Should fix 涉及安全 / fail-closed，连同 4 个 Nit 新增为 B4-1）
- 2026-10-15 03:35 定时运行：rebase 到最新 origin/main（2 个提交；4 处冲突：`activate-ai-database-storage.ts` 保留 main 的语义记忆激活、去掉已迁出的 Workroom 激活；`api-surface.json` 保留 main 新增的 `detached-task` 导出；`ingress-route.ts` 同时保留可选 `workroom` 与 main 的 `detachedTasks`；`console/api.test.ts` 两个用例都保留），install / build / type-check / 173 个相关测试 / API 快照 / check:architecture 通过；完成 B4-1（4 个 agent，约 5.7 分钟，workroom build、type-check、159 个 room 测试 + 1232 个 workroom 测试、check:architecture、check:harness-paths、API 快照、plugin-runtime API、eslint 通过，审查无 Blocking，1 个 Should fix 涉及 fail-closed，连同 3 个 Nit 新增为 B4-2）。备注：`scriptPath` 指向本次会话 scratchpad 中的脚本副本，内容未改
- 2026-10-15 同一次定时运行：完成 B4-2（4 个 agent，约 3.1 分钟，workroom build、type-check、46 个相关测试 + 1236 个 workroom 测试、check:architecture、API 快照、plugin-runtime API、eslint 通过，审查无 Blocking / Should fix，1 个 Nit 只记录）
- 2026-10-15 定时运行：rebase 到最新 origin/main（40 个本分支提交无冲突，基线 a6ea7b446），install / build 通过；完成 B5（4 个 agent，约 15.7 分钟，workroom / 示例 build、type-check、16 个示例测试 + 163 个 room 测试、check:architecture、check:harness-paths、API 快照、plugin-runtime API、eslint、**`pnpm check:all`** 通过，审查无 Blocking / Should fix，4 个 Nit 只记录）。阶段 B 全部完成。备注：`scriptPath` 仍被拒绝（即使先 Read 过），继续内联传入 step-workflow.js，内容未改；护栏把从 scheduled-tasks 目录 `cp` 脚本误判为修改外部路径
- 2026-10-15 05:35 定时运行：origin/main 无新提交，install / build 通过；C1 检查后标为阻塞（缺 Room turn 入口 / execution profile、Room 事件流与 JournalStore 的桥、Room 工具 token 接线，选项见条目），拆出 C1a；完成 C1a（4 个 agent，约 6.5 分钟，workroom build、type-check、196 个 room / 示例测试、check:architecture、API 快照、plugin-runtime API、eslint 通过，审查无 Blocking，3 个 Should fix 涉及 fail-closed / 条目要求，连同 3 个 Nit 新增为 C1a-1）。备注：`scriptPath` 指向本会话 workflows 目录中的脚本副本可用，内容未改
