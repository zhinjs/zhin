---
sidebar: false
---

# ADR 0055：会话级功能配置——在账号之下按群 / 私聊覆盖

状态：Accepted（2026-11-11）

扩展 [ADR 0050](./0050-layered-feature-config.md)。

## 背景

ADR 0050 让功能配置有三级：全局 < 适配器 < 账号。运营中更常见的需求落在账号之下：同一个 QQ 号加了几百个群，有的群要关掉 RSS，有的群把复读阈值调高，私聊里不开某个插件。现在只能靠各插件自己的黑白名单（content-moderation 的 bypass、命令的 `disabledCommands` 等），语义不统一，也不能逐字段改配置。

会话的数量可能是成百上千，并且常在运行中由群管理员自己调整，不适合写进配置文件。

## 决策

### 1. 第四级：`conversation`

| 层级 | 解析键 | 存储 |
|---|---|---|
| `global` | — | 配置文件（插件块） |
| `adapter` | `<别名>` | 配置文件 `overrides.adapters` |
| `endpoint` | `<别名>/<endpointId>` | 配置文件 `overrides.endpoints` |
| `conversation` | `<别名>/<endpointId>/<kind>:<id>` | **项目数据库** |

- `kind` 取 `@zhin.js/im-contract` 的 `ConversationKind`：`group` / `private` / `channel`；`id` 是平台的会话 id（群号、对方用户 id、频道 id）。私聊按对方用户区分。
- 消息上的 `conversation.endpoint` 与会话引用经 `AdapterIndex` 映射为解析键；没有会话的事件（定时任务等）停在账号层。

### 2. 插件声明

`x-zhin-config.levels` 可以包含 `"conversation"`（必须同时包含 `endpoint`）。另可声明哪些字段允许在会话层修改，以及哪些字段允许群管理员在聊天里修改：

```json
{ "x-zhin-config": { "levels": ["global", "adapter", "endpoint", "conversation"], "conversationFields": ["threshold"], "selfServiceFields": ["threshold"] } }
```

- 省略 `conversationFields` 时，会话层只能开关（`enabled`），不能改字段。
- 省略 `selfServiceFields` 时，群内自助只能开关。
- 没有 Schema 的插件：会话层只能开关（与 ADR 0050 对无 Schema 插件的处理一致）。

### 3. 存储：项目数据库

- 实例拥有的表 `feature_conversation_overrides`（不使用网关保留的 `console_` 前缀）：`(plugin, key, enabled?, patch JSON, revision, updated_at, updated_by)`，主键 `(plugin, key)`。
- 实例启动时整体加载到内存，按 `(plugin, key)` 索引；写入经实例的 RPC 完成并同步更新缓存，原地生效，不重启、不重载插件。
- 写入按插件 Schema 校验（只允许 `conversationFields` / `selfServiceFields` 中的字段），乐观并发用 `revision`。
- 插件卸载或会话不存在时，记录保留；Console 可清理。

### 4. 解析规则

在 ADR 0050 之上追加一层，规则不变：

- 启用状态自上而下，任一上级禁用即锁定下级（会话层不能重新打开被账号层关掉的插件）。
- 其余配置自下而上：`effective = deepMerge(global, adapter, endpoint, conversation)`。
- 每个字段的来源可以查询到 `conversation`。

### 5. 运行时 API

`context.configFor(target)` / `context.isEnabledFor(target)` 不变，`target` 为消息或带会话的引用时解析到会话层；缓存键加上会话。自动门禁（命令、中间件、处理器、Agent 工具与技能）对带会话的消息按会话层判断。

### 6. Console

- `feature.get` / `feature.set-override` / `feature.remove-override` / `feature.set-enabled` 接受 `level: 'conversation'`，键为 `<别名>/<endpointId>/<kind>:<id>`；`feature.conversations { plugin?, adapter?, endpoint?, query?, cursor? }` 列出有覆盖的会话（分页）。
- 权限：`feature.view` / `feature.configure` / `feature.toggle`，作用域绑定在调用目标属于该适配器 / 账号时也算数（ADR 0049 修订）。
- 账号页增加「会话」标签：搜索会话、查看各插件在该会话的状态与来源、开关与改字段。

### 7. 群内自助

- 内置命令（默认关闭；配置 `features.selfService.enabled: true` 开启）：
  - `功能 列表` / `feature list`：本会话各插件的状态与来源；
  - `功能 开启|关闭 <插件>` / `feature enable|disable <plugin>`；
  - `功能 设置 <插件> <字段> <值>` / `feature set …`，只能改 `selfServiceFields`；
  - `功能 重置 <插件>` / `feature reset …`：删除本会话的覆盖。
- 谁能用：群里由适配器报告为群主 / 管理员的成员（`senderRolesFromMessage`），可在配置里收紧为只限群主，或附加允许的用户列表；私聊只有 Console 能改。
- 只能改当前会话；不能打开被上级锁定的插件；每次修改写入实例审计（`audit` 桥接消息），`updated_by` 记录平台用户。

### 8. 与现有黑白名单的关系

现有插件自带的黑白名单保持兼容；文档标注推荐迁移到会话层开关。

## 落盘位置

- 解析：`packages/im/plugin-runtime/src/layered-config.ts`
- 存储与缓存、RPC：实例 `packages/im/zhin/src/instance/console/`（与 `feature.*` 同处）
- 门禁：`packages/im/core/src/plugin-runtime/im/feature-gate.ts`、`packages/im/agent/src/plugin-runtime/capability-ingress.ts`
- 群内命令：实例内置命令
- 协议：`@zhin.js/console-protocol` 的 `feature.ts`

## 后果

- 运营可以按群 / 私聊关闭插件或调参数，不再依赖各插件自己的黑白名单。
- 会话覆盖不在配置文件里，备份数据库即备份这部分配置；配置文件仍描述全局 / 适配器 / 账号三级。
- 群内自助默认关闭；开启后，群管理员能自行调整本群，权限受插件声明的字段和上级锁定约束。
