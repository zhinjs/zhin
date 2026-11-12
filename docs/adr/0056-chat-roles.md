---
sidebar: false
---

# ADR 0056：聊天角色——zhin 角色分四级，平台身份与机器人自身身份是独立维度

状态：Accepted（2026-11-12）；修订：2026-11-12（§1 补机器人自身身份；§4 改为「平台身份不映射为 zhin 角色，能力可用性按三条维度过滤」；§5 补 `bot:*` 与共用评估器）

取代框架层 `SenderRole`（`user` / `trusted` / `master`）与 ADR 0055 中单独的「功能管理员」；与 ADR 0050 / 0055 的四级层级一致。

## 背景

- 框架层的发送者角色只有 `master` / `trusted`，按账号写在适配器配置（`owner` / `trusted`）与 `ai.trigger.masters / trusted` 里：一个账号只有一个 master，没有全局、适配器、会话级，只能改配置文件。
- 平台群身份由适配器塞进 `message.sender.roles`（类型 `unknown[]`），权限包（`scene_admin` / `scene_owner`）、群规豁免、内容审核各自判断 `'owner'` / `'admin'` 字符串；Discord 身份组、Telegram 管理员权限等更丰富的角色无法表达。
- ADR 0055 新增的四级「功能管理员」与 master / trusted 重叠，两套概念会让「谁能做什么」难以判断。
- 平台操作（禁言、踢人、撤回他人消息、改群名片……）是由**机器人账号**执行的，机器人自己在群里不是管理员时这些操作必然失败；此前只有能力画像按机器人地位收窄，命令与工具权限无法表达「机器人需要是管理员」。

## 决策

### 1. 平台身份（适配器上报，统一格式）

```ts
interface PlatformStanding {
  readonly standing: 'owner' | 'admin' | 'member' | 'guest';  // 群内地位：群主 / 管理员 / 成员 / 访客
  readonly roles?: readonly { readonly id: string; readonly name?: string }[];  // 平台原生角色（如 Discord 身份组）
  readonly permissions?: readonly string[];                    // 平台原生权限（适配器能报多少报多少）
}
```

同一个形状描述两种身份：

- **发言者的平台身份**：挂在入站消息的 `sender.platform` 上；私聊不提供。适配器在能力画像（ADR 0044）的 `scene.platformStanding` 中声明支持 `standing` / `roles` / `permissions` 中的哪些。
- **机器人账号自身在该会话的平台身份**（2026-11-12 补充）：适配器实现可选的 `EndpointManagement.inspectSelfStanding({ conversation, signal })`（请求类型 `@zhin.js/im-contract` 的 `SelfStandingRequest`），并在能力画像中声明 `scene.selfStanding`（同样按 `standing` / `roles` / `permissions` 声明）。声明了却没实现的适配器在装配时报错。
  - 框架只经 `AdapterIndex.selfStanding(endpointId, conversation)` 读取：按会话缓存（已知 60 秒，未知 / 失败 10 秒）、并发查询合并为一次平台调用；`cachedOnly` 读取只看缓存并在后台刷新。IM Runtime 收到 `member.role_changed`（任何成员）或机器人自身的 `member.joined` / `member.left` 时丢弃该会话的缓存。
  - 未声明、私聊、查询失败都按「未知」处理。

运行时代码不按平台名分支。现有对 `sender.roles` 中 `'owner'` / `'admin'` 字符串的判断全部改为读 `standing`；`sender.roles` 移除。

### 2. zhin 聊天角色：`owner` / `admin` / `trusted` × 四级

| 层级 | 作用范围键（同 ADR 0055） |
|---|---|
| `global` | — |
| `adapter` | `<别名>` |
| `endpoint` | `<别名>/<endpointId>` |
| `conversation` | `<别名>/<endpointId>/<kind>:<id>` |

- 能力包含：`owner` ⊃ `admin` ⊃ `trusted`。
  - `owner`：取代 `master`。Agent 危险工具、主人审批等最高信任操作。
  - `admin`：zhin 功能管理（ADR 0055 群内自助与管理员命令、角色管理）。
  - `trusted`：取代 `trusted`。Agent 中等风险工具等。
- 向下继承：某作用范围的角色对其下所有作用范围有效；同一人可在不同范围担任不同角色。
- 身份：平台用户为 `(适配器别名, userId)`；`global` 角色可为每个平台登记一个身份。
- 处理每条消息时，按「会话 → 账号 → 适配器 → 全局」链计算发送者的有效角色（取最高），写入 `sender.chatRole`。

### 3. 存储与管理

- 实例拥有的表 `chat_roles`：`(level, scope_key, adapter, user_id, role, granted_by, granted_at)`，主键 `(level, scope_key, adapter, user_id)`；启动时加载到内存，写入即时生效。zhin 角色**只**来自这里的授予（含迁移来的授予）。
- 管理入口：
  - Console RPC `chat-roles.list|grant|revoke`（权限 `iam.manage` 管全局 / 适配器 / 账号层；作用域绑定在其适配器 / 账号下也算数），四个层级的页面都有「角色」区块，显示直接授予与继承的角色及来源。
  - 聊天命令 `角色 列表|授予|撤销 <用户> <角色> [层级]` / `role list|grant|revoke …`：授予者必须在目标作用范围拥有不低于被授予角色的角色，且不能授予高于自己的角色；`owner` 只能由更高层的 `owner` 授予。
- 迁移：首次启动时把配置中的人员名单写入 `chat_roles`——适配器块 `master` / `trusted` → 适配器层，`endpoints[i].master` / `trusted` → 账号层，`ai.trigger.masters` / `trusted` → 全局层（为每个已配置的适配器各登记一个身份）——并从配置中移除、记录日志（先记入 `.zhin/chat-roles-migration.json` 再改配置，数据库就绪后写表，可断点续做）；之后配置文件不再接受这些字段（启动时报错并指向升级指南）。

### 4. 平台身份不映射为 zhin 角色；能力可用性按三条维度过滤（2026-11-12 修订）

平台群主 / 管理员与 zhin 角色没有直接关联：zhin 角色管的是 **zhin 的功能**（功能开关与配置、角色管理、聊天改配置、Agent 信任档位），平台身份管的是**平台的功能**（禁言、踢人、群公告、身份组……）。因此：

- 删除此前的映射规则（`roles.mappings`、会话层 `chat_role_mappings` 表、默认的「群主 / 管理员 → 会话 `admin`」规则、`chat-roles.mappings` / `chat-roles.set-mappings` RPC、列表中的 `source: 'mapping'`）。不保留兼容：配置中出现适配器块或账号项的 `roles` 时启动报错（`LEGACY_CHAT_ROLE_CONFIG`）并指向升级指南。
- 命令、Agent 工具、技能、Agent 包、中间件、按钮回调的可用性按三条**相互独立**的维度判断，组合方式见 §5：
  1. 发言者的 zhin 角色（`owner` / `admin` / `trusted`）；
  2. 发言者的平台身份（`platform:*`）；
  3. 当前 endpoint——机器人账号自身——在该会话的平台身份（`bot:*`）。
- Agent 回合前过滤：组装本回合可用的 tool / skill / Agent 包时（capability ingress），按三条维度评估每一项的 `permissions`，只把可用的披露进会话；执行工具时用同一份事实再校验一次，防止调用未披露的工具。机器人身份在回合开始时与场景事实一起读取（走 §1 的缓存）。
- 命令分发前用同一个评估器判断；不满足时走现有拒绝路径，平台 / 机器人条件会说明缺哪一项（如「机器人不是本群管理员」），zhin 角色与会话条件保持通用提示。命令菜单只列出当前发言者在本会话可用的命令。

### 5. 权限声明

- 命令的 `permit`、Agent 工具 / 技能 / Agent 包的 `permissions`、中间件的 `permit`、按钮（`<Button onClick permit>`）的 `permit` 使用同一套内置 DSL，由同一个评估器（`@zhin.js/permission` 的 `PermissionHost`）判断：
  - zhin 角色：`owner` / `admin` / `trusted`，或 `role(…)`（按当前会话的层级链判断）；
  - 发言者平台身份：`platform:owner` / `platform:admin`（归一地位；`platform:admin` 也接受群主）、`platform-role:<id>`、`platform-permission:<name>`；
  - 机器人自身平台身份：`bot:owner` / `bot:admin`（同上）、`bot-role:<id>`、`bot-permission:<name>`（例如禁言、踢人要求 `bot:admin` 或 `bot-permission:ban_members`）。机器人身份未知时不满足。
- 组合沿用现有语法：列表各项 AND，单项括号内逗号 OR。配置项需要「满足任一条件」时（如内容审核豁免）用 permit 列表、任一满足即可，语义由该配置项说明。
- 中间件按 permit 跳过：不满足时本条消息跳过该中间件、继续后续链路、不回复；机器人身份只读缓存，不为每条消息增加平台请求。组件本身是纯渲染，不加权限；可被聊天触发的入口是回调按钮，按点击者鉴权。
- Console 页面与插件 RPC 的 `requiredRoles` 仍是 Console 账号的角色名（ADR 0049），与聊天角色无关（2026-11-12 实施时澄清）。
- 移除：`master`、`scene_admin`、`scene_owner`、`platform(adapter,perm)`（不保留兼容，升级指南给出对照）。命令、中间件、Agent 工具在定义时遇到这些写法直接报错。
- Agent 安全策略（危险工具策略、文件 / exec 策略、主人审批）只看 zhin 角色。群规豁免与内容审核豁免作为平台功能，默认豁免 zhin `owner` 与平台群主 / 管理员（`platform:admin`）；内容审核可用 permit 列表 `inbound.bypass` 配置。

### 6. 与 ADR 0055 的关系

ADR 0055 的「功能管理员」即本 ADR 的 `admin` 角色：功能管理命令要求目标作用范围上的 `admin`（或 `owner`）；`feature.admins.*` RPC 由 `chat-roles.*` 取代。平台群主 / 管理员不自动具备（§4）。

## 落盘位置

- 角色模型与解析：`packages/im/core/src/built/roles.ts`（`ChatRoleService`、`createChatRoleSenderEnricher`）；Runtime 接线：`packages/im/core/src/plugin-runtime/im/host/sender-enrichment.ts`（`createSenderEnricher`、`senderOwnsReceivingAdapter`）
- 存储：实例 `packages/im/zhin/src/instance/chat-roles.ts`（`chat_roles`）；迁移：`chat-role-migration.ts`；RPC：`console/chat-roles-rpc.ts`；聊天命令：`feature-self-service.ts`
- 平台身份类型：`@zhin.js/im-contract` 的 `PlatformStanding`、`SelfStandingRequest`；上报：各适配器（`sender.platform`、`management.inspectSelfStanding`）；缓存：`@zhin.js/adapter` 的 `AdapterIndex.selfStanding` / `invalidateSelfStanding`；失效：IM Runtime 场景事件
- 权限评估：`packages/im/permission`（`builtin.ts`、`host.ts` 的 `setBotStandingResolver` / `firstDenied`）；命令：`packages/im/command`；中间件：`packages/im/middleware`；按钮：`packages/im/core/src/plugin-runtime/im/interactive-router.ts`；Agent：`packages/im/agent/src/plugin-runtime/capability-ingress.ts`、`ingress/request-capabilities.ts`、`turn/turn-ingress.ts`（`turnPermissionSubject`）
- 协议：`@zhin.js/console-protocol` 的 `chat-roles.ts`
- 升级指南：`docs/migrations/chat-roles.md`；概念：`docs/concepts/chat-roles.md`

## 后果

- 「谁能做什么」分成三条可独立推理的维度：zhin 角色只来自授予，Console 与聊天都能管理，配置文件不再保存人员名单；平台身份细到 Discord 身份组 / Telegram 管理员权限，但只用于平台功能。
- 需要机器人是管理员的平台操作在回合前就被过滤掉，不会先披露再在平台报错。
- 破坏性变更：`master` 改为 `owner`；配置中的 `owner` / `trusted` / `ai.trigger.masters|trusted` 自动迁移进数据库；`roles.mappings` 删除（启动报错）；平台群主 / 管理员不再自动是会话 `admin`；插件的权限写法需要按升级指南调整。
