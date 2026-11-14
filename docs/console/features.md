---
title: 功能与分层配置
description: Console 对象页的「功能」与「角色」页签：在全局、适配器、账号、会话四个层级上启用 / 禁用功能并覆盖配置，继承与锁定规则，功能矩阵，群内自助、聊天角色，以及对应的权限
---

# 功能与分层配置

同一个功能在不同平台、不同账号、不同群上常常要有不同设置：某个 QQ 账号不开 RSS，某个 Telegram 账号每次只推 1 条，某个群把复读阈值调高。Console 按对象树的四个层级管理，每一级对象页都有「功能」页签（[ADR 0050](../adr/0050-layered-feature-config.md)、[ADR 0055](../adr/0055-conversation-feature-config.md)）：

| 层级 | 键 | 存在哪里 |
| --- | --- | --- |
| 全局 | — | 配置文件里插件自己的配置块；全局启停是 `disable_plugins` |
| 适配器 | 适配器实例别名（配置里的顶层键，如 `qq`、`tg-main`） | 项目数据库表 `feature_overrides`（`level = 'adapter'`） |
| 账号 | `<别名>/<endpointId>`，如 `qq/bot-1` | 同上（`level = 'endpoint'`） |
| 会话 | `<别名>/<endpointId>/<kind>:<会话 id>`，如 `qq/bot-1/group:123`（`kind` 为 `group` / `private` / `channel`） | 同上（`level = 'conversation'`） |

全局默认值写在配置文件里，随代码评审；适配器、账号、会话三级是运行中由 Console 或聊天命令改的状态，存在项目数据库里（[ADR 0057](../adr/0057-config-storage.md)）：备份数据库即备份这部分配置。配置文件的插件块里不再接受 `overrides`；旧项目首次启动时自动导入，见[升级：功能覆盖迁入数据库](../migrations/feature-overrides.md)。会话 id 写进键时把 `%` 转义为 `%25`、`/` 转义为 `%2F`，其余字符原样。

数据库是 MongoDB、Redis 或内存方言时，这三级覆盖无法保存：`feature.get` / `feature.conversations` 返回 `persistent: false`，写入被拒绝（HTTP 503，`code: 'feature-overrides-unpersisted'`，聊天里回复「未保存：功能覆盖需要关系型项目数据库……」），与[聊天角色](../concepts/chat-roles.md)相同。

## 在哪里改 {#pages}

功能设置不再有单独的「适配器」「账号配置」页面，而是放在[对象树](./index.md#navigation)每一级对象页的「功能」页签里：

| 位置 | 路由 | 能做什么 | 读 / 写权限 |
| --- | --- | --- | --- |
| 全局「功能」页签 | `/scope?tab=features` | 全部功能的总览：可设置层级、全局开关、下级另有设置的数量；「矩阵」视图（`&view=matrix`）显示每个功能在全局与各适配器的开关。点功能名打开它的全局配置 | `feature.view` / 全局开关 `plugin.manage` |
| 适配器「功能」页签 | `/scope/:adapter?tab=features` | 作用于该适配器下所有账号与会话 | `feature.view` / `feature.configure`、`feature.toggle` |
| 账号「功能」页签 | `/scope/:adapter/:endpoint?tab=features` | 只作用于该账号及其会话 | 同上 |
| 会话「功能」页签 | `/scope/:adapter/:endpoint/:conversation?tab=features` | 只作用于这个会话；只能改插件声明为会话可改的字段 | 同上 |
| 功能矩阵 | `/features` | 与全局「功能」页签的矩阵视图相同的独立入口 | `feature.view` / 全局列 `plugin.manage`，适配器列 `feature.toggle` |
| 全局配置 | `/features/global/:plugin` | 插件的全局配置（Schema 表单） | `feature.view` / `feature.configure` |
| 插件详情「在哪开了」 | `/plugins/:name` | 只汇总：全局与各适配器的开关、有几个会话单独覆盖（账号层的开关在各账号的「功能」页签），链到对应的「功能」页签 | `plugin.manage` |

适配器、账号、会话三级「功能」页签的写法相同：

- 每个插件一行：有效状态（启用 / 已关闭 / 已锁定）、来源层级、本层覆盖了几项。可按「全部」「本层有覆盖」「已关闭」「已锁定」筛选，也可以搜索。
- 展开一行，逐字段显示**继承值 / 本层覆盖 / 有效值 / 来源**。编辑一个字段就创建本层覆盖；「移除覆盖」让它改回继承上级的值，「全部移除」删除这一层对该插件的全部覆盖。
- 开关、覆盖与移除都先「预览修改」，再在[操作回执](./index.md#receipts)里确认；关掉开关时会提示「关闭后，这一层以下的范围都不能再打开它」。
- 被上级关掉的插件显示「被 … 锁定」，附锁定层级的链接；这一层不能打开它，也不能改它的开关。
- 只支持全局配置的功能不会出现在下级页签里，它们在全局「功能」页签。Host 不支持按层级配置时，页签说明需要新版 Host，并沿用上级配置。

账号「概览」列出有覆盖的会话与最近活跃的会话；会话「概览」列出这个会话单独改过的功能。

## 功能矩阵 {#matrix}

行是功能，列是「全局」加每个适配器实例。每格是三态开关：

- **启用**；
- **禁用**；
- **被上级禁用并锁定**——鼠标悬停显示「已在全局禁用」「已在适配器禁用」或「已在账号禁用」，附跳转链接。

有覆盖的格子带标记；有会话层覆盖的账号显示会话数（`feature.matrix` 的 `conversationOverrides`）。点功能名进全局配置，点适配器名进它的「功能」页签。全局开关是插件启停：由管理网关作为事务执行（停止实例 → 写入 `disable_plugins` → 启动实例，启动失败则恢复配置并启动原实例），需要 `plugin.manage`，确认框会提示实例将重启。数据来自 `feature.matrix`。

## 继承规则 {#resolution}

**启用：上级优先，逐级单向。**

```text
有效启用 = 不在 disable_plugins 里
         且 适配器覆盖.enabled 不是 false
         且 账号覆盖.enabled 不是 false
         且 会话覆盖.enabled 不是 false
```

- 只有上面所有层级都启用时，某一层才可以停用。
- 任一上级（全局 / 适配器 / 账号）停用后，其下所有层级锁定：不能启用，也不能改自己的开关，界面显示「已被〈层级〉停用」。接口返回 HTTP 409 `{ success: false, code: 'locked', lockedBy, error: '已被{全局|适配器|账号}层停用，下级开关已锁定' }`。
- 下级永远不存「启用」：在下级启用就是删除该层的开关。上级之后才停用时，下级先前存的停用保留（「移除覆盖」也保留它）。

**其他字段：下级优先。** 有效配置 = 全局 → 适配器覆盖 → 账号覆盖 → 会话覆盖 依次深合并：普通对象逐键合并，数组与标量整体替换，`null` 表示「显式清空」而不是「继承」。

每个字段旁显示来源徽标：「继承自全局」「继承自适配器」「在此覆盖」。编辑一个继承来的字段就创建覆盖；覆盖字段旁有「移除覆盖」，回到继承。

- 插件没有声明支持适配器 / 账号层时（Schema 根上的 `x-zhin-config.levels` 省略即只有全局），它不出现在适配器与账号页面里。所有官方插件（适配器除外）都声明了全部四级，至少能在每一层开关；只适合全局的字段在属性上收窄为 `levels: ["global"]`（仓库测试 `tests/contracts/plugin-feature-levels.test.ts` 保证这一点）。
- 会话层只能改插件在 `x-zhin-config.conversationFields` 列出的字段；没列出时会话层只有开关。
- 只支持全局的字段（如数据库连接、API 密钥）在下级表单里只读显示。
- 没有配置 Schema 的插件只有三级启停开关，没有字段覆盖。
- 机密字段的值以掩码返回。

## 生效方式 {#apply}

| 改了什么 | 怎么生效 |
| --- | --- |
| 适配器 / 账号 / 会话层覆盖与启停（数据库） | 原地生效：不重启、不重载插件，下一条消息读到新值。多个实例共用一个数据库时，其他实例最多 5 秒后读到 |
| 全局字段 | 按字段声明的 `x-zhin-config.effect` |
| 全局启停（`disable_plugins`） | 网关启停事务：停止实例、写入、启动，失败回滚（Console 不中断） |

功能在某个账号或会话上被禁用时，Runtime 在分发处按消息所在会话直接跳过：命令不匹配（也不回复「已禁用」）、中间件与处理器不执行、Agent 工具在该会话里不可见也调不到。定时任务等不经过消息的能力由插件自己用 `isEnabledFor` 判断。

## 接口与权限 {#rpc}

| RPC | 权限 | 说明 |
| --- | --- | --- |
| `feature.list` | `feature.view` | 全部功能与支持的层级 |
| `feature.matrix` | `feature.view` | 矩阵数据 |
| `feature.get` | `feature.view` | 某层级的 Schema、值、有效值与来源；全局层的 `revision` 是配置文件修订号，适配器 / 账号 / 会话层是数据库里该条覆盖的修订号（没有时为 `'0'`） |
| `feature.set-override` | `feature.configure` | 写入覆盖（合并补丁） |
| `feature.remove-override` | `feature.configure` | 删除整层或指定字段 |
| `feature.set-enabled` | `feature.toggle`；全局层 `plugin.manage` | 全局层写 `disable_plugins`（由网关拦截并作为启停事务执行，见下）；适配器 / 账号 / 会话层写数据库；被锁定时 409 |
| `plugin:set-enabled` | `plugin.manage` | `{ instanceKey, enabled }`：与全局层 `feature.set-enabled` 相同的网关启停事务 |
| `feature.conversations` | `feature.view` | `{ plugin?, adapter?, endpoint?, query?, cursor?, limit? }`：有覆盖的会话（分页），以及实例近期见过的会话（`hasOverrides: false`） |
| `chat-roles.list` / `grant` / `revoke` | `iam.manage` | 聊天角色（见下） |

**全局开关**（全局层 `feature.set-enabled` 与 `plugin:set-enabled`）是插件生命周期，不是功能开关：管理网关在转发给实例前拦截它们，按 `plugin.manage` 授权（只有 `feature.toggle` 的运营会被拒绝；非所有者只能启停可管理目录内的包，项目本地插件只限所有者），执行 `gateway.plugins.enable` / `disable` 同一笔事务，并用原有的回复形状作答（多带 `transaction`；`restartRequired: true` 表示实例已为此重启）。已是目标状态时回复 `unchanged`，实例不动。事务失败或已回滚时回复 `{ success: false, code: 'transaction_failed' | 'rollback_failed', error, transaction }`。成功变更后事件流会收到 `plugin:lifecycle-updated`。实例自身不再写全局开关：没有网关时（`zhin start --standalone`）全局开关被拒绝（`feature.set-enabled` 为 409 `gateway-required`），请改用 `zhin enable` / `zhin disable <插件>` 或在 `zhin start` 下操作。

`feature.configure`、`feature.toggle` 与 `iam.manage`（仅 `chat-roles.*`）按作用域检查：绑定到适配器 `qq` 的运营只能改 `qq` 及其账号、会话上的覆盖与角色，不能改全局或别的适配器；会话键按它所属的账号计。适配器 / 账号 / 会话层的写入带该条覆盖的修订号（`expectedRevision`），并发修改会被拒绝（`conflict`）而不是互相覆盖；为兼容旧版 Console，适配器 / 账号层仍接受 `feature.list` / `feature.matrix` 返回的配置文件修订号（与当前修订号相同时不做行级检查，不同时视为冲突）。

## 群内自助 {#self-service}

默认关闭。在配置里开启：

```yaml
features:
  selfService:
    enabled: true          # 注册「功能」「角色」聊天命令
```

功能开关是 zhin 的功能：平台群主 / 管理员不会自动成为本群的 `admin`，需要被授予（见[聊天角色](../concepts/chat-roles.md)）。

| 命令 | 说明 |
| --- | --- |
| `功能 列表 [页码]` / `feature list [page]` | 本会话适用的插件（有指令 / 中间件 / 事件处理器，不含适配器、纯服务插件和只针对其他平台的插件）的状态、来源层级与锁定信息（含「配置 enabled: false」与「全局停用」），以及你的角色；每页 15 项 |
| `功能 开启\|关闭 <插件> [层级]` | 层级：`会话`（默认）/ `账号` / `适配器` / `全局` |
| `功能 设置 <插件> <字段> <值> [层级]` | 只能改插件的 `selfServiceFields`（账号层及以上可由 `chatAdminFields` 放宽）；值是字段之后的剩余全部文本，含空格或以层级词结尾的值用引号包裹（`"…"`、`“…”`、`「…」` 等），如 `功能 设置 group-suite welcomeMessage "欢迎 {name}"` |
| `功能 重置 <插件> [层级]` | 删除该层的覆盖（被锁定时保留停用开关） |
| `功能 确认 <码>` | 全局开启 / 关闭会重启实例，必须在 2 分钟内确认 |

- 发送者必须在目标作用范围（当前会话在所选层级的祖先）拥有 `admin` 或 `owner` 聊天角色。
- 会话、账号、适配器层写数据库（原地生效）；全局开关由实例写 `disable_plugins` 并请求重启（与 Console 不同，暂不经网关事务、失败不回滚）。
- 私聊的会话层覆盖只能在 Console 修改。
- 每次修改都写入实例审计（actor `chat:<适配器别名>:<用户 id>`，带层级与作用范围）。

## 聊天角色 {#chat-roles}

聊天中的权限由 [ADR 0056](../adr/0056-chat-roles.md) 的角色决定：`owner` ⊃ `admin` ⊃ `trusted`，按「会话 → 账号 → 适配器 → 全局」向下继承，身份是 `(适配器别名, 用户 id)`。完整说明见[聊天角色](../concepts/chat-roles.md)。来源：

| 来源 | 说明 |
| --- | --- |
| 授予（`chat_roles` 表，`source: 'grant'`） | 对象页的「角色」页签或聊天命令 `角色 授予\|撤销 <用户> <角色> [层级]` / `role grant\|revoke …`；这是 zhin 角色的唯一来源 |

平台身份（发送者的群主 / 管理员 / 身份组 / 权限，以及机器人自身在群里的身份）不换算为 zhin 角色，只在 permit 的 `platform:*` / `bot:*` 条件中使用。

配置文件不再保存人员名单：旧的账号 `master` / `trusted` 与 `ai.trigger.masters` / `trusted` 在首次启动时迁入 `chat_roles`，见[升级到聊天角色](../migrations/chat-roles.md)。

在 Console 里，四个层级的对象页都有「角色」页签（需要 `iam.manage`，绑定到该适配器 / 账号的作用域角色也算）：列出在这一层有效的角色、在这一层授予的与从上级继承的，以及「授予角色」（填平台用户 ID，选所有者 / 管理员 / 受信任）。撤销只撤销在这一层直接授予的角色。全局角色可为每个平台登记一个身份；适配器以下各层的身份只能属于它自己的适配器。

聊天中授予角色时，授予者必须在目标作用范围拥有不低于被授予角色的角色；`owner` 只能由更高层的 `owner` 授予或撤销。`角色 列表` 显示本会话生效的角色与来源。

插件作者如何声明层级与会话层字段、读取有效配置（`context.configFor` / `context.isEnabledFor`）见 [definePlugin](../authoring/define-plugin.md#layered-config)、[ADR 0050](../adr/0050-layered-feature-config.md) 与 [ADR 0055](../adr/0055-conversation-feature-config.md)。
