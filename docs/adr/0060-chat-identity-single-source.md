---
sidebar: false
---

# ADR 0060：聊天身份与角色的唯一事实来源——人、平台身份与角色绑定

状态：已接受（Accepted，2026-11-14）。所有者按「决定」一节（原「未决问题」）中的推荐结论定案；P0–P3 已实施，P4 待实施。

关联：ADR 0049（Console 访问控制）、ADR 0056（聊天角色）、ADR 0057（配置与状态存放：种子导入）、ADR 0059（Console 账号放 `.zhin/gateway.db`）、ADR 0044（能力画像，不按平台名分支）。来源：issue zhinjs/zhin#1250 的部署反馈（`identity-lists-fragmented`、`chat-role-bootstrap`、`sandbox-console-identity-owner`、`role-grant-identity-picker`）。

本 ADR 不推翻 ADR 0056 的角色模型（`owner` ⊃ `admin` ⊃ `trusted` × 四级作用范围、平台身份不映射为 zhin 角色、三维度权限过滤），而是在它下面补上「人」这一层，把其余几处「谁是管理员」的名单收拢到 `chat_roles`，并解决新部署没人有角色的引导问题。

## 背景

### 1. 「谁是管理员」散在五处，互不映射（`identity-lists-fragmented`）

| # | 名单 | 存放 | 代码依据 | 问题 |
| --- | --- | --- | --- | --- |
| ① | 聊天角色 | 项目库 `chat_roles`，键 `(level, scope_key, adapter, user_id)` | `packages/im/zhin/src/instance/chat-roles.ts:27-48` | ADR 0056 规定的唯一来源，但身份是「一个适配器别名 + 一个 userId」，没有「人」 |
| ② | `ai.personalPrincipals` | `zhin.config.yml` | `packages/im/zhin/src/instance/start-command.ts:804-830`；类型 `packages/im/agent/src/personal-session/types.ts:15-22` | 键是 Console 用户（`user:<id>`，`packages/im/zhin/src/instance/inference/routes.ts:13-15`），值要手写 `rootId`（= `resolve(projectRoot)` 绝对路径，`packages/im/agent/src/plugin-runtime/inference/host.ts:72`）、`adapterId`（能力条目 id，以 `\0` 分隔，`packages/im/adapter/src/adapter-index.ts:810`、`:886`）与 `subjectId`。`rootId` 不等于当前目录就启动失败（`start-command.ts:812`：`Personal principal binding belongs to another Host`），项目目录一移动即失效；与聊天角色毫无关系 |
| ③ | 适配器 owner / master | 适配器配置 | sandbox `owner`：`plugins/adapters/sandbox/src/protocol.ts:92`（只是默认发言者 id，不授予任何角色，`plugins/adapters/sandbox/src/adapter.ts:12`）；icqq `master`：README 仍写「必填」（`plugins/adapters/icqq/README.md:48`），代码已不读取 | 旧 `master` 只在**第一次**启动被迁移为账号层 `owner`（`packages/im/zhin/src/instance/chat-role-migration.ts:107-119`）；迁移记录为 `done` 后配置里再出现就**启动失败**（同文件 `:254-258`）。新部署按 README 写 `master`、之后再加一个适配器的 `master`，第二次就起不来 |
| ④ | 插件自建名单 | 插件配置 | 例：内容审核 `inbound.whitelist.userIds`（`plugins/utils/content-moderation/src/bypass.ts:20-21`）；第三方插件常见 `masters` | 框架没给插件「读聊天角色」的文档化入口，插件只好自建。实际上 `chatRoleHeldAt` / `hostChatRole` 已从 `zhin.js` 导出（`packages/im/im-contract/src/chat-role-level.ts:46-62`，经 `packages/im/core/src/built/roles.ts:26-29` 与 `packages/im/zhin/src/index.ts:10`），但只能判断「当前消息的发言者」，不能回答「谁是 owner、该通知谁」 |
| ⑤ | Console 账号 | `.zhin/gateway.db`（ADR 0059） | `packages/host/gateway/src/iam/` | Console 账号与聊天身份之间没有任何链接；唯一沾边的是 ② 的手写映射 |

### 2. 新部署没人有聊天角色（`chat-role-bootstrap`）

- 聊天侧的 `功能` 入口要求操作者在任一作用范围持有 `admin`（`packages/im/zhin/src/instance/feature-self-service.ts:236-241`），拒绝文案只有「你在该范围没有 admin 角色。」（`:87`），不说去哪里授予。
- `角色 授予` 触及 `owner` 必须由**更高层**的 `owner` 操作（`feature-self-service.ts:411-428`），全局 `owner` 因而只能从 Console 授予，且需要全局 `iam.manage`（`packages/im/zhin/src/instance/console/chat-roles-rpc.ts:91-94`）。新部署第一位 owner 只能走 Console，而聊天侧的提示并不指向 Console。
- 适配器 master 只迁移成**账号层** owner（见上），不满足「宿主全局能力需要全局 owner」（ADR 0056 §2；`packages/im/core/src/plugin-runtime/im/host/sender-enrichment.ts:61-76`），部署者以为自己是主人，`config set`、危险工具却被拒。
- 平台群主 / 管理员不映射任何 zhin 角色（ADR 0056 §4，有意为之），但用户感知是「我是群主却什么都用不了」。

### 3. Console「会话」页的身份错位（`sandbox-console-identity-owner`）

- Sandbox 页默认以 `dev-user` 发言，预设按钮写着「Master (dev-user)」（`plugins/adapters/sandbox/pages/index/SandboxChat.tsx:109-111`、`:1206`）；这个 `master` 被适配器换算成**平台身份** `standing: 'owner'`（群主），并注明「不授予框架角色」（`plugins/adapters/sandbox/src/endpoint.ts:392-394`）。
- Agent 侧的信任档位只看 zhin 角色：没有角色的 IM 发言者一律 `group_member`（`packages/im/agent/src/security/trust-level.ts:78-86`），回合主体 `roles` 缺省为 `['user']`（`packages/im/agent/src/turn/turn-ingress.ts:43-44`）。于是界面标 MASTER，trace 里是 `user` / `group_member`。
- Sandbox WS 是宿主认证的 socket（需要 `endpoint.operate`，`packages/console/protocol/src/permissions.ts:561-565`），连接上带着 Console 主体（`endpoint.ts:324`），但发言者 id 由客户端自填（`endpoint.ts:368`）；ADR 0056 迁移因此刻意跳过 sandbox（`chat-role-migration.ts:276-288`）。Console 主体与聊天身份没有关联。

### 4. 授予角色只能手填（`role-grant-identity-picker`）

- Console RPC `chat-roles.grant` 的 `adapter` 与 `userId` 都是自由文本（`packages/console/protocol/src/chat-roles.ts:76-84`）。QQ 官方机器人的 openid 每个机器人一套、用户看不到，无法手填。
- 聊天侧 `角色 授予` 的目标身份固定为操作者所在适配器（`feature-self-service.ts:462`），跨平台的同一人只能分别授予、分别撤销，系统不知道它们是同一个人。

## 决策

### 1. 聊天角色是唯一事实来源

「谁在聊天里有什么权限」只有一个答案：项目库中的聊天角色授予（本 ADR 扩展后的 `chat_roles`）。

- 配置文件里的任何人员名单（适配器 `owner` / `master` / `trusted`、`ai.trigger.*`、`ai.personalPrincipals`）**只作为种子**：首次导入，之后不再是事实来源（§4）。
- 插件不再自建 `masters` / 管理员白名单；框架提供读取聊天角色的公共 API（§6）。插件自己的**非身份**白名单（如按会话豁免）不在此列。
- Console 账号（ADR 0049）仍是**另一个**主体体系：Console 权限不等于聊天角色，聊天角色也不带来 Console 权限。两者之间只允许一种显式链接（§2.4），用途见下。
- 平台身份仍不映射为 zhin 角色（维持 ADR 0056 §4），只改进拒绝提示（§5.3）。

### 2. 数据模型：人、平台身份、角色绑定、作用范围

```text
chat_principals      人（principal）          1 ──< chat_identities   平台身份 (adapter alias, user_id)
      │                                                    （一个平台身份至多属于一个人）
      ├──< chat_roles  角色绑定 (level, scope_key, role)
      └──○ chat_principal_console_links  Console 账号链接（一对一，可选）
```

#### 2.1 `chat_principals`（实例表，项目库）

| 字段 | 说明 |
| --- | --- |
| `id` | `cp_` + 随机 128 位，base32 |
| `display_name` | 运营者起的名字；仅显示用 |
| `created_by` / `created_at` | `console:user:<id>` / `chat:<adapter>:<userId>` / `import:<source>` |

#### 2.2 `chat_identities`

| 字段 | 说明 |
| --- | --- |
| `adapter`、`user_id` | 主键。与 ADR 0056 的身份一致：适配器**实例别名** + 平台用户 id；不存能力条目 id、不存 `rootId` |
| `principal_id` | 所属的人 |
| `linked_by` / `linked_at` / `link_method` | `link_method`：`implicit`（首次出现或迁移自动建的单身份人）、`code`（持有者在聊天中提交一次性绑定码，证明控制权）、`manual`（有权运营者在 Console 归并，未经本人证明）、`import` |
| `last_seen_at`、`last_display_name` | 最近发言时间与显示名缓存（供选择器用，§7；不参与鉴权） |

规则：

- 一个平台身份至多属于一个人；归并 = 把身份改挂到另一个人，拆分 = 为身份新建单身份人。
- 没有显式归属的身份视为「隐式单身份人」：首次授予角色或首次需要时才写行，避免为每个发言者建行。
- 仍不按平台名分支（ADR 0044）：身份只是 `(alias, user_id)` 字符串对。

#### 2.3 `chat_roles`：角色绑定到人

- 新增列 `principal_id`（非空，迁移时为每个已有 `(adapter, user_id)` 建隐式单身份人并回填）。主键改为 `(level, scope_key, principal_id)`。
- 过渡期保留 `adapter` / `user_id` 两列并**双写**（写入时填该人在该作用范围所属适配器上的首个身份），供降级回滚（§4.5）；下一个版本删除。
- 作用范围与继承不变（ADR 0056 §2）。低于全局的授予只对**该作用范围所属适配器上**的身份生效：在 `qq` 适配器层授予某人 `admin`，他的 Telegram 身份不会因此在 Telegram 上变成 admin。只有全局授予对他的全部身份生效。
- 解析：入站消息 → `(alias, sender.id)` → 所属人（无则隐式单身份人）→ 按「会话 → 账号 → 适配器 → 全局」链取该人的绑定，取最高。`sender.chatRole` / `chatRoleLevels` 的写入方与语义不变；新增只读的 `sender.chatPrincipal`（人 id，Runtime 写入，适配器 / 插件自带的丢弃）。

#### 2.4 与 Console 账号（ADR 0049 / 0059）的链接

- 表 `chat_principal_console_links(principal_id, console_user_id, linked_at, linked_via)`，放在**实例的项目库**。`console_user_id` 是 gateway.db 中 `console_users.id` 的值引用（不同库，无外键）；实例不读 gateway.db（ADR 0059 §1 不变），只使用网关转发来的主体 `user:<id>`。
- 链接行同时缓存 Console 用户的显示名（`console_display_name`，链接或该用户再次以本人身份操作时刷新），用于授予记录的「授予者」显示（决定 Q12）；它只是显示缓存，不参与鉴权。
- **允许，但一对一**：一个 Console 用户至多链接一个人，一个人至多链接一个 Console 用户。
- 链接**不传递权限**：链接不会让 Console 用户获得聊天角色，也不会让聊天 owner 获得 Console 权限。它只用于三件事：
  1. 取代 `ai.personalPrincipals`：Console 用户的个人推理主体 = 其链接的人在各账号上的平台身份（运行时用当前 `rootId` 计算 owner id，不再写进配置）；
  2. Sandbox 中以「我的聊天身份」发言（§5.4）；
  3. Console 显示「我是谁」、我的聊天角色。
- 建立链接的两种方式：
  - **自助（推荐，需证明）**：Console 用户点「把聊天身份绑定到我」，得到一次性绑定码（8 位、10 分钟、单次）；在聊天里私聊机器人发送 `绑定 <码>`（`bind <code>`），该平台身份即归入此 Console 用户的人；
  - **运营者代绑**：持有全局 `iam.manage` 的 Console 用户可直接链接任意人与任意 Console 用户（审计记为 `manual`）。
- Console 用户被删除 / 禁用时：网关在用户生命周期事件中通知实例删除链接（实例侧只按值失效，聊天角色不受影响）。

### 3. 引导：第一位 owner

新部署（数据库中没有任何全局 `owner` 绑定时）提供三条路，任一条完成即关闭引导：

1. **Console 绑定（主路径；P2 起）**：P1 中该项先指向 Console「聊天角色」页的全局授予与认领码。Console 初始化向导（ADR 0053）完成第一位 Console 所有者后，「需要你处理」出现 `chat-roles.no-owner` 项：「还没有聊天主人——在聊天中私聊机器人发送 `绑定 <码>`」。由于此时操作者持有全局 `iam.manage`，绑定完成后**同一流程**询问「是否把这个人设为全局 owner」，确认后授予（审计 `chat-roles.grant`，`grantedBy: console:user:<id>`）。
2. **配置种子导入**（§4）：首次启动导入适配器 owner / master、`ai.trigger.masters`、`ai.personalPrincipals`。
3. **认领码（无 Console 时）**：没有全局 owner 时，实例启动日志与 `zhin status` 打印一次性认领码（同 `http.token` 的引导语义：只在「尚无 owner」时有效，用一次即失效、重启轮换）；私聊机器人发送 `认领 <码>`（`claim <code>`）成为全局 owner。sandbox 类适配器（能力画像 `runtime.sandbox`）上不接受认领。

### 4. 迁移与兼容

#### 4.1 种子导入（首次）

| 来源 | 导入为 | 备注 |
| --- | --- | --- |
| 适配器 `master` / `endpoints[i].master` | 账号层 `owner`（与 ADR 0056 迁移一致） | 不自动提升到全局（决定 Q1） |
| `ai.trigger.masters` / `trusted` | 全局 `owner` / `trusted`，每个非模拟适配器一个身份，**同一人**（归入一个隐式人） | 跳过 `runtime.sandbox` 与未加载的适配器（沿用现有逻辑） |
| 适配器 `trusted` | 适配器层 / 账号层 `trusted` | 不变 |
| `ai.personalPrincipals[user:<id>]` | 为每个键建一个人，挂上其 owner 列表中的平台身份（`adapterId` 经当前快照换算成实例别名；`rootId` 不等于当前目录时**不再失败**，按别名 + subjectId 导入并告警），并链接到 Console 用户 `<id>` | **不授予角色**：这个字段只表达「推理配置归谁」，从未表达管理员身份（见 Q2） |
| sandbox `owner` | 不导入 | 客户端可自选发言者 id；改用 §5.4 |

- 导入完成后，日志列出导入条目，「需要你处理」出现 `chat-roles.imported`（信息级，列出导入的人与角色，提供「撤销」与「从配置删除」入口）。
- 记录仍写 `.zhin/chat-roles-migration.json`（沿用 ADR 0056 的先记后改、断点续做）；版本号升为 `2`。

#### 4.2 再次出现：不再启动失败

ADR 0057 §3 对种子「再次出现」的处理是「已忽略，数据库为准」并提示。本 ADR 对人员字段采用同样做法，取代 ADR 0056 的 `LEGACY_CHAT_ROLE_CONFIG` 启动失败（仅限 `master` / `trusted` / `ai.trigger.*`；`roles` 映射规则与 `features.selfService.*` 旧开关仍报错）：

- 已导入的项目中配置又出现这些字段时：**不自动授予**，启动日志告警，候选（来源路径、身份、拟授角色）先写入迁移记录的 `pendingImports`，再从配置文件移除这些字段（先记后改，同首次导入；适配器 Schema 不接受它们，见「决定」中的补充约定）；「需要你处理」出现 `chat-roles.import-pending`，持有全局 `iam.manage` 的 Console 用户经 `chat-roles.imports.resolve` 逐条「导入」或「忽略」。
- 理由：首次导入时配置是部署者唯一的表达途径；之后改配置的人不一定是 owner（`ops.config.write` 可单独授予），自动导入会成为提权路径。

#### 4.3 幂等与冲突

- 幂等键：`(来源路径, alias, user_id, level, scope_key)`。同一记录重复执行只写一次；已存在同作用范围绑定时**保留较高者**，从不降级、从不删除。
- 身份已属于另一个人（例如已被归并）：导入的角色绑定到**那个人**，不新建人；`personalPrincipals` 要求链接的 Console 用户已链接到别的人时，跳过链接并告警（一对一约束），身份照常归入已有链接的人。
- 别名无法解析（适配器未加载）：记录保持 `pending` 并在「需要你处理」中显示，不丢弃。

#### 4.4 弃用节奏

| 字段 | 本 ADR 第 1 阶段 | 第 3 阶段 | 第 4 阶段 |
| --- | --- | --- | --- |
| 适配器 `master` / `owner`（人员语义）/ `trusted`、`ai.trigger.*` | 首次导入；再次出现 → 待确认导入（不再启动失败） | 同左 | 同左（作为长期支持的种子格式） |
| `ai.personalPrincipals` | 首次导入为人 + Console 链接；仍被读取 | 读取改为只读链接表；字段出现 → 告警「已导入，数据库为准」 | 移除 schema 字段，出现时告警并忽略（不失败） |
| sandbox `owner` | 保留，文档改称「默认会话 / 默认发言者 id」，明确不是角色 | 同左 | 同左 |
| icqq README 的 `master`「必填」 | 文档修正 | — | — |

#### 4.5 回滚

- 第 2 阶段（人模型）引入的 `chat_roles.principal_id` 与新表只**新增**；`adapter` / `user_id` 双写一个版本，降级到旧版本时旧代码按旧列读取，行为与升级前一致（归并信息丢失但角色不丢）。
- 提供 `zhin chat-roles export` / `import`（JSON，含人、身份、绑定、链接），升级前自动导出到 `.zhin/backups/chat-roles-<时间>.json`。
- 迁移记录 v2 降级时旧代码读不懂会报 malformed（`chat-role-migration.ts:173-175`）：升级时保留 `chat-roles-migration.json` v1 原文为 `.v1.json`，回滚文档（`docs/migrations/chat-roles.md`）写明换回（P1 已实施）。P1 只新增记录字段与「需要你处理」类型，不改 `chat_roles` 表结构。

### 5. 安全考量

#### 5.1 导入不能提权

- 种子导入只在**首次**自动生效；之后一律经 Console 全局 `iam.manage` 确认（§4.2）。
- 配置里的 `master` 视为「部署者声明」，可信度等同于写配置的人；因此它导入为**账号层** owner（与 ADR 0056 一致），不自动成为全局 owner；提升只经 Console 全局 `iam.manage` 确认（决定 Q1）。
- `personalPrincipals` 不导入任何角色。
- 认领码只在「尚无全局 owner」时可用，且只输出到日志 / 本地 CLI（持有者已能读宿主文件），不进入聊天、不进入 Console 前端。

#### 5.2 绑定与归并

- 自助绑定必须由**该平台身份本人**在**私聊**中提交绑定码（证明控制权）；群聊中提交会被拒绝并撤回提示（防围观者截码），绑定码只显示给发起的 Console 用户。
- 归并会扩大一个人的有效身份集合，但不扩大任何作用范围的角色：低于全局的绑定只在本适配器生效（§2.3）。全局绑定的人被归并进新身份后，新身份即获得全局角色——因此归并一个持有全局 `owner` 的人需要全局 `iam.manage`，与授予 owner 同门槛（ADR 0056 §3）。
- 未经证明的 `manual` 归并在 Console 标注「未验证」，并在审计中记录。

#### 5.3 平台群主的边界

- 维持 ADR 0056 §4：平台群主 / 管理员不映射为 zhin 角色。
- 但拒绝提示要能区分「你是群主但没有 zhin 角色」：拒绝文案读 `sender.platform.standing`，提示「zhin 功能需要 zhin 角色；请联系本机器人的主人授予，或由主人在 Console『聊天角色』页授予」。平台操作类命令仍按 `platform:*` / `bot:*` 判断，不受影响。

#### 5.4 Sandbox 映射：只映射已链接的 Console 用户

- Sandbox 发言时，服务端以连接上的 Console 主体为准：若该 Console 用户已链接到某人，且该人在 sandbox 适配器上有身份，则**默认**以该身份发言，角色按该人的绑定解析（包括全局 owner → 在 sandbox 里就是 owner）。
- 客户端自填的 `senderId` 仍可用于模拟「别人」，但这类发言**一律不解析 zhin 角色**（视为隐式陌生人，`chatRole` 为空），界面明确标注「模拟身份，无角色」。否则任何持有 `endpoint.operate` 的 Console 用户都能填 owner 的 id 冒充 owner。
- 平台身份预设改名：「Master」→「群主（平台身份）」，徽章同时显示服务端回报的 zhin 角色与信任档位，消除 MASTER / `group_member` 的错位。
- 仅限本机 / 开发？不需要额外限制：映射依赖 Console 认证与链接，与部署形态无关；但 `--standalone`（无网关，ADR 0054）下没有 Console 主体，sandbox 一律按「模拟身份，无角色」处理。

#### 5.5 审计

- 新增审计动作（instance 侧，经现有审计通道写入网关审计日志）：`chat-principals.merge|split|rename`、`chat-identities.bind`（含 `link_method`）、`chat-principals.link-console|unlink-console`、`chat-roles.import`（含来源路径）、`chat-roles.claim`。
- 绑定码、认领码不入日志正文，只记其哈希前 8 位。

### 6. 公共 API 草案

从 `zhin.js`（经 `@zhin.js/core`）导出：

```ts
// 判断当前消息的发言者（纯函数，读 Runtime 写入的 sender 事实；不查库）
export function isOwner(
  sender: SenderRoleFacts | null | undefined,
  options?: { readonly level?: ChatRoleLevel }, // 默认 'global'：宿主主人
): boolean;
export function hasChatRole(
  sender: SenderRoleFacts | null | undefined,
  role: ChatRole,
  options?: { readonly level?: ChatRoleLevel }, // 默认 'conversation'：本会话链上
): boolean; // = chatRoleHeldAt 的别名，保留 chatRoleHeldAt

// 不在消息上下文中（定时任务、Webhook、通知）读取聊天角色
export const chatRolesToken: Token<ChatRoleReader>;

export interface ChatRoleReader {
  /** 某平台身份在某作用范围链上的有效角色。 */
  roleOf(identity: ChatIdentity, scope?: ChatScopeRef): ChatRole | undefined;
  /** 某平台身份所属的人（无显式归属时返回隐式单身份人视图）。 */
  principalOf(identity: ChatIdentity): ChatPrincipalView;
  /** 持有某角色的人及其身份（用于「通知主人」）；默认全局层。 */
  holders(role: ChatRole, options?: { readonly level?: ChatRoleLevel; readonly scope?: ChatScopeRef; readonly adapter?: string }): readonly ChatPrincipalView[];
  /** 角色或归属变化（授予、撤销、归并、拆分）。 */
  subscribe(listener: (change: ChatRoleChange) => void): () => void;
}

export interface ChatPrincipalView {
  readonly id: string;
  readonly displayName?: string;
  readonly identities: readonly ChatIdentity[];
}

export type ChatScopeRef =
  | { readonly level: 'global' }
  | { readonly level: 'adapter'; readonly adapter: string }
  | { readonly level: 'endpoint'; readonly adapter: string; readonly endpointId: string }
  | { readonly level: 'conversation'; readonly conversation: ConversationRef };
```

- `ChatRoleReader` 只读；写入仍只经 Console RPC 与聊天命令（带门槛与审计）。插件是受信任代码（ADR 0059 §1 威胁模型），可读全部持有者。
- 命令 / 工具的声明式写法不变（`permit: ['owner@global']` 等，ADR 0056 §5），文档把它列为首选，`isOwner` 用于代码分支。
- 插件作者指南新增「不要自建 masters」一节与改写对照；`check:plugin` 增加提示性检查：插件配置 Schema 中出现 `masters` / `admins` / `owners` 字段时告警（不失败）。

### 7. Console 改动清单

（Console 前端在 `zhinjs/console`，协议与 RPC 在本仓库；每个新 RPC 都登记到 `CONSOLE_RPC_PERMISSIONS`，ADR 0049。）

| 项 | 内容 | 权限 |
| --- | --- | --- |
| 授予对话框 | 适配器改下拉（来自 `endpoint.list` 的别名）；用户改选择器：本作用范围最近发言人（`chat_identities.last_seen_at`）、成员列表（适配器实现 `listGroupMembers` 时，`packages/im/adapter/src/endpoint-management.ts:137`）、已有的人；保留手填作为「高级」 | `iam.manage`（作用域同 ADR 0056） |
| 新 RPC `chat-identities.recent` | 某作用范围最近发言的身份（含显示名缓存） | `iam.manage`（作用域内） |
| 新页面「聊天成员」 | 人列表、每人的平台身份、角色绑定（含继承来源）、链接的 Console 用户；归并 / 拆分 / 改名 | 读 `iam.manage`；归并持有全局角色的人需全局 `iam.manage` |
| 新 RPC `chat-principals.list|get|merge|split|rename|link-console|unlink-console` | 同上 | 同上 |
| 「把聊天身份绑定到我」 | 用户菜单与 Sandbox 页入口；`chat-identities.bind-code.create` 生成绑定码、显示倒计时与「已绑定」回执 | 任何已登录用户（新权限 `self.chat-identity`，内置角色默认含；见 Q4） |
| 「我的聊天身份」 | 显示链接的人、身份与角色 | 同上（只读自己） |
| 「需要你处理」新增类型 | `chat-roles.no-owner`（警告）、`chat-roles.imported`（信息）、`chat-roles.import-pending`（警告） | `iam.manage` 可见 |
| 新 RPC `chat-roles.imports.list` / `chat-roles.imports.resolve`（P1） | 读迁移记录中首次导入的条目与待确认候选；逐条「导入」（`import`）/「忽略」（`ignore`）待确认候选，或确认已读首次导入（`acknowledge`）。导入沿用首次导入规则（只升不降、模拟适配器上不授全局），每条写审计 `chat-roles.import` | 全局 `iam.manage` |
| Sandbox 页 | 默认「以我的聊天身份发言」；自填 id 标「模拟身份，无角色」；徽章显示服务端回报的 zhin 角色与信任档位；预设改名 | `endpoint.operate`（不变） |
| 个人推理配置页 | 主体来自链接，不再依赖 `ai.personalPrincipals`；恢复 Console 中切换到个人推理主体（`docs/migrations/console-access-control.md:72` 中暂停的能力） | `agent.configure` 或本人 |

聊天侧：拒绝文案补去向（§5.3）；新增 `绑定 <码>`、`认领 <码>`；`角色 授予` 的 `<用户>` 支持 `@提及` 之外的「人」引用（`#<人 id 前 6 位>`），以便对多平台同一人授予全局角色。

### 8. 分阶段实施

所有包默认只发 patch（`.changeset/version-policy.json`）；需要 minor 的阶段已获所有者批准（决定 Q6），由所有者写入 `approvedNonPatchReleases`。

| 阶段 | 内容 | 版本级别 |
| --- | --- | --- |
| P0 文案与文档 | 拒绝文案指向 Console / 认领（§5.3）；sandbox 预设改名、徽章显示服务端角色；icqq README 去掉 `master` 必填；概念文档写清「五处名单」现状与迁移方向 | patch（core、zhin.js、sandbox、icqq 文档） |
| P1 引导与种子 | `chat-roles.no-owner` / `imported` / `import-pending` 三类「需要你处理」；认领码；「再次出现」改为待确认导入（取消启动失败）；`isOwner` / `hasChatRole` / `chatRolesToken` | minor：`@zhin.js/core`、`zhin.js`、`@zhin.js/console-protocol`（新增公共 API 与协议类型）；其余 patch |
| P2 人模型 | `chat_principals` / `chat_identities` / `chat_principal_console_links`；`chat_roles.principal_id` 与双写；`chat-principals.*` / `chat-identities.*` RPC；链接表缓存 Console 显示名（Q12）；绑定码；`sender.chatPrincipal`；导出 / 导入 CLI | minor：`@zhin.js/core`、`zhin.js`、`@zhin.js/console-protocol`、`@zhin.js/cli`；`@zhin.js/gateway` patch（用户删除时通知实例） |
| P3 Console 与 personalPrincipals | 授予对话框选择器、授予记录显示链接的人名（Q12）、「聊天成员」页、绑定到我、Sandbox 以我发言；`personalPrincipals` 导入并改读链接表；Agent 侧 `HostInference` 改为按链接解析 | minor：`@zhin.js/agent`（个人推理主体来源变更）；Console 前端随其仓库发布；其余 patch |
| P4 清理 | 删除 `chat_roles.adapter/user_id` 双写列；`ai.personalPrincipals` 从 schema 移除（出现告警忽略）；`check:plugin` 的 `masters` 提示 | patch（行为只告警不失败）；若所有者认为 schema 删除属破坏性则 minor |

## 备选方案及否决理由

### A. 以 Console 账号为唯一事实来源，聊天身份挂在 Console 用户下

否决：大多数聊天中的管理员没有、也不该有 Console 账号；Console 账号在 gateway.db（ADR 0059），实例不能读，入站每条消息的鉴权会依赖网关；与 ADR 0049「Console 权限与聊天角色无关」相悖。

### B. 恢复配置文件为事实来源（`masters` 名单 + 数据库只做缓存）

否决：配置无法表达四级作用范围与多平台同一人；ADR 0056 / 0057 已确定「人员名单不放配置」；Console 与聊天都改不了配置中的名单，或者每次授予都要改 yml 与重启。

### C. 平台群主自动映射为会话 `admin`

否决（维持 ADR 0056 §4）：群主是平台概念，zhin 的 `admin` 可改功能配置；QQ 群主不等于机器人部署者信任的人。改为拒绝提示中给出去向。

### D. 不引入「人」，只在授予时一次授予多个平台身份

否决：撤销、展示、`personalPrincipals`、Console 链接都需要稳定的「人」标识；没有它，归并信息散落在多条授予里，撤销容易遗漏。

### E. 适配器 master 自动成为全局 owner

否决为默认：比 ADR 0056 的迁移语义宽，配置中每个账号的 master 都会获得 exec / 文件写；改为在「需要你处理」中一键提升（Q1）。

## 决定（2026-11-14，所有者按推荐定案）

原「未决问题」Q1–Q11 逐条按推荐结论定案；Q12 为定案时所有者补充的决定。正文已与这些结论对齐。

| # | 问题 | 决定 |
| --- | --- | --- |
| Q1 | 适配器 `master` / `owner` 首次导入为账号层还是全局 `owner`？ | **账号层**（维持 ADR 0056）。没有全局 owner 时，`chat-roles.imported` 项提示可「提升为全局 owner」（即对同一身份调用全局 `chat-roles.grant`，需全局 `iam.manage`），不自动提升。 |
| Q2 | `ai.personalPrincipals` 导入时是否同时授予 owner？ | **不授予**：该字段只表达推理配置归属。若被链接的 Console 用户本身是全局 Console 所有者，`chat-roles.imported` 项提示「是否同时设为全局 owner」，由人确认（P3）。 |
| Q3 | 一个 Console 用户能否链接多个人 / 一个人能否链接多个 Console 用户？ | **都不允许**（一对一）。多平台归在同一个人下解决「多身份」；共享账号场景用多个 Console 用户。 |
| Q4 | 自助绑定所需的 Console 权限 | 新增 `self.chat-identity`，所有内置角色（含 `viewer`）默认带；只能操作自己的链接（P2 / P3）。 |
| Q5 | 配置中人员字段「再次出现」：待确认导入还是维持启动失败？ | **待确认导入**（§4.2），与 ADR 0057 种子一致；不再启动失败。 |
| Q6 | P1–P3 的 minor 是否批准？ | **批准** `@zhin.js/core`、`zhin.js`、`@zhin.js/console-protocol`（P1、P2）、`@zhin.js/cli`（P2）、`@zhin.js/agent`（P3）；每阶段单独记入 `.changeset/version-policy.json` 的 `approvedNonPatchReleases`（由所有者统一写入）。 |
| Q7 | 认领码（无 Console 的第一位 owner）是否要做？ | **做**（P1），只在尚无全局 owner 时有效，只打印到实例日志与 `zhin status`；`--standalone` 同样可用。 |
| Q8 | 群聊中能否发起 `绑定` / `认领`？ | **不能**，只接受私聊；在群聊中提交正确的码会使该码立即作废并轮换（防围观者截码）。平台没有私聊（能力画像无私聊会话）时只能走 Console 授予 / 运营者代绑。 |
| Q9 | `personalSessionOwnerId` 含 `rootId`，是否在本 ADR 内改为稳定的项目 id？ | **另开 ADR**：本 ADR 只保证链接不再因 `rootId` 失效；个人数据 owner id 稳定化涉及凭据库与会话键迁移。 |
| Q10 | 低于全局的绑定是否应对同一人的其他平台身份生效？ | **不生效**（§2.3）：作用范围本身就绑定在一个适配器上；跨平台只有全局层。 |
| Q11 | `chat_identities.last_seen_at` / 显示名缓存的保留期 | 记录最近 90 天，超过清空显示名；只在 `iam.manage` 作用域内可见（P2）。 |
| Q12 | 角色授予记录中「其他 Console 用户」的显示名（反馈 `console-role-grantor-hash`：`grantedBy` 为 `console:user:<id>` 时只能显示 id） | **不单独改网关 IAM**，也不让实例读 gateway.db：由「人 ↔ Console 账号」链接（§2.4）提供显示名——建立链接时在 `chat_principal_console_links` 缓存该 Console 用户的 `displayName`（网关转发的主体自带），该用户之后再以本人身份调用实例时刷新；授予记录的 `grantedBy` 若是已链接的 Console 用户，显示链接的人名（`display_name`，无则缓存的 Console 显示名）。未链接的 Console 用户仍显示 id。随 P2（链接表加列）/ P3（Console 显示）实施。 |

### 实施中补充的约定（P0 / P1）

- **再次出现的字段先记后删**：待确认导入的候选先写入迁移记录（`pendingImports`），再按首次导入相同的「先记后改」从配置文件移除这些字段。原因：适配器配置 Schema 不接受 `master` / `trusted`（`additionalProperties: false`），字段留在文件里会让插件校验失败；值已保存在记录里，「导入」/「忽略」只作用于记录与数据库，不再改 yml。`roles` 映射规则与 `features.selfService.*` 旧开关仍然启动失败。
- **认领码的本地出口**：`zhin status` 不经网关读取实例内存，而是读实例写入的 `.zhin/chat-owner-claim.json`（文件权限 0600，仅含码、实例 pid 与时间；有全局 owner、认领成功或实例退出时删除）。状态输出只在该文件属于正在运行的实例时（pid 与网关报告的实例 pid 一致，或写于该实例启动之后）显示该码。
- **认领防暴力尝试**：同一个码累计 5 次错误后作废并轮换（新码只进日志与本地文件）。
- **`ChatRoleReader.factsOf`**：在 §6 草案之外增加 `factsOf(conversation, userId)`，返回 Runtime 为该发言者写入 `sender` 的同一组事实（身份、`chatRole`、`chatRoleLevels`），供不在消息上下文中的插件（以及 Sandbox 徽章）复用同一解析；P1 中人视图一律是隐式单身份人（`principalOf` 的 `id` 为 `implicit:<alias>:<userId>`，P2 引入 `cp_` id 后显式人的 id 以表为准）。

### 实施中补充的约定（P2）

- **`chat_roles` 的列与行 id**：`principal_id` 以**可空**列追加（`addColumns`，已有表原地加列；旧版本降级后仍能插入行），加载时为没有 `principal_id`（或指向不存在的人）的行建隐式单身份人并回填——这就是幂等迁移；逻辑主键 `(level, scope_key, principal_id)` 由存储层保证（同一人同一作用范围两行时保留较高者并删除另一行）。行 id 仍是 `sha256(level, scope_key, adapter, user_id)`（双写身份），旧版本因此能按自己的算法读取与撤销同一行；拆分等改变双写身份的操作同时改写行 id。首次迁移前把全部旧行导出到 `.zhin/backups/chat-roles-<时间>.json`。
- **`chat_identities` 也是发言缓存**：`principal_id` 可空（NULL = 隐式单身份人）。为了「最近发言人」选择器，入站发言者会写一行（同一身份同名同范围 10 分钟内不重复写），另存 `last_scope_key`（最近一次发言的会话键，`chat-identities.recent` 按作用范围筛选用）。90 天未发言：无人归属的行删除，有人归属的行清空显示名与范围缓存。「人」仍只在首次授予 / 绑定 / 归并时建行。
- **自助绑定的边界**：身份已属于链接了其他 Console 用户、或有多个身份的人时拒绝（改由运营者归并）；绑定会把角色带到另一个身份上（被绑定身份的人有授予，或 Console 用户的人有对该身份生效的授予）时，只有在生成绑定码时持有全局 `iam.manage` 的用户可以完成，防止把 owner 的人「钓」到别人身份上。同一身份 10 分钟内错 5 次锁定到窗口结束。模拟适配器不接受绑定（与认领一致）。
- **拆分**：被拆出的身份得到新的人；原人的全局授予留下；原人在该身份所属适配器上的低于全局的授予，若原人在该适配器上已无其他身份则随身份迁走（否则无人可用）。
- **配置种子同一人**：首次导入时，`ai.trigger.*` 中同一个 id 在多个适配器上的身份归并为同一人（只归并「只有这个身份、未链接」的人，不把已有的人并掉；审计为 `link_method: import` 的 `chat-principals.merge`）。
- **网关通知**：沿用既有的 `principal-revoked`（`reason` 为 `deleted` / `disabled` 时实例删除链接，`password` / `bindings` 不删）；网关在实例未就绪时暂存这两类原因，实例下一次报告路由表时补发（内存中，网关重启即忘；网关重启期间删除的用户留下的链接只是显示缓存，不传递权限）。
- **导出 / 导入**：经运行中实例的 Console RPC `chat-principals.export` / `chat-principals.import`（全局 `iam.manage`；本地网关套接字下 CLI 以本地 owner 身份调用）。导入时角色绑定到身份**当前**所属的人，不按文件里的人 id 改挂；已属于他人的身份跳过。
- **授予者显示名（Q12）**：`chat-roles.list` 等返回的条目新增 `grantedByName`（`grantedBy` 为 `user:<id>` / `console:user:<id>` 且已链接时）与 `principalId`。Console 显示属 P3。
- 新 RPC 之外还加了 `chat-identities.me`（`self.chat-identity`：自己的链接、身份、角色与未用的绑定码到期时间；无全局 owner 且调用者持有全局 `iam.manage` 时返回 `suggestGlobalOwner`，供 §3.1 的「设为全局 owner」流程）。

### 实施中补充的约定（P3）

- **模拟发送者的保留 id**：Sandbox 把客户端自填的发送者 id 写成 `~sim:<id>`；核心把**所有以 `~` 开头的发送者 id** 视为「不是聊天身份」（`isChatIdentity` 为 false，`ChatRoleService.heldBy` 返回空），因此无论 `entriesFor`、`hasRole` 还是宿主全局判断（`senderIsGlobalOwner`）都解析不出角色，授予 / 绑定 / 导入也无法写入这样的身份，最近发言人也不记录。选这种「id 命名空间」而不是在 sender 上加标记，是因为现有的宿主全局判断直接按 `sender.id` 查库，命名空间一次覆盖全部路径。
- **Sandbox 上「我的聊天身份」从哪来**：绑定码在模拟适配器上不接受，所以新增 `chat-identities.simulated.ensure`（`self.chat-identity`）：为调用者的人在每个已加载的模拟适配器上建立身份 `console-<Console 用户 id>`（`link_method: console`）；调用者还没有人时新建并链接（`linked_via: console`）。Console 认证本身就是控制权证明；只作用于能力画像 `runtime.sandbox` 的适配器，真实平台仍只能用绑定码或运营者归并。`ChatRoleReader.consoleSpeaker(conversation, consoleUserId)` 返回该人在会话所属适配器上的身份；Sandbox 只在客户端请求 `asMe` 且连接上是已登录 Console 用户（`user` / `api-token`）时使用它，否则按模拟身份并在回显中给出 `asMeUnavailable`。
- **`ai.personalPrincipals` 的导入记录**：单独的 `.zhin/personal-principals-import.json`（不改 v2 角色迁移记录）；条目按 `(配置键, adapterId, subjectId)` 幂等，`pending`（适配器未加载）下次启动重试，`imported` / `skipped` 不再处理，配置中仍出现时只告警「已导入，数据库为准」。导入时 Console 用户已链接则身份归入已链接的人；未链接则取第一个尚未链接的已有人或新建，再链接（`import`）；身份已属于他人时跳过并告警。个人推理主体按链接的人的身份 × 该适配器的每个账号计算，`rootId` 用当前目录。
- **个人推理主体切换**：推理管理 HTTP 仍以 `agent.configure` 门禁（未放宽到「本人」）；`full` 范围下请求 `?owner=` 只接受调用者自己链接的人的个人主体。
- **Q2 提示只给本人**：`chat-roles.imported` 只在「需要你处理」的查看者正是被 `ai.personalPrincipals` 链接的 Console 用户、且尚无全局 owner 时提示「是否同时设为全局 owner」（实例看不到网关里其他用户是否是 Console 所有者）；确认走既有的全局 `chat-roles.grant`（全局 `iam.manage`，审计 `chat-roles.grant`）。

## 落盘位置（计划）

- 模型与解析：`packages/im/core/src/built/roles.ts`（`ChatRoleService` 按人解析、`ChatRoleReader`、`isOwner` / `hasChatRole`）
- 存储与迁移：`packages/im/zhin/src/instance/chat-roles.ts`、`chat-role-migration.ts`（v2 记录、种子再次出现）、新增 `chat-principals.ts`
- Console RPC：`packages/im/zhin/src/instance/console/chat-roles-rpc.ts`、新增 `chat-principals-rpc.ts`；协议：`packages/console/protocol/src/chat-roles.ts`、`attention.ts`、`permissions.ts`
- 聊天命令：`packages/im/zhin/src/instance/feature-self-service.ts`（拒绝文案、`绑定` / `认领`）
- Sandbox：`plugins/adapters/sandbox/src/endpoint.ts`、`pages/index/SandboxChat.tsx`
- 个人推理：`packages/im/zhin/src/instance/start-command.ts`（`personalPrincipals` 读取改为链接表）、`packages/im/agent/src/plugin-runtime/inference/principal.ts`
- 文档：`docs/concepts/chat-roles.md`、`docs/migrations/chat-roles.md`、`plugins/adapters/icqq/README.md`

## 后果

- 「谁是管理员」只有一个答案（聊天角色），并且能回答「这几个平台账号是同一个人」「这个 Console 用户是聊天里的谁」。
- 新部署有明确的第一位 owner 路径，拒绝提示告诉用户去哪里授予。
- Console 会话页的身份与 Agent trace 一致；模拟身份不再能冒充 owner。
- 代价：多三张实例表与一组 RPC；`chat_roles` 主键变更需要一次带双写的迁移；`personalPrincipals` 有一个版本的过渡期。
