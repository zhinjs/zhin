---
title: "智能家居接入（Home Assistant）"
description: "让 Agent 通过 Home Assistant 查询和控制家里的设备：前置条件、最小配置、设备别名、安全策略、可用工具与状态推送"
---

# 智能家居接入（Home Assistant）

配好之后，你可以在聊天里对 Bot 说"把客厅灯关了""空调调到 26 度"，Agent 会通过 [Home Assistant](https://www.home-assistant.io/)（HA）执行，并在设备状态变化时主动提醒你。

- 只支持 **Home Assistant**：各品牌设备先接入 HA，Zhin 再通过 HA 的 REST + WebSocket 接口统一控制。
- Agent 只认你起的**设备别名**（如"客厅灯"），不会看到也不会操作别名以外的设备。
- 默认只有 Bot 的主人（Endpoint Owner）能控制设备，门锁等敏感操作还要二次确认。

## 前置条件

1. Home Assistant 已经运行，并且 Zhin 所在机器能访问到它（同一网络）。
2. 在 HA 中打开 **个人资料 → 长期访问令牌 → 创建令牌**，复制备用。
3. 项目已安装 `@zhin.js/agent`：`pnpm add @zhin.js/agent`。

## 最小配置

先把地址和令牌放进 `.env`：

```bash
HA_REST_URL=http://homeassistant.local:8123
HA_REST_TOKEN=eyJhbGciOiJIUz...
```

再在 `zhin.config.yml` 中增加 `assistant.home`：

```yaml
assistant:
  enabled: true
  defaults:
    notify:
      channel: im
      target:
        channel: im
        scene:
          platform: sandbox
          endpointId: assistant
          sceneId: owner
          kind: private
  home:
    enabled: true
    restUrl: "${HA_REST_URL}"     # 如 http://homeassistant.local:8123
    restToken: "${HA_REST_TOKEN}" # HA 长期访问令牌
    aliases:
      客厅灯: light.living_room
      卧室灯: light.bedroom
      空调: climate.living_room
      客厅窗帘: cover.living_room
```

`aliases` 左边是你在聊天里说的名字，右边是 HA 中的 `entity_id`。重启后，对 Bot 说"列出我的设备"即可验证——Agent 会调用 `home_list_aliases`。

::: tip 别名也可以写在助手人设里
`assistant.profile.yml` 的 `devices` 中声明的别名会与 `assistant.home.aliases` 合并，同名时以 profile 为准：

```yaml
version: 1
devices:
  客厅灯: light.living_room
  大门锁: lock.front_door
```
:::

## 安全策略

| 设置 | 默认值 | 作用 |
|------|--------|------|
| `policy.requireMaster` | `true` | 只有 Endpoint Owner（master）能调用 `home_*` 工具 |
| `policy.confirmServices` | `['lock', 'alarm_control_panel']` | 这些 HA domain 的写操作需要 Owner 二次确认 |

例如把窗帘也加入二次确认：

```yaml
assistant:
  home:
    policy:
      requireMaster: true
      confirmServices:
        - lock
        - alarm_control_panel
        - cover
```

## 设备状态变化时提醒我

在 `watch` 中列出要关注的设备别名，Zhin 会通过 HA WebSocket 订阅它们的变化，并推送给你：

```yaml
assistant:
  home:
    watch:
      - 客厅灯
      - 大门锁
    debounceMs: 5000    # 同一设备的防抖间隔（默认 5 秒）
```

推送走 `assistant.defaults.notify` 指定的 IM 通道。如果它不是可投递的 IM 通道，Zhin 只注册工具，不会建立 WebSocket 订阅。

## 可用工具

Agent 会根据你的话自动选择以下工具：

| 工具 | 类型 | 说明 |
|------|------|------|
| `home_list_aliases` | 读 | 列出已配置的设备别名 |
| `home_get_state` | 读 | 查询设备当前状态 |
| `home_turn_on` | 写 | 开启设备 |
| `home_turn_off` | 写 | 关闭设备 |
| `home_set_brightness` | 写 | 设置灯光亮度（0–255） |
| `home_set_temperature` | 写 | 设置温控目标温度 |
| `home_activate_scene` | 写 | 触发 HA 场景或脚本 |
| `home_set_cover_position` | 写 | 设置窗帘位置（0–100） |
| `home_call_service` | 写 | 通用 HA 服务调用（受白名单约束） |

`home_call_service` 只允许 `light` / `climate` / `scene` / `cover` / `script` 这几个 domain，并且同样只接受别名。

## 常见问题

**没有 Home Assistant 能用吗？**
目前不能，请先把设备接入 HA。

**配置后工具没有出现？**
确认 `home.enabled: true`，并且 `restUrl` / `restToken` 都已填写。启动日志中应能看到 home 已激活。

::: details 内部结构
```
Agent home_* tools
      │
      ▼
 HomeFacade（别名 + 权限 + 意图）
      │
      ▼
 HaHomeBackend（REST）
      │
 HomeStateWatch ← HaWsTransport（可选 watch）
      │
 NotificationRouter → Owner IM
```
:::

## 下一步

- [Agent 深入](/ai/agent)：工具如何被选择、审批与执行
- [AI 总览](/ai/)：配置聊天模型与助手
