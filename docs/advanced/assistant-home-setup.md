# 智能家居接入（Home Assistant）

Zhin.js 通过 `assistant.home` 配置块接入 [Home Assistant](https://www.home-assistant.io/)，Agent 可使用 `home_*` 工具查询和控制你的智能设备。

当前仅支持 **Home Assistant REST + WebSocket**（经 HA 统一接入各生态设备）。

## 前置条件

1. Home Assistant 实例运行中，且与 Zhin 所在机器**同网可达**
2. 在 HA → 个人资料 → 长期访问令牌 → 创建令牌，复制备用
3. Zhin 已安装 `@zhin.js/agent`（`pnpm add @zhin.js/agent`）

## 最小配置

在 `zhin.config.yml` 中增加 `assistant.home` 块：

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

> 设备别名（aliases）是你在 IM 中对 Agent 说的名称，映射到 HA 的 `entity_id`。
> Agent 仅接受别名，**不暴露原始 entity_id**。

## 环境变量

将敏感凭证放在 `.env`，配置中通过 `${VAR}` 引用：

```bash
HA_REST_URL=http://homeassistant.local:8123
HA_REST_TOKEN=eyJhbGciOiJIUz...
```

## Profile 设备别名

也可以在 `assistant.profile.yml` 的 `devices` 中声明别名，会与 `assistant.home.aliases` 合并（profile 优先）：

```yaml
version: 1
devices:
  客厅灯: light.living_room
  大门锁: lock.front_door
```

## 安全策略

| 设置 | 默认值 | 说明 |
|------|--------|------|
| `policy.requireMaster` | `true` | 仅 Endpoint Owner（master）可调用 `home_*` |
| `policy.confirmServices` | `['lock', 'alarm_control_panel']` | 这些 HA domain 的写操作需 Owner 二次确认 |

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

## 可用工具

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

> `home_call_service` 仅允许 `light` / `climate` / `scene` / `cover` / `script` domain，且只接受别名。

## 状态推送（watch）

配置 `watch` 可让 Zhin 通过 HA WebSocket 订阅设备变化，主动推送到 Owner IM：

```yaml
assistant:
  home:
    watch:
      - 客厅灯
      - 大门锁
    debounceMs: 5000    # 同实体防抖间隔（默认 5 秒）
```

推送会走 `assistant.defaults.notify` 指定的 IM 通道（须为可投递的 IM notify；否则只挂 tools，跳过 WS）。

## 架构（简）

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

## 常见问题

**Q: 没有 Home Assistant，能用吗？**  
A: 当前不能。请先通过 HA 接入设备。

**Q: 配置后工具没有出现？**  
A: 检查 `home.enabled: true` + `restUrl` / `restToken`。启动日志应显示 home 已激活。
