---
title: 功能矩阵与三级配置
description: Console「功能」区：在全局、适配器、账号三个层级上启用 / 禁用功能并覆盖配置，继承与锁定规则，以及对应的权限
---

# 功能矩阵与三级配置

同一个功能在不同平台、不同账号上常常要有不同设置：某个 QQ 账号不开 RSS，某个 Telegram 账号每次只推 1 条。Console「功能」区按三个层级管理（[ADR 0050](../adr/0050-layered-feature-config.md)）：

| 层级 | 键 | 写在配置的哪里 |
| --- | --- | --- |
| 全局 | — | 插件自己的配置块；全局启停是 `disable_plugins` |
| 适配器 | 适配器实例别名（配置里的顶层键，如 `qq`、`tg-main`） | `overrides.adapters.<别名>` |
| 账号 | `<别名>/<endpointId>`，如 `qq/bot-1` | `overrides.endpoints."<别名>/<endpointId>"` |

```yaml
rss:
  maxItems: 5
  overrides:
    adapters:
      qq: { enabled: false }
    endpoints:
      "tg-main/news": { maxItems: 1 }
```

`overrides` 是普通 YAML，手改与在 Console 里改等价。

## 页面 {#pages}

| 路由 | 页面 | 读 / 写权限 |
| --- | --- | --- |
| `/features` | 功能矩阵 | `feature.view` / `feature.toggle` |
| `/features/global/:plugin` | 全局配置（Schema 表单） | `feature.view` / `feature.configure` |
| `/features/adapters` | 适配器列表：别名、类型、账号数、在线数 | `feature.view` |
| `/features/adapters/:adapter` | 适配器页：该适配器下的功能覆盖 + 账号连接管理 | `feature.*`；账号增删改启停需要 `endpoint.manage` |
| `/features/adapters/:adapter/endpoints/:endpoint` | 账号配置：该账号的功能覆盖 | `feature.*` |
| `/features/ai` | AI 与模型（模型路由、技能、Ambient、场所） | `agent.view` / `agent.configure` |

旧的插件详情配置页重定向到 `/features/global/:plugin`。「会话」区的账号工作区有一个「功能配置」入口，跳到对应的账号配置页。

## 功能矩阵 {#matrix}

行是功能，列是「全局」加每个适配器实例。每格是三态开关：

- **启用**；
- **禁用**；
- **被上级禁用并锁定**——鼠标悬停显示「已在 全局 / 适配器 qq 禁用」，附跳转链接。

有覆盖的格子带标记。点功能名进全局配置，点格子进对应层级的配置页。数据来自 `feature.matrix`。

## 继承规则 {#resolution}

**启用：上级优先。** 只要全局或适配器层禁用，下级就不能重新打开：

```text
有效启用 = 不在 disable_plugins 里
         且 overrides.adapters[别名].enabled 不是 false
         且 overrides.endpoints[别名/id].enabled 不是 false
```

**其他字段：下级优先。** 有效配置 = 全局 → 适配器覆盖 → 账号覆盖 依次深合并：普通对象逐键合并，数组与标量整体替换，`null` 表示「显式清空」而不是「继承」。

每个字段旁显示来源徽标：「继承自全局」「继承自适配器」「在此覆盖」。编辑一个继承来的字段就创建覆盖；覆盖字段旁有「移除覆盖」，回到继承。

- 插件没有声明支持适配器 / 账号层时（Schema 根上的 `x-zhin-config.levels` 省略即只有全局），它不出现在适配器与账号页面里。
- 只支持全局的字段（如数据库连接、API 密钥）在下级表单里只读显示。
- 没有配置 Schema 的插件只有三级启停开关，没有字段覆盖。
- 机密字段的值以掩码返回。

## 生效方式 {#apply}

| 改了什么 | 怎么生效 |
| --- | --- |
| 只改 `overrides`（含适配器 / 账号层的启停） | 原地生效：不重启、不重载插件，下一条消息读到新值 |
| 全局字段 | 按字段声明的 `x-zhin-config.effect` |
| 全局启停（`disable_plugins`） | 重启实例（网关负责，Console 不中断） |

功能在某个账号上被禁用时，Runtime 在分发处直接跳过：命令不匹配（也不回复「已禁用」）、中间件与处理器不执行、Agent 工具在该账号的会话里不可见也调不到。定时任务等不经过消息的能力由插件自己用 `isEnabledFor` 判断。

## 接口与权限 {#rpc}

| RPC | 权限 | 说明 |
| --- | --- | --- |
| `feature.list` | `feature.view` | 全部功能与支持的层级 |
| `feature.matrix` | `feature.view` | 矩阵数据 |
| `feature.get` | `feature.view` | 某层级的 Schema、值、有效值与来源 |
| `feature.set-override` | `feature.configure` | 写入覆盖（合并补丁） |
| `feature.remove-override` | `feature.configure` | 删除整层或指定字段 |
| `feature.set-enabled` | `feature.toggle` | 全局层写 `disable_plugins`，其余层写 `overrides.*.enabled` |

`feature.configure` 与 `feature.toggle` 按作用域检查：绑定到适配器 `qq` 的运营只能改 `qq` 及其账号上的覆盖，不能改全局或别的适配器。所有写入都带配置修订号，并发修改会被拒绝而不是互相覆盖。

插件作者如何声明层级、读取有效配置（`context.configFor` / `context.isEnabledFor`）见 [ADR 0050](../adr/0050-layered-feature-config.md)。
