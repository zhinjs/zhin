---
title: 聊天角色
description: zhin 如何决定聊天中「谁能做什么」：zhin 角色 owner / admin / trusted × 四个层级，发言者平台身份与机器人自身平台身份是独立维度（ADR 0056）
---

# 聊天角色

聊天中的权限由三条**相互独立**的维度组成（[ADR 0056](../adr/0056-chat-roles.md)）：

| 维度 | 来源 | 管什么 | permit 写法 |
| --- | --- | --- | --- |
| 发言者的 zhin 角色 | `chat_roles` 表中的授予（Console / 聊天 `角色 授予`） | zhin 的功能：功能开关与配置、角色管理、聊天改配置、Agent 信任档位 | `owner` / `admin` / `trusted`、`role(…)` |
| 发言者的平台身份 | 适配器上报的 `sender.platform` | 平台的功能：谁可以让机器人禁言、踢人、改身份组…… | `platform:owner\|admin`、`platform-role:<id>`、`platform-permission:<name>` |
| 机器人自身的平台身份 | 适配器的自身身份查询（按会话缓存） | 平台操作能否执行：机器人是不是本群管理员、有没有某项权限 | `bot:owner\|admin`、`bot-role:<id>`、`bot-permission:<name>` |

三条维度互不换算：平台群主**不会**因为是群主就成为 zhin `admin`，zhin `owner` 也不会因此获得平台权限。命令的 `permit`、Agent 工具 / 技能 / Agent 包的 `permissions`、中间件与按钮的 `permit` 都由同一个评估器判断。

## 平台身份

适配器把发言者在群里的地位归一后放在入站消息的 `sender.platform` 上：

```ts
interface PlatformStanding {
  standing: 'owner' | 'admin' | 'member' | 'guest';   // 群主 / 管理员 / 成员 / 访客
  roles?: { id: string; name?: string }[];            // 平台原生角色（如 Discord 身份组）
  permissions?: string[];                              // 平台原生权限
}
```

私聊没有平台身份。

### 机器人自身的平台身份

同样的形状也描述**机器人账号自己**在当前会话的身份。适配器实现 `management.inspectSelfStanding`、在能力画像声明 `scene.selfStanding` 后，框架在需要时（`bot:*` permit、Agent 回合开始）查询并按会话缓存：已知结果 60 秒、未知 10 秒；机器人的角色变化事件会让缓存失效。未声明、私聊、查询失败都视为「未知」，任何 `bot:*` 条件都不满足。

| 适配器 | 支持 | 来源 |
| --- | --- | --- |
| ICQQ、OneBot 11、NapCat、Milky | 群：`standing` | `get_group_member_info`（机器人自己） |
| QQ 官方 | 群：`standing`；频道：`standing`、`roles` | 群 `getBotState.member_role`；频道成员身份组（4 = 频道主、2 = 超级管理员） |
| Discord | 频道：`standing`、`roles`、`permissions` | `guild.members.me` 的身份组与频道权限 |
| Telegram | 群：`standing`、`permissions` | `getChatMember(bot)` |
| KOOK | 频道：`standing`、`roles`、`permissions` | `/v3/user/view`（机器人自己）的服务器角色与权限位 |
| 飞书 | 群：`standing` | `chat.get` 的群主与 `bot_manager_id_list` |
| 钉钉等其他适配器 | 不支持 | 平台没有机器人群内身份的查询接口 |

## 三个 zhin 角色

| 角色 | 含义 | 典型用途 |
| --- | --- | --- |
| `owner` | 机器人的主人（原 `master`） | Agent 危险工具、主人审批、聊天中改配置、重启、账号管理 |
| `admin` | zhin 管理员 | 群内功能自助、角色管理、群规审批、订阅类命令 |
| `trusted` | 受信任用户 | Agent 中等风险工具 |

能力包含：`owner` ⊃ `admin` ⊃ `trusted`——要求 `trusted` 的地方，`admin` 与 `owner` 也满足。

## 四个层级

| 层级 | 作用范围键 | 例子 |
| --- | --- | --- |
| 全局 | `''` | 所有适配器 |
| 适配器 | `<别名>` | `qq` |
| 账号 | `<别名>/<账号 id>` | `qq/bot-1` |
| 会话 | `<别名>/<账号 id>/<kind>:<id>` | `qq/bot-1/group:123` |

- 角色授予给身份 `(适配器别名, 用户 id)`，在其作用范围及以下全部有效；同一人可以在不同范围担任不同角色。
- 处理每条消息时，Runtime 沿「会话 → 账号 → 适配器 → 全局」计算发送者的最高角色，写入 `sender.chatRole`，并在 `sender.chatRoleLevels` 记录每个角色最高来自哪一层。适配器或插件自带的 `chatRole` / `chatRoleLevels` 一律丢弃。
- 线程 / 子话题（`conversation.threadId`）沿用父会话的会话键：频道上授予的角色在其线程中同样有效；guild 等平台容器（`conversation.parent`）不增加层级。会话无法生成会话键时按账号层链解析。

### 角色的作用范围 {#scope}

会话层 `owner` 只是这个会话的主人，不是宿主的主人：

| 能力 | 要求 |
| --- | --- |
| Agent 危险工具 / exec / 文件写与敏感读、主人审批的接收人、重启实例、写全局 / 平台记忆、定时任务的高信任运行、聊天改项目配置、跨适配器的账号恢复 | **全局层** `owner` |
| 增删适配器账号（`<适配器> endpoint add\|remove`） | **适配器层或以上** `owner` |
| 功能自助、角色管理、订阅等其余 zhin 功能 | 按目标作用范围判断 |

更低层的 owner 在 Agent 信任档位上按 `admin` 计。
- 存储：项目数据库的 `chat_roles` 表，启动时加载、写入即时生效。zhin 角色只来自这里的授予（含从旧配置迁移来的授予）。

管理入口：

- Console：全局 / 适配器 / 账号 / 会话对象页的「角色」页签（`chat-roles.list|grant|revoke`，需要 `iam.manage`；绑定到适配器 / 账号的权限对其下的作用范围也有效）。授予 / 撤销 `owner`（或改动已有的 owner 授予）需要**全局** `iam.manage`；列表中调用者不管理的上级条目只显示角色与层级（`redacted: true`）。
- 聊天：`角色 列表|授予|撤销 <用户> <角色> [层级]` / `role list|grant|revoke …`（需开启 `features.selfService.enabled`）。规则：被触及的角色（要授予的、以及对方在该范围已有而将被替换或撤销的）都不能高于你在该范围的角色；触及 `owner` 只能由更高层的 `owner` 进行；对方已有与你同级的角色时，只有更高的角色或在更高层持有同一角色的人才能改动。`角色 列表` 需要本会话的 `admin`，上级授予的条目不显示身份。
- 授予只保存在关系型项目数据库（sqlite / mysql / pg）中；数据库不支持时授予 / 撤销被拒绝（Console 503 `chat-roles-unpersisted`，聊天回复「未保存」）。

::: tip 群主想管理功能怎么办
功能开关、订阅等是 zhin 的功能，平台群主 / 管理员需要被授予 zhin 角色才能使用：由 owner 在聊天中发送 `角色 授予 @群主 admin`，或在 Console 会话页的「角色」页签授予。
:::

## 在代码里使用

```ts
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  // 发言者是群管理员，且机器人自己也是管理员
  permit: ['group()', 'platform:admin', 'bot:admin'],
  execute: () => '…',
});
```

| 写法 | 含义 |
| --- | --- |
| `owner` / `admin` / `trusted`、`role(admin,trusted)` | 发言者在本会话层级链上的 zhin 角色 |
| `owner@global` / `owner@adapter` / `admin@endpoint` / `trusted@conversation`、`role(owner@global,admin)` | 该角色须来自该层级或更高层级（提供宿主全局能力的工具 / 命令用 `owner@global`） |
| `platform:owner` / `platform:admin` | 发言者的归一平台地位（`platform:admin` 也接受群主） |
| `platform-role:<id>` / `platform-permission:<name>` | 发言者的平台原生角色 / 权限 |
| `bot:owner` / `bot:admin` | 机器人自身的归一平台地位 |
| `bot-role:<id>` / `bot-permission:<name>` | 机器人自身的平台原生角色 / 权限（如 `bot-permission:ban_members`） |

列表各项 AND，单项括号内逗号 OR。不满足时：

- 命令走现有拒绝回复；`platform:*` / `bot:*` 条件会说明缺哪一项（如「无法执行此指令：机器人不是本群管理员（或无法确认其身份）。」），zhin 角色与会话条件保持通用提示；命令菜单只列出当前发言者可用的命令。
- Agent 工具 / 技能在回合开始前就不披露，执行时再校验一次（重新读取发言者当前角色与机器人身份）。
- 中间件跳过这条消息、继续后续链路（机器人身份只读缓存，缺失或过期视为未知）。因此 permit 不适合必须对每条消息生效的执法型中间件（审核、限流等）。
- 按钮回调不执行，点击者收到原因。

运行时读取：`message.sender.chatRole`、`message.sender.chatRoleLevels`、`message.sender.platform`；`@zhin.js/core` 提供 `chatRoleIncludes(held, required)`、`chatRoleHeldAt(sender, role, level)`、`hostChatRole(sender)`、`expandChatRole(role)`、`chatRolesFromMessage(message)`；机器人身份由 `AdapterIndex.selfStanding(endpointId, conversation)` 读取。从旧写法升级见[升级到聊天角色](../migrations/chat-roles.md)。
