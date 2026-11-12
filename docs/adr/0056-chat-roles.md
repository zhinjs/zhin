---
sidebar: false
---

# ADR 0056：聊天角色——zhin 角色分四级，平台身份与机器人自身身份是独立维度

状态：Accepted（2026-11-12）；修订：2026-11-12（§1 补机器人自身身份；§4 改为「平台身份不映射为 zhin 角色，能力可用性按三条维度过滤」；§5 补 `bot:*` 与共用评估器）；修订：2026-11-12 安全审查（§2 角色来源层级与宿主全局能力、线程沿用父会话键；§3 授予 / 撤销规则、Console RPC 的 owner 门槛与列表脱敏、无持久化时拒绝写入、迁移语义；§5 `<角色>@<层级>` 写法、执行时重新读取）；修订：2026-11-12 出站媒体（§2 不可信来源的出站媒体不能读宿主文件）

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
  - 未声明、私聊、查询失败都按「未知」处理；`cachedOnly` 读到已过期的缓存也按「未知」处理（不返回陈旧值）。

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
- 处理每条消息时，按「会话 → 账号 → 适配器 → 全局」链计算发送者的有效角色（取最高），写入 `sender.chatRole`；同时写入 `sender.chatRoleLevels`：每个角色（或更高角色）在这条链上**最高来自哪一层**（如会话层 owner + 全局 trusted → `{ owner: 'conversation', admin: 'conversation', trusted: 'global' }`）。两者只由 Runtime 写入，适配器 / 插件自带的一律丢弃（事件流发布的也是增强后的 sender）。
- 子话题 / 线程（`conversation.threadId`）沿用父会话的会话键：角色与功能配置一致，在频道上授予的角色在其线程里同样有效（Discord 线程上报为「父频道 id + `threadId`」）。平台容器（`conversation.parent`，如 guild）**不**增加层级。会话无法生成会话键（未知 kind、id 含控制字符或超长）时退回账号层链（账号 → 适配器 → 全局）解析，全局 / 适配器 / 账号层的角色照常生效；聊天命令仍要求可识别的会话。

#### 角色的作用范围（安全审查修订）

`sender.chatRole` 是「本会话链上的最高角色」，会话层 `owner` 只是**这个会话**的主人，不是宿主的主人。按最小权限：

| 能力 | 要求 |
| --- | --- |
| 宿主全局能力：Agent 危险工具 / exec / 文件写与敏感读（文件策略）、主人审批的接收人、重启实例、写全局 / 平台记忆、定时任务的高信任运行、聊天改项目配置（`config set`）、跨适配器的账号恢复（如 `icqq login`） | **全局层** `owner` |
| 增删适配器账号（`<适配器> endpoint add\|remove`） | **适配器层或以上** `owner` |
| 其余 zhin 功能（功能自助、角色管理、订阅、群规审批……） | 按目标作用范围判断（§3、§6） |

- Agent 回合主体 `principal.roles` 承载宿主信任档位：只有全局 owner 展开为 `owner, admin, trusted`；更低层的 owner 在这里按 `admin` 计（`hostChatRole`）。链上角色保留在 `principal.chatRole` / `principal.chatRoleLevels`，供 permit 判断。
- 运行时读取：`@zhin.js/core` / `@zhin.js/im-contract` 的 `chatRoleHeldAt(sender, role, level)`（在该层级或更高层级持有）、`hostChatRole(sender)`；`sender.chatRoleLevels` 缺失时一律按会话层处理（fail closed）。

#### 出站媒体（2026-11-12 修订）

适配器会读取并上传 `MediaRef kind: 'path'`，部分适配器还把 `file` 引用、`file://` 地址交给平台端从宿主读取。若模型输出能产生这类媒体段，就绕过了文件策略与「读宿主文件需全局 owner」。因此：

- 出站内容分可信与不可信来源。插件代码自己构造的内容（`$reply`、命令、组件、中间件）可信；Agent 模型输出（回复、流式回复、场景事件回复、主动发送）与适配器 Agent 工具用模型参数拼出的内容不可信，以 `untrustedContent(content, trust)` 交给出站链（流式回复用 `OpenReplyStreamOptions.mediaTrust`）。
- Core 的 `OutboundRenderer` 在出站中间件与 Endpoint 之前统一处理不可信内容（`built/outbound-media-trust.ts`），出站链仍唯一：媒体只允许 `http(s)`、有上限的内联数据（默认 25 MiB）、裸平台文件标识；本地路径（含 `file://`）只在 `trust.authorizePath` 认可（Agent：本回合工作区授权 + 文件策略 + 按发起人文件角色的 `read_file` 读取判定，需确认的敏感读取直接拒绝）或可信代码以 `trustedMediaRef()` 构造时放行；嵌套的本地来源拒绝、`html` 只保留文字、不做模板替换。
- 被拒的段替换为可见提示并记录 `op=outbound_media_refused`（不记录路径本身）。

### 3. 存储与管理

- 实例拥有的表 `chat_roles`：`(level, scope_key, adapter, user_id, role, granted_by, granted_at)`，主键 `(level, scope_key, adapter, user_id)`；启动时加载到内存，写入即时生效。zhin 角色**只**来自这里的授予（含迁移来的授予）。
- 管理入口：
  - Console RPC `chat-roles.list|grant|revoke`（权限 `iam.manage` 管全局 / 适配器 / 账号层；作用域绑定在其适配器 / 账号下也算数），四个层级的页面都有「角色」区块，显示直接授予与继承的角色及来源。
  - 聊天命令 `角色 列表|授予|撤销 <用户> <角色> [层级]` / `role list|grant|revoke …`。对目标作用范围上某个身份的授予做任何改动时（安全审查修订）：
    - 「被触及的角色」= 要授予的角色与该身份在此范围**已有**的角色（被替换或撤销的）；每个被触及的角色都不能高于操作者在该范围的角色；
    - 触及 `owner`（授予、降级或撤销）只能由**更高层**的 `owner` 进行；
    - 已有角色与操作者同级时（同级的授予）只有更高的角色、或在更高层持有同一角色的人才能修改或撤销——低角色的授予不能覆盖同级或更高的角色；
    - `角色 列表` 要求本会话的 `admin`；操作者不管理的上级作用范围中的条目只显示角色与层级、不显示身份。
  - Console RPC：授予 / 撤销 `owner`（或替换 / 撤销一条已有的 owner 授予）需要**全局** `iam.manage`，与目标层级无关——绑定到适配器 / 账号的 Console 账号不能授予 owner（包括授予自己会话 owner 以获取 exec）；`admin` / `trusted` 按作用域 `iam.manage`（被授予的作用范围须在调用者绑定作用域之内）。`chat-roles.list` 对调用者不管理的作用范围中的条目返回 `{ level, key, role, source, redacted: true }`（不含 `adapter` / `userId`）。
- 持久化：授予只在关系型项目数据库（sqlite / mysql / pg）中保存。数据库不支持时 `chat-roles.grant|revoke` 返回 503（`code: 'chat-roles-unpersisted'`），聊天命令回复「未保存：……」，不再「只存内存却回复已保存」。
- 迁移：首次启动时把配置中的人员名单写入 `chat_roles`，保持旧语义——
  - 适配器块 `master` 以前只对**没有自己 `master` 的账号**有效（账号自己的 `master` 取代它）：迁移为这些账号各自的账号层 `owner`，**不**建适配器层 owner；`endpoints[i].master` → 账号层 `owner`；
  - `trusted` 以前是合并（适配器 ∪ 账号）：适配器块 `trusted` → 适配器层，`endpoints[i].trusted` → 账号层；
  - `ai.trigger.masters` / `trusted` → 全局层，为每个已配置的适配器各登记一个身份，但**跳过**能力画像声明 `runtime.sandbox` 的本地模拟适配器（其客户端可以自选发送者 id）与未能加载、无法判断的适配器（写日志）；
  - 从配置中移除、记录日志（先记入 `.zhin/chat-roles-migration.json` 再改配置，数据库就绪后写表，可断点续做）；之后配置文件不再接受这些字段（启动时报错并指向升级指南）。
  - 没有关系型数据库时，迁移来的授予只在内存中生效（记录保持 `pending` 并标记 `memoryOnlyAt`，等配置了关系型数据库再写表）；由于此时授予 / 撤销都会被拒绝，不会出现「撤销后下次启动复活」。

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
  - zhin 角色：`owner` / `admin` / `trusted`，或 `role(…)`（按当前会话的层级链判断）；层级限定写法 `<角色>@<层级>`（`owner@global`、`owner@adapter`、`admin@endpoint`、`trusted@conversation`，也可写在 `role(…)` 里，如 `role(owner@global,admin)`）要求该角色来自该层级或更高层级（读 `sender.chatRoleLevels`）。不带层级的 `owner` 含义不变：「在当前会话链上」。插件提供宿主全局能力时应写 `owner@global`；
  - 发言者平台身份：`platform:owner` / `platform:admin`（归一地位；`platform:admin` 也接受群主）、`platform-role:<id>`、`platform-permission:<name>`；
  - 机器人自身平台身份：`bot:owner` / `bot:admin`（同上）、`bot-role:<id>`、`bot-permission:<name>`（例如禁言、踢人要求 `bot:admin` 或 `bot-permission:ban_members`）。机器人身份未知时不满足。
- 组合沿用现有语法：列表各项 AND，单项括号内逗号 OR。配置项需要「满足任一条件」时（如内容审核豁免）用 permit 列表、任一满足即可，语义由该配置项说明。
- 中间件按 permit 跳过：不满足时本条消息跳过该中间件、继续后续链路、不回复；机器人身份只读缓存，不为每条消息增加平台请求（缓存缺失或过期即「未知」，`bot:*` 不满足）。因此 permit **不适合执法型中间件**（必须对每条消息生效的审核、限流、禁言等）：缓存冷启动时它会被跳过，执法逻辑应自己判断并在需要时查询。组件本身是纯渲染，不加权限；可被聊天触发的入口是回调按钮，按点击者鉴权。
- 执行时复检（安全审查修订）：Agent 工具执行时重新从角色存储读取发言者角色（内存，开销小）并重新查询机器人身份（命中 60 秒缓存），而不是沿用回合开始时的事实；定时任务到期运行时按创建者**当前**角色（`ScheduleJobCreator.chat` 记录的会话地址）重新判断，普通用户创建的任务以普通成员信任运行，地址无法解析时按 `user` 运行。
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
- 出站媒体策略：`packages/im/core/src/built/outbound-media-trust.ts`（`untrustedContent` 在 `plugin-runtime/im/contracts.ts`，执行于 `outbound-renderer.ts`）；Agent 侧：`packages/im/agent/src/media/media-normalize.ts`（`modelMediaTrust`、`authorizeOutboundMediaPath`）

## 后果

- 「谁能做什么」分成三条可独立推理的维度：zhin 角色只来自授予，Console 与聊天都能管理，配置文件不再保存人员名单；平台身份细到 Discord 身份组 / Telegram 管理员权限，但只用于平台功能。
- 需要机器人是管理员的平台操作在回合前就被过滤掉，不会先披露再在平台报错。
- 破坏性变更：`master` 改为 `owner`；配置中的 `owner` / `trusted` / `ai.trigger.masters|trusted` 自动迁移进数据库；`roles.mappings` 删除（启动报错）；平台群主 / 管理员不再自动是会话 `admin`；插件的权限写法需要按升级指南调整。
