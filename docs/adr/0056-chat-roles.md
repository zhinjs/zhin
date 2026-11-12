---
sidebar: false
---

# ADR 0056：聊天角色——平台身份归一、zhin 角色分四级、映射规则可分层配置

状态：Accepted（2026-11-12）

取代框架层 `SenderRole`（`user` / `trusted` / `master`）与 ADR 0055 中单独的「功能管理员」；与 ADR 0050 / 0055 的四级层级一致。

## 背景

- 框架层的发送者角色只有 `master` / `trusted`，按账号写在适配器配置（`owner` / `trusted`）与 `ai.trigger.masters / trusted` 里：一个账号只有一个 master，没有全局、适配器、会话级，只能改配置文件。
- 平台群身份由适配器塞进 `message.sender.roles`（类型 `unknown[]`），权限包（`scene_admin` / `scene_owner`）、群规豁免、内容审核各自判断 `'owner'` / `'admin'` 字符串；Discord 身份组、Telegram 管理员权限等更丰富的角色无法表达。
- ADR 0055 新增的四级「功能管理员」与 master / trusted 重叠，两套概念会让「谁能做什么」难以判断。

## 决策

### 1. 平台身份（适配器上报，统一格式）

```ts
interface PlatformStanding {
  readonly standing: 'owner' | 'admin' | 'member' | 'guest';  // 群内地位：群主 / 管理员 / 成员 / 访客
  readonly roles?: readonly { readonly id: string; readonly name?: string }[];  // 平台原生角色（如 Discord 身份组）
  readonly permissions?: readonly string[];                    // 平台原生权限（适配器能报多少报多少）
}
```

- 挂在入站消息的 `sender.platform` 上；私聊为 `member`（或不提供）。
- 适配器在能力画像（ADR 0044）中声明支持 `standing` / `roles` / `permissions` 中的哪些；运行时代码不按平台名分支。
- 现有对 `sender.roles` 中 `'owner'` / `'admin'` 字符串的判断全部改为读 `standing`；`sender.roles` 移除。

### 2. zhin 聊天角色：`owner` / `admin` / `trusted` × 四级

| 层级 | 作用范围键（同 ADR 0055） |
|---|---|
| `global` | — |
| `adapter` | `<别名>` |
| `endpoint` | `<别名>/<endpointId>` |
| `conversation` | `<别名>/<endpointId>/<kind>:<id>` |

- 能力包含：`owner` ⊃ `admin` ⊃ `trusted`。
  - `owner`：取代 `master`。Agent 危险工具、主人审批等最高信任操作。
  - `admin`：功能管理（ADR 0055 群内自助与管理员命令）。
  - `trusted`：取代 `trusted`。Agent 中等风险工具等。
- 向下继承：某作用范围的角色对其下所有作用范围有效；同一人可在不同范围担任不同角色。
- 身份：平台用户为 `(适配器别名, userId)`；`global` 角色可为每个平台登记一个身份。
- 处理每条消息时，按「会话 → 账号 → 适配器 → 全局」链计算发送者的有效角色（取最高）。

### 3. 存储与管理

- 实例拥有的表 `chat_roles`：`(level, scope_key, adapter, user_id, role, granted_by, granted_at)`，主键 `(level, scope_key, adapter, user_id)`；启动时加载到内存，写入即时生效。
- 管理入口：
  - Console RPC `chat-roles.list|grant|revoke`（权限 `iam.manage` 管全局 / 适配器 / 账号层；作用域绑定在其适配器 / 账号下也算数），四个层级的页面都有「角色」区块，显示直接授予、继承与映射得到的角色及来源。
  - 聊天命令 `角色 列表|授予|撤销 <用户> <角色> [层级]` / `role list|grant|revoke …`：授予者必须在目标作用范围拥有不低于被授予角色的角色，且不能授予高于自己的角色；`owner` 只能由更高层的 `owner` 授予。
- 迁移：首次启动时把配置中的账号 `owner` / `trusted` 与 `ai.trigger.masters` / `trusted` 写入 `chat_roles`（账号层 / 全局层），写入后从配置中移除并记录日志；之后配置文件不再接受这些字段（启动时报错并指向升级指南）。

### 4. 映射规则：平台身份 → zhin 角色

```yaml
roles:
  mappings:
    - match: { standing: [owner, admin] }       # 或 { role: '<平台角色 id>' } / { permission: 'ban_members' }
      grant: admin
```

- 可写在适配器层（对其所有账号）、账号层、会话层（数据库，Console / 聊天管理）；下级规则追加或覆盖上级同 `match` 的规则。
- 映射结果只作用于**消息所在会话**（会话层），每条消息按当前平台身份实时计算，不落库；平台上撤销管理员，zhin 中对应角色随即消失。
- 安全默认：
  - 默认规则只有「`standing` 为 `owner` / `admin` → 会话层 `admin`」，可关闭或收紧为只限 `owner`；
  - 映射到 `trusted` / `owner` 需要显式规则，且只在会话层生效；不能经映射获得账号层及以上的角色。

### 5. 权限声明

- 命令、工具、页面、插件 RPC 的 `requiredRoles` 可写：
  - zhin 角色：`owner` / `admin` / `trusted`（按当前会话的层级链判断）；
  - 平台条件：`platform:owner` / `platform:admin`（归一地位）、`platform-role:<id>`、`platform-permission:<name>`。
- 移除：`master`、`scene_admin`、`scene_owner`、`platform(adapter,perm)`（不保留兼容，升级指南给出对照）。
- Agent 安全策略（危险工具策略、主人审批）、群规豁免、内容审核豁免改为读新模型。

### 6. 与 ADR 0055 的关系

ADR 0055 的「功能管理员」即本 ADR 的 `admin` 角色：功能管理命令要求目标作用范围上的 `admin`（或 `owner`）；`feature.admins.*` RPC 由 `chat-roles.*` 取代。

## 落盘位置

- 角色模型与解析：`packages/im/core`（替换 `built/roles.ts`、`host/sender-enrichment.ts`）
- 存储、RPC、聊天命令、迁移：实例 `packages/im/zhin/src/instance/`
- 平台身份上报：各适配器 + `@zhin.js/im-contract`
- 权限检查：`packages/im/permission`；Agent：`packages/im/agent/src/security/`
- 协议：`@zhin.js/console-protocol`

## 后果

- 「谁能做什么」只有一套模型，Console 与聊天都能管理，配置文件不再保存人员名单。
- 平台身份可以细到 Discord 身份组 / Telegram 管理员权限，并按需映射为 zhin 角色。
- 破坏性变更：`master` 改为 `owner`；配置中的 `owner` / `trusted` / `ai.trigger.masters|trusted` 自动迁移进数据库；插件的 `requiredRoles` 与权限写法需要按升级指南调整。
