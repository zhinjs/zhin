---
title: 升级到聊天角色
description: 从 master / trusted 配置名单迁移到 ADR 0056 聊天角色：自动迁移、master → owner、permit 写法对照、映射规则与插件改写
---

# 升级到聊天角色（ADR 0056）

本版本用一套**聊天角色**取代框架层的 `master` / `trusted` 与各插件自己判断的群主 / 管理员字符串（[ADR 0056](../adr/0056-chat-roles.md)）：

- zhin 角色只有三个：`owner` ⊃ `admin` ⊃ `trusted`，`master` 改名为 `owner`。
- 角色挂在四个层级上（全局 / 适配器 / 账号 / 会话），向下继承；人员名单存在项目数据库的 `chat_roles` 表，不再写在配置文件里。
- 平台群主 / 管理员不再直接等于框架角色，而是按**映射规则**实时换算成当前会话的角色；默认规则是「群主 / 管理员 → 本会话 `admin`」。

概念说明见[聊天角色](../concepts/chat-roles.md)。

## 1. 配置会自动迁移

首次用新版本启动时，实例会：

1. 读取配置中的人员名单：
   | 旧字段 | 迁移为 |
   | --- | --- |
   | 适配器块 `<别名>.master` | 适配器层 `owner`（对该适配器所有账号） |
   | 适配器块 `<别名>.trusted` | 适配器层 `trusted` |
   | `<别名>.endpoints[i].master` | 账号层 `owner`（键 `<别名>/<账号 id>`，没有 id 时用 name） |
   | `<别名>.endpoints[i].trusted` | 账号层 `trusted` |
   | `ai.trigger.masters` | 全局 `owner`，为每个已配置的适配器各登记一个身份 |
   | `ai.trigger.trusted` | 全局 `trusted`，同上 |
2. 先把这些授予记入 `.zhin/chat-roles-migration.json`（状态 `pending`），再从配置文件中删除这些字段，并在日志中列出被移走的字段；
3. 数据库就绪后写入 `chat_roles`（同一身份同一作用范围已有授予时保留原值），记录改为 `done`。

迁移中途进程退出时，下次启动会从 `pending` 记录继续，不会丢失。没有关系型数据库（sqlite / mysql / pg）时，授予只在内存中生效，记录保持 `pending`，每次启动都会重放。

迁移完成后，如果配置文件中**再次出现**这些字段，实例启动会报错（`LEGACY_CHAT_ROLE_CONFIG`）并指向本文。请改用：

- Console：适配器 / 账号 / 会话页的「角色」区块（`chat-roles.grant` / `revoke`，需要 `iam.manage`）；
- 聊天：开启 `features.selfService.enabled` 后发送 `角色 授予 <用户> <owner|admin|trusted> [层级]` / `role grant …`。

::: warning 临时开关已移除
`features.selfService.platformAdmins`、`features.selfService.roles` 与 `features.selfService.allowUsers` 已删除，配置中出现会直接报错（没有兼容）。群主 / 管理员如何映射改由 [`roles.mappings`](#mappings) 决定：

| 旧写法 | 新写法 |
| --- | --- |
| `platformAdmins: true`（默认） | 什么都不写：默认规则就是群主 / 管理员 → 会话 `admin` |
| `platformAdmins: false` | 适配器块 `roles: { inherit: false }`（不带任何规则） |
| `roles: [owner]` | 见下文「只认群主」示例 |
:::

## 2. 映射规则 `roles.mappings` {#mappings}

写在适配器块（对其所有账号有效）或账号项（`endpoints[i].roles`）里；会话层的规则存在数据库，在 Console 会话页或经 `chat-roles.set-mappings` 管理。

```yaml
qq:
  roles:
    mappings:
      # 只认群主：先取消默认规则，再给群主 admin
      - match: { standing: [admin, owner] }
        grant: none
      - match: { standing: [owner] }
        grant: admin
  endpoints:
    - id: bot-1
      roles:
        inherit: false   # 这个账号不做任何映射（默认规则也不要）
```

- `match` 可写 `standing`（`owner` / `admin` / `member` / `guest`）、`role`（平台角色 id）、`permission`（平台权限名），给出的条件都要满足，每个条件内任一值即可。
- 下级规则追加，或覆盖上级 `match` 相同的规则；`grant: none` 取消上级同 `match` 的规则；`inherit: false` 丢弃上级（含默认规则）的全部规则。
- 映射结果只作用于消息所在会话，每条消息按当前平台身份实时计算，不落库。
- 配置文件里只能授予 `admin`；映射到 `trusted` / `owner` 只能写在会话层，而且永远不会得到账号层及以上的角色。

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

命令的 `permit`、Agent 工具的 `permissions` 使用同一套内置 DSL（列表 AND，单项括号内逗号 OR）：

| 以前 | 现在 | 说明 |
| --- | --- | --- |
| `role(master)` | `owner` | 本会话层级链上的聊天角色 |
| `role(trusted)` | `trusted`（或 `role(trusted)`） | `admin` / `owner` 也满足 |
| `role(admin)`（平台管理员） | `admin` 或 `platform:admin` | `admin` 是聊天角色（默认映射已让群管理员获得它）；只看平台身份用 `platform:admin` |
| `role(owner,admin,master)` | `admin` | |
| `role(owner,admin,master,trusted)` | `trusted` | |
| `role(user)` | 删除该规则 | 所有人都满足 |
| `scene_admin` / `platform(<适配器>,scene_admin)` | `platform:admin` | 归一地位；`platform:admin` 也接受群主 |
| `scene_owner` / `platform(<适配器>,scene_owner)` | `platform:owner` | |
| `platform(<适配器>,<权限>)` | `platform-permission:<权限>` | 读取 `sender.platform.permissions` |
| —— | `platform-role:<id>` | 平台原生角色 id（如 Discord 身份组） |

被移除的写法在定义命令 / 工具时直接报错，错误信息给出替代写法。`@zhin.js/permission` 删除了 `platform(adapter,perm)` 相关 API：`PermissionHost.registerPlatform`、`PlatformPermitChecker`、`definePlatformPermission`、`createSceneRolePlatformChecker`、`platformPermission()`、`isPlatformPermit`、`parsePlatformPermitName`；`PermissionSubject.sender` 改为 `{ id, name?, chatRole?, platform? }`。

`@zhin.js/command` 的 `CONVERSATION_MANAGER_PERMIT` 改为 `admin`（`canManageConversation` = 私聊，或本会话 `admin`）。

Console 页面与插件 RPC 的 `requiredRoles` 仍是 **Console 账号的角色名**（ADR 0049），不受本变更影响。

## 5. 其他行为变化

- **Agent 安全策略**：危险工具、文件策略、主人审批按 `sender.chatRole` 判断；`owner` 等于以前的 `master`，`admin` 与 `trusted` 同为受信任档位。默认映射让群主 / 管理员成为本会话 `admin`，因此也获得受信任档位的工具权限；如不希望，在适配器块用 `roles.mappings` 关闭或收紧默认规则。审批私信发给账号（或其适配器 / 全局）上存储的 `owner`。
- **群规**：「群主和管理员豁免」与群规审批改为看本会话的聊天角色 `admin`。
- **内容审核**：`masters` 与 `inbound.bypassMasters` 删除，改为 `inbound.bypassRole`（`owner` / `admin` / `trusted` / `none`，默认 `owner`）。
- **账号管理命令**（`<适配器> endpoint add|remove`）与聊天重启、聊天改配置：需要聊天角色 `owner`。以前「没有配置 master 时所有人都能执行」的放行已取消。
- **全局 owner**：从 `ai.trigger.masters` 迁来的全局 owner 已按适配器登记身份，因此也可以在私聊中使用聊天改配置。
- **测试工具** `@zhin.js/testing`：`createFakeMessage({ sender: { id, chatRole } })`；`PluginTestKit.receive` 信任测试声明的 `sender.chatRole` / `platform`。

## 6. 适配器作者

适配器在入站消息的 `sender.platform` 上报归一的平台身份（`@zhin.js/im-contract` 的 `PlatformStanding`），在能力画像中声明能报告 `standing` / `roles` / `permissions` 中的哪些。在过渡期，Runtime 仍会从旧的 `sender.roles`（`owner` / `admin`）与 `sender.permissions` 推出 `platform`。工具若用 `platform-permission:<名>`，适配器需要把这些权限名放进 `sender.platform.permissions`。
