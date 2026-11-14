---
title: 升级到聊天角色
description: 从 master / trusted 配置名单迁移到 ADR 0056 聊天角色：自动迁移、master → owner、permit 写法对照、平台身份与机器人自身身份（bot:*）、插件改写
---

# 升级到聊天角色（ADR 0056）

本版本用一套**聊天角色**取代框架层的 `master` / `trusted` 与各插件自己判断的群主 / 管理员字符串（[ADR 0056](../adr/0056-chat-roles.md)）：

- zhin 角色只有三个：`owner` ⊃ `admin` ⊃ `trusted`，`master` 改名为 `owner`。
- 角色挂在四个层级上（全局 / 适配器 / 账号 / 会话），向下继承；人员名单存在项目数据库的 `chat_roles` 表，不再写在配置文件里。
- 平台群主 / 管理员**不是** zhin 角色，也不会被换算成 zhin 角色：zhin 角色管 zhin 的功能，平台身份管平台的功能。命令与工具的可用性按「发言者的 zhin 角色 + 发言者的平台身份 + 机器人自身的平台身份」三条维度判断。

概念说明见[聊天角色](../concepts/chat-roles.md)。

## 1. 配置会自动迁移

首次用新版本启动时，实例会：

1. 读取配置中的人员名单：
   | 旧字段 | 迁移为 |
   | --- | --- |
   | 适配器块 `<别名>.master` | **没有自己 `master` 的账号**各自的账号层 `owner`（与旧语义一致：账号自己的 master 取代适配器的）；不建适配器层 owner |
   | 适配器块 `<别名>.trusted` | 适配器层 `trusted` |
   | `<别名>.endpoints[i].master` | 账号层 `owner`（键 `<别名>/<账号 id>`，没有 id 时用 name） |
   | `<别名>.endpoints[i].trusted` | 账号层 `trusted` |
   | `ai.trigger.masters` | 全局 `owner`，为每个已配置的适配器各登记一个身份；跳过本地模拟适配器（能力画像声明 `runtime.sandbox`，其客户端可自选发送者 id）与未能加载的适配器，并写日志 |
   | `ai.trigger.trusted` | 全局 `trusted`，同上 |
2. 先把这些授予记入 `.zhin/chat-roles-migration.json`（状态 `pending`），再从配置文件中删除这些字段，并在日志中列出被移走的字段；
3. 数据库就绪后写入 `chat_roles`（同一身份同一作用范围已有授予时**保留较高者**：只升不降、从不删除，ADR 0060 §4.3），记录改为 `done`，并记下每条的结果（`imported`）。Console「需要你处理」出现信息项 `chat-roles.imported`，核对后可撤销或确认已读。

迁移中途进程退出时，下次启动会从 `pending` 记录继续，不会丢失。没有关系型数据库（sqlite / mysql / pg）时，迁移来的授予只在内存中生效，记录保持 `pending`（标记 `memoryOnlyAt`），直到配置了关系型数据库再写表；此时授予 / 撤销都会被拒绝（Console 503 `chat-roles-unpersisted`，聊天回复「未保存」），因此不会出现「撤销后下次启动复活」。

迁移完成后，如果配置文件中**再次出现**这些字段（ADR 0060 §4.2，不再启动失败）：

- **不会自动授予**——之后改配置的人不一定是主人（`ops.config.write` 可以单独授予）；
- 实例先把它们记入 `.zhin/chat-roles-migration.json` 的 `pendingImports`，再从配置文件删除（适配器配置 Schema 不接受这些字段），启动日志告警；
- Console「需要你处理」出现 `chat-roles.import-pending`，持有**全局** `iam.manage` 的用户逐条「导入」或「忽略」（`chat-roles.imports.list|resolve`）；导入沿用首次导入规则，并写审计 `chat-roles.import`。

日常授予请直接使用：

- Console：全局 / 适配器 / 账号 / 会话对象页的「角色」页签（`chat-roles.grant` / `revoke`，需要 `iam.manage`）；
- 聊天：开启 `features.selfService.enabled` 后发送 `角色 授予 <用户> <owner|admin|trusted> [层级]` / `role grant …`。

::: warning 已删除、没有兼容
以下字段出现在配置中仍会直接报错（`LEGACY_CHAT_ROLE_CONFIG`）：

- `features.selfService.platformAdmins`、`features.selfService.roles`、`features.selfService.allowUsers`；
- 适配器块的 `roles`（`roles.mappings` / `roles.inherit`）与账号项的 `endpoints[i].roles`——平台身份 → zhin 角色的映射规则已删除（见第 2 节）。
:::

### 第一位全局 owner {#first-owner}

新部署（没有任何全局 `owner`）时：

- Console：「需要你处理」出现 `chat-roles.no-owner`，在「聊天角色」中授予全局 owner（需要全局 `iam.manage`）。迁移来的 `master` 只是**账号层** owner，不会自动成为全局 owner；需要时在 Console 中提升。
- 没有 Console 时：实例启动日志与 `zhin status` 打印一次性**认领码**，部署者在真实平台**私聊**机器人发送 `认领 <码>`（`claim <code>`）即成为全局 owner。认领码只在尚无全局 owner 且有关系型数据库时有效，用一次即失效、重启轮换、连错 5 次轮换；群聊中发送的正确码会立即作废；模拟适配器（Sandbox 等，`runtime.sandbox`）上不接受认领。码保存在 `.zhin/chat-owner-claim.json`（权限 0600），有 owner 或实例退出时删除。

### 回滚（降级到旧版本） {#rollback}

迁移记录升级为版本 2 时，原版本 1 文件保存在 `.zhin/chat-roles-migration.v1.json`。降级前把它改名回 `.zhin/chat-roles-migration.json`（旧版本读不懂版本 2，会报 malformed）。`chat_roles` 表结构未变，已授予的角色不受影响；旧版本会对配置中再次出现的人员字段重新启动失败。

## 2. 平台身份不再映射为 zhin 角色 {#mappings}

此前版本的预览实现里，`roles.mappings` 把平台群主 / 管理员实时换算成本会话的 `admin`。这套映射已删除，Console 的 `chat-roles.mappings` / `chat-roles.set-mappings` RPC 与会话层映射表 `chat_role_mappings` 一并移除，`chat-roles.list` 不再返回 `source: 'mapping'` 的条目。

| 以前依赖映射的地方 | 现在 |
| --- | --- |
| 群主 / 管理员在群内用 `功能` / `角色` 命令 | 需要被授予 zhin `admin`（`角色 授予 @群主 admin`，或 Console 会话页「角色」页签） |
| 群主 / 管理员管理订阅（B 站、地震等 `canManageConversation` 类命令） | 同上：订阅是 zhin 功能 |
| 群主 / 管理员获得 Agent 受信任档位（`admin` ⊃ `trusted`） | 不再获得；Agent 信任档位只看 zhin 角色 |
| 工具 / 命令要求「发言者是群管」 | 写 `platform:admin`（或 `platform:owner`、`platform-permission:<名>`） |
| 群规「群主和管理员豁免」 | 豁免平台群主 / 管理员（`platform:admin`）与 zhin `owner`，见第 5 节 |

## 3. `master` → `owner`

| 位置 | 以前 | 现在 |
| --- | --- | --- |
| 发送者角色 | `sender.roles` 中的 `master` / `trusted` | `sender.chatRole`（`owner` / `admin` / `trusted`，Runtime 写入） |
| 平台身份 | `sender.roles` 中的 `owner` / `admin` 字符串 | `sender.platform.standing`（私聊不提供） |
| 命令会话 | `session.sender.role`（数组） | `session.sender.chatRole` 与 `session.sender.platform` |
| 操作会话 | `OperationSession.sender.authorizationRoles` / `platformRoles` | `OperationSession.sender.chatRole` / `platform` |
| `@zhin.js/core` | `SenderRole`、`senderRolesFromMessage`、`roleSatisfies`、`hasSenderRole`、`normalizeSenderRoles`、`formatSenderRolesForLabel`、`isFrameworkSenderRole` | `ChatRole`、`chatRolesFromMessage`、`chatRoleIncludes`、`chatRolesInclude`、`expandChatRole` |
| Agent 回合主体 | `principal.roles` 含 `master`（也混入平台角色） | `principal.roles` 只含展开的聊天角色（`owner` → `owner, admin, trusted`）或 `user`；平台地位在 `principal.platform` |
| `@zhin.js/agent` | `SenderRole`、`SELF_CHANGE_MASTER_ROLE`、`ToolRequesterRole` 的 `master` | `PrincipalRole`、`SELF_CHANGE_OWNER_ROLE`、`owner` |
| `@zhin.js/core/runtime` | `createEndpointRoleResolver`、`createEndpointRoleConfigurationSelection`、`createSenderEnricher(config, resolver)`、`createConfigurationChatAuthorizer(config, resolver)` | `createSenderEnricher({ roles })`、`createConfigurationChatAuthorizer(roles, snapshot)`、`senderOwnsReceivingAdapter` |
| `ai.trigger` | `masters` / `trusted` | 删除（迁入 `chat_roles`） |

聊天提示中参与者头的角色标签相应变为：平台地位 `owner` / `admin`，聊天角色 `bot_owner` / `bot_admin` / `trusted`。

## 4. permit / 工具 `permissions` 对照 {#permits}

命令的 `permit`、Agent 工具 / 技能的 `permissions`、中间件与按钮的 `permit` 使用同一套内置 DSL、同一个评估器（列表 AND，单项括号内逗号 OR）：

| 以前 | 现在 | 说明 |
| --- | --- | --- |
| `role(master)` | `owner`；宿主全局能力用 `owner@global` | 本会话层级链上的 zhin 角色；`<角色>@<层级>` 要求来自该层级或更高层级 |
| `role(trusted)` | `trusted`（或 `role(trusted)`） | `admin` / `owner` 也满足 |
| `role(admin)`（平台管理员） | `platform:admin`，或 zhin `admin` | 管平台功能用 `platform:admin`；管 zhin 功能用 `admin`（需要授予） |
| `role(owner,admin,master)` | `admin` 或 `platform:admin` | 同上，按功能归属选择 |
| `role(owner,admin,master,trusted)` | `trusted` | |
| `role(user)` | 删除该规则 | 所有人都满足 |
| `scene_admin` / `platform(<适配器>,scene_admin)` | `platform:admin` | 归一地位；`platform:admin` 也接受群主 |
| `scene_owner` / `platform(<适配器>,scene_owner)` | `platform:owner` | |
| `platform(<适配器>,<权限>)` | `platform-permission:<权限>` | 读取 `sender.platform.permissions` |
| —— | `platform-role:<id>` | 平台原生角色 id（如 Discord 身份组） |
| `currentConversationBotRoles: ['owner', 'admin']` | `bot:admin` | 机器人自身的归一地位（新增） |
| `currentConversationBotRoles: ['owner']` | `bot:owner` | |
| —— | `bot-role:<id>` / `bot-permission:<名>` | 机器人自身的平台角色 / 权限（如 `bot-permission:ban_members`） |

需要机器人执行的平台操作通常同时写发言者与机器人两个条件，例如禁言工具：`permissions: ['platform:admin', 'bot:admin']`。`currentConversationBotRoles` 仍可用于 permit 表达不了的精确集合（如「机器人不是群主时才能退群」：`['admin', 'member']`）。

被移除的写法在定义命令、中间件、Agent 工具时直接报错，错误信息给出替代写法。`@zhin.js/permission` 删除了 `platform(adapter,perm)` 相关 API：`PermissionHost.registerPlatform`、`PlatformPermitChecker`、`definePlatformPermission`、`createSceneRolePlatformChecker`、`platformPermission()`、`isPlatformPermit`、`parsePlatformPermitName`；`PermissionSubject.sender` 改为 `{ id, name?, chatRole?, platform? }`，新增 `PermissionSubject.bot`（机器人自身身份）。

`@zhin.js/command` 的 `CONVERSATION_MANAGER_PERMIT` 改为 `admin`（`canManageConversation` = 私聊，或本会话 zhin `admin`）。

Console 页面与插件 RPC 的 `requiredRoles` 仍是 **Console 账号的角色名**（ADR 0049），不受本变更影响。

## 5. 其他行为变化

- **Agent 安全策略**：危险工具、文件 / exec 策略、主人审批只看 zhin 角色；**全局层** `owner` 等于以前的 `master`；适配器 / 账号 / 会话层的 owner、`admin`、`trusted` 同为受信任档位。平台群主 / 管理员不再因群内地位获得受信任档位。审批私信发给在该适配器上有身份的全局 `owner`。
- **角色的作用范围**（安全审查）：`sender.chatRoleLevels` 记录每个角色来自哪一层。宿主全局能力（exec、文件、重启、全局 / 平台记忆、高信任的定时任务、聊天改配置）需要全局层 owner；增删账号需要适配器层或以上的 owner。提供宿主全局能力的插件应要求 `owner@global`（新增 permit 写法 `<角色>@<层级>`）。Discord 线程上报为「父频道 + `threadId`」，频道上的角色与功能配置在线程中同样生效。
- **聊天中改角色**：低角色的授予不能再覆盖同一范围内同级或更高的角色；`角色 列表` 需要 `admin`，上级授予的条目不显示身份。Console 中凡涉及 `owner` 的改动都需要全局 `iam.manage`，`chat-roles.list` 对调用者作用域之外的条目脱敏（`redacted: true`，不含 `adapter` / `userId`）。
- **定时任务**到期运行时按创建者**当前**角色重新判断（在 IM 中创建的任务会记录创建者所在会话）；普通用户创建的任务以普通成员信任运行。
- **Agent 回合前过滤**：本回合可用的工具 / 技能按三条维度过滤后才披露；机器人身份在回合开始时读取（缓存），查询失败时 `bot:*` 一律不满足；执行工具时再校验一次。
- **命令**：分发前按同一评估器判断；`platform:*` / `bot:*` 不满足时回复会说明缺哪一项（如「无法执行此指令：机器人不是本群管理员（或无法确认其身份）。」）；菜单只列出当前发言者可用的命令。
- **群规**：「群主和管理员豁免」（`exempt.ownerAndAdmins`）豁免平台群主 / 管理员（`platform:admin`）与 zhin `owner`；zhin `admin` 不再自动豁免。群规审批仍看 zhin `admin`。
- **内容审核**：`masters` 与 `inbound.bypassMasters` 删除，改为 `inbound.bypass`——permit 表达式列表，任一满足即跳过入站审查，默认 `[owner, "platform:admin"]`（内容审核是平台功能：默认豁免 zhin 主人与平台群主 / 管理员），`[]` 表示都审。
- **账号管理命令**（`<适配器> endpoint add|remove`）需要适配器层或以上的 `owner`；聊天重启、聊天改配置需要**全局层** `owner`。以前「没有配置 master 时所有人都能执行」的放行已取消。
- **全局 owner**：从 `ai.trigger.masters` 迁来的全局 owner 已按适配器登记身份，因此可以在私聊中使用聊天改配置；账号层 owner（如从适配器 `master` 迁来的）不行。
- **脚手架**：ICQQ 向导不再询问「主人 QQ 号」、不再写 `master`；完成后提示在 Console 账号的「角色」页签，或由已有 owner 在聊天中 `角色 授予 <QQ 号> owner 账号` 设置主人。
- **测试工具** `@zhin.js/testing`：`createFakeMessage({ sender: { id, chatRole } })`；`PluginTestKit.receive` 信任测试声明的 `sender.chatRole` / `platform`。

## 6. 适配器作者

- 在入站消息的 `sender.platform` 上报归一的发言者平台身份（`@zhin.js/im-contract` 的 `PlatformStanding`），在能力画像 `scene.platformStanding` 中声明能报告 `standing` / `roles` / `permissions` 中的哪些。在过渡期，Runtime 仍会从旧的 `sender.roles`（`owner` / `admin`）与 `sender.permissions` 推出 `platform`。
- 平台能查询机器人自身在会话中的身份时，实现 `management.inspectSelfStanding({ conversation, signal })`（返回 `PlatformStanding` 或 `undefined`），并在能力画像中声明 `scene.selfStanding`。不要自己缓存或按消息调用：框架经 `AdapterIndex.selfStanding` 按会话缓存，并在机器人角色变化事件（`member.role_changed`、机器人自身的 `member.joined` / `member.left`）时失效。声明了 `scene.selfStanding` 却没有实现该方法会在装配时报错。
- 工具若用 `platform-permission:<名>` / `bot-permission:<名>`，适配器需要把这些权限名放进对应身份的 `permissions`。
