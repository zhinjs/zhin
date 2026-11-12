---
title: 聊天角色
description: zhin 如何决定聊天中「谁能做什么」：平台身份归一、owner / admin / trusted 三个角色、四个层级与映射规则（ADR 0056）
---

# 聊天角色

聊天中的权限只有一套模型（[ADR 0056](../adr/0056-chat-roles.md)）：发送者在**本会话**的有效聊天角色，加上适配器上报的**平台身份**。命令的 `permit`、Agent 工具的 `permissions`、Agent 安全策略、群规、内容审核与群内自助都读这两样东西。

## 平台身份

适配器把发送者在群里的地位归一后放在入站消息的 `sender.platform` 上：

```ts
interface PlatformStanding {
  standing: 'owner' | 'admin' | 'member' | 'guest';   // 群主 / 管理员 / 成员 / 访客
  roles?: { id: string; name?: string }[];            // 平台原生角色（如 Discord 身份组）
  permissions?: string[];                              // 平台原生权限
}
```

私聊没有平台身份。平台身份本身**不是**聊天角色：群主不会因为是群主就能用 `owner` 命令，只有映射规则把它换算成角色时才算数。

## 三个角色

| 角色 | 含义 | 典型用途 |
| --- | --- | --- |
| `owner` | 机器人的主人（原 `master`） | Agent 危险工具、主人审批、聊天中改配置、重启、账号管理 |
| `admin` | 管理员 | 群内功能自助、群规审批、会话管理类命令 |
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
- 处理每条消息时，Runtime 沿「会话 → 账号 → 适配器 → 全局」计算发送者的最高角色，写入 `sender.chatRole`。适配器或插件自带的 `chatRole` 一律丢弃。
- 存储：项目数据库的 `chat_roles` 表，启动时加载、写入即时生效。

管理入口：

- Console：适配器 / 账号 / 会话页的「角色」区块（`chat-roles.list|grant|revoke`，需要 `iam.manage`；绑定到适配器 / 账号的权限对其下的作用范围也有效）；
- 聊天：`角色 列表|授予|撤销 <用户> <角色> [层级]` / `role list|grant|revoke …`（需开启 `features.selfService.enabled`）。授予者必须在目标作用范围拥有不低于被授予角色的角色；`owner` 只能由更高层的 `owner` 授予或撤销。

## 映射规则 {#mappings}

映射规则把平台身份换算成**消息所在会话**的角色，每条消息实时计算、不落库——平台上撤销管理员，zhin 中对应角色随即消失。

```yaml
qq:
  roles:
    mappings:
      - match: { standing: [owner] }        # 或 { role: ['<平台角色 id>'] } / { permission: [ban_members] }
        grant: admin
```

| 层级 | 写在哪里 | 能授予 |
| --- | --- | --- |
| 默认 | 内置 | `standing: [owner, admin]` → `admin` |
| 适配器 | 适配器块 `roles` | `admin` / `none` |
| 账号 | `endpoints[i].roles` | `admin` / `none` |
| 会话 | 数据库（Console 会话页、`chat-roles.set-mappings`） | `owner` / `admin` / `trusted` / `none` |

- 下级追加规则，或覆盖上级 `match` 相同的规则；`grant: none` 取消上级同 `match` 的规则；`inherit: false` 丢弃上级（含默认规则）的全部规则。
- `match` 中给出的条件都要满足；每个条件内任一值即可。
- 映射到 `trusted` / `owner` 必须是会话层的显式规则；映射永远得不到账号层及以上的角色。
- `chat-roles.mappings` 返回各层规则与合并结果；`chat-roles.list` 中 `source: 'mapping'` 的条目（近期见过的发送者）带 `detail`，指出来自哪条规则。

::: tip 默认映射与 Agent 权限
默认规则让群主 / 管理员成为本会话 `admin`，而 `admin` 包含 `trusted`，所以他们在本群也能用 Agent 的中等风险工具。不需要时在适配器块关闭（`roles: { inherit: false }`）或收紧默认规则。
:::

## 在代码里使用

```ts
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  permit: ['group()', 'admin'],        // 本会话 admin（含 owner）
  execute: () => '…',
});
```

| 写法 | 含义 |
| --- | --- |
| `owner` / `admin` / `trusted`、`role(admin,trusted)` | 本会话层级链上的聊天角色 |
| `platform:owner` / `platform:admin` | 归一平台地位（`platform:admin` 也接受群主） |
| `platform-role:<id>` | 平台原生角色 id |
| `platform-permission:<name>` | 平台原生权限 |

运行时读取：`message.sender.chatRole`、`message.sender.platform`；`@zhin.js/core` 提供 `chatRoleIncludes(held, required)`、`expandChatRole(role)`、`chatRolesFromMessage(message)`。从旧写法升级见[升级到聊天角色](../migrations/chat-roles.md)。
