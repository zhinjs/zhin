---
title: 功能矩阵与分层配置
description: Console「功能」区：在全局、适配器、账号、会话四个层级上启用 / 禁用功能并覆盖配置，继承与锁定规则，群内自助、聊天角色，以及对应的权限
---

# 功能矩阵与分层配置

同一个功能在不同平台、不同账号、不同群上常常要有不同设置：某个 QQ 账号不开 RSS，某个 Telegram 账号每次只推 1 条，某个群把复读阈值调高。Console「功能」区按四个层级管理（[ADR 0050](../adr/0050-layered-feature-config.md)、[ADR 0055](../adr/0055-conversation-feature-config.md)）：

| 层级 | 键 | 写在配置的哪里 |
| --- | --- | --- |
| 全局 | — | 插件自己的配置块；全局启停是 `disable_plugins` |
| 适配器 | 适配器实例别名（配置里的顶层键，如 `qq`、`tg-main`） | `overrides.adapters.<别名>` |
| 账号 | `<别名>/<endpointId>`，如 `qq/bot-1` | `overrides.endpoints."<别名>/<endpointId>"` |
| 会话 | `<别名>/<endpointId>/<kind>:<会话 id>`，如 `qq/bot-1/group:123`（`kind` 为 `group` / `private` / `channel`） | 项目数据库表 `feature_conversation_overrides`（不在配置文件里） |

```yaml
rss:
  maxItems: 5
  overrides:
    adapters:
      qq: { enabled: false }
    endpoints:
      "tg-main/news": { maxItems: 1 }
```

`overrides` 是普通 YAML，手改与在 Console 里改等价。会话层数量可能成百上千，存在项目数据库里：备份数据库即备份这部分配置。会话 id 写进键时把 `%` 转义为 `%25`、`/` 转义为 `%2F`，其余字符原样。

## 页面 {#pages}

| 路由 | 页面 | 读 / 写权限 |
| --- | --- | --- |
| `/features` | 功能矩阵 | `feature.view` / `feature.toggle` |
| `/features/global/:plugin` | 全局配置（Schema 表单） | `feature.view` / `feature.configure` |
| `/features/adapters` | 适配器列表：别名、类型、账号数、在线数 | `feature.view` |
| `/features/adapters/:adapter` | 适配器页：该适配器下的功能覆盖 + 账号连接管理 | `feature.*`；账号增删改启停需要 `endpoint.manage` |
| `/features/adapters/:adapter/endpoints/:endpoint` | 账号配置：该账号的功能覆盖；「会话」标签搜索该账号下的会话，查看各插件在会话中的状态与来源、开关与改字段；「角色」区块管理聊天角色 | `feature.*`；角色需要 `iam.manage` |
| `/features/ai` | AI 与模型（模型路由、技能、Ambient、场所） | `agent.view` / `agent.configure` |

旧的插件详情配置页重定向到 `/features/global/:plugin`。「会话」区的账号工作区有一个「功能配置」入口，跳到对应的账号配置页。

## 功能矩阵 {#matrix}

行是功能，列是「全局」加每个适配器实例。每格是三态开关：

- **启用**；
- **禁用**；
- **被上级禁用并锁定**——鼠标悬停显示「已在 全局 / 适配器 qq 禁用」，附跳转链接。

有覆盖的格子带标记；有会话层覆盖的账号显示会话数（`feature.matrix` 的 `conversationOverrides`）。点功能名进全局配置，点格子进对应层级的配置页。数据来自 `feature.matrix`。

## 继承规则 {#resolution}

**启用：上级优先，逐级单向。**

```text
有效启用 = 不在 disable_plugins 里
         且 overrides.adapters[别名].enabled 不是 false
         且 overrides.endpoints[别名/id].enabled 不是 false
         且 会话覆盖.enabled 不是 false
```

- 只有上面所有层级都启用时，某一层才可以停用。
- 任一上级（全局 / 适配器 / 账号）停用后，其下所有层级锁定：不能启用，也不能改自己的开关，界面显示「已被〈层级〉停用」。接口返回 HTTP 409 `{ success: false, code: 'locked', lockedBy, error: '已被{全局|适配器|账号}层停用，下级开关已锁定' }`。
- 下级永远不存「启用」：在下级启用就是删除该层的开关。上级之后才停用时，下级先前存的停用保留（「移除覆盖」也保留它）。

**其他字段：下级优先。** 有效配置 = 全局 → 适配器覆盖 → 账号覆盖 → 会话覆盖 依次深合并：普通对象逐键合并，数组与标量整体替换，`null` 表示「显式清空」而不是「继承」。

每个字段旁显示来源徽标：「继承自全局」「继承自适配器」「在此覆盖」。编辑一个继承来的字段就创建覆盖；覆盖字段旁有「移除覆盖」，回到继承。

- 插件没有声明支持适配器 / 账号层时（Schema 根上的 `x-zhin-config.levels` 省略即只有全局），它不出现在适配器与账号页面里。
- 会话层只能改插件在 `x-zhin-config.conversationFields` 列出的字段；没列出时会话层只有开关。
- 只支持全局的字段（如数据库连接、API 密钥）在下级表单里只读显示。
- 没有配置 Schema 的插件只有三级启停开关，没有字段覆盖。
- 机密字段的值以掩码返回。

## 生效方式 {#apply}

| 改了什么 | 怎么生效 |
| --- | --- |
| 只改 `overrides`（含适配器 / 账号层的启停） | 原地生效：不重启、不重载插件，下一条消息读到新值 |
| 会话层覆盖（数据库） | 原地生效，同上 |
| 全局字段 | 按字段声明的 `x-zhin-config.effect` |
| 全局启停（`disable_plugins`） | 重启实例（网关负责，Console 不中断） |

功能在某个账号或会话上被禁用时，Runtime 在分发处按消息所在会话直接跳过：命令不匹配（也不回复「已禁用」）、中间件与处理器不执行、Agent 工具在该会话里不可见也调不到。定时任务等不经过消息的能力由插件自己用 `isEnabledFor` 判断。

## 接口与权限 {#rpc}

| RPC | 权限 | 说明 |
| --- | --- | --- |
| `feature.list` | `feature.view` | 全部功能与支持的层级 |
| `feature.matrix` | `feature.view` | 矩阵数据 |
| `feature.get` | `feature.view` | 某层级（含 `conversation`）的 Schema、值、有效值与来源；会话层的 `revision` 是该条覆盖的修订号 |
| `feature.set-override` | `feature.configure` | 写入覆盖（合并补丁） |
| `feature.remove-override` | `feature.configure` | 删除整层或指定字段 |
| `feature.set-enabled` | `feature.toggle` | 全局层写 `disable_plugins`；适配器 / 账号层写 `overrides.*.enabled`；会话层写数据库；被锁定时 409 |
| `feature.conversations` | `feature.view` | `{ plugin?, adapter?, endpoint?, query?, cursor?, limit? }`：有覆盖的会话（分页），以及实例近期见过的会话（`hasOverrides: false`） |
| `chat-roles.list` / `grant` / `revoke` | `iam.manage` | 聊天角色（见下） |
| `chat-roles.mappings` / `set-mappings` | `iam.manage` | 平台身份 → 聊天角色的映射规则：读取适配器 / 账号 / 会话层规则与合并结果；只能写会话层 |

`feature.configure`、`feature.toggle` 与 `iam.manage`（仅 `chat-roles.*`）按作用域检查：绑定到适配器 `qq` 的运营只能改 `qq` 及其账号、会话上的覆盖与角色，不能改全局或别的适配器；会话键按它所属的账号计。配置文件层的写入带配置修订号，会话层带该条覆盖的修订号，并发修改会被拒绝而不是互相覆盖。

## 群内自助 {#self-service}

默认关闭。在配置里开启：

```yaml
features:
  selfService:
    enabled: true          # 注册「功能」「角色」聊天命令
```

群主 / 管理员是否是本群的 `admin` 由映射规则决定（默认是，见[聊天角色](../concepts/chat-roles.md#mappings)）。

| 命令 | 说明 |
| --- | --- |
| `功能 列表` / `feature list` | 本会话各插件的状态、来源层级与锁定信息，以及你的角色 |
| `功能 开启\|关闭 <插件> [层级]` | 层级：`会话`（默认）/ `账号` / `适配器` / `全局` |
| `功能 设置 <插件> <字段> <值> [层级]` | 只能改插件的 `selfServiceFields`（账号层及以上可由 `chatAdminFields` 放宽） |
| `功能 重置 <插件> [层级]` | 删除该层的覆盖（被锁定时保留停用开关） |
| `功能 确认 <码>` | 全局开启 / 关闭会重启实例，必须在 2 分钟内确认 |

- 发送者必须在目标作用范围（当前会话在所选层级的祖先）拥有 `admin` 或 `owner` 聊天角色。
- 会话层写数据库；账号 / 适配器层写配置文件 `overrides`（原地生效）；全局开关写 `disable_plugins` 并重启。
- 私聊的会话层覆盖只能在 Console 修改。
- 每次修改都写入实例审计（actor `chat:<适配器别名>:<用户 id>`，带层级与作用范围）。

## 聊天角色 {#chat-roles}

聊天中的权限由 [ADR 0056](../adr/0056-chat-roles.md) 的角色决定：`owner` ⊃ `admin` ⊃ `trusted`，按「会话 → 账号 → 适配器 → 全局」向下继承，身份是 `(适配器别名, 用户 id)`。完整说明见[聊天角色](../concepts/chat-roles.md)。来源：

| 来源 | 说明 |
| --- | --- |
| 授予（`chat_roles` 表，`source: 'grant'`） | Console「角色」区块或聊天命令 `角色 授予\|撤销 <用户> <角色> [层级]` / `role grant\|revoke …` |
| 映射（`source: 'mapping'`） | 平台身份按映射规则得到的当前会话角色（每条消息实时计算、不落库；默认规则：群主 / 管理员 → 会话 `admin`）；列表里的 `detail` 指出来自哪条规则 |

配置文件不再保存人员名单：旧的账号 `master` / `trusted` 与 `ai.trigger.masters` / `trusted` 在首次启动时迁入 `chat_roles`，见[升级到聊天角色](../migrations/chat-roles.md)。

聊天中授予角色时，授予者必须在目标作用范围拥有不低于被授予角色的角色；`owner` 只能由更高层的 `owner` 授予或撤销。`角色 列表` 显示本会话生效的角色、来源与映射规则。

插件作者如何声明层级与会话层字段、读取有效配置（`context.configFor` / `context.isEnabledFor`）见 [definePlugin](../authoring/define-plugin.md#layered-config)、[ADR 0050](../adr/0050-layered-feature-config.md) 与 [ADR 0055](../adr/0055-conversation-feature-config.md)。
