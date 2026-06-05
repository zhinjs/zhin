# Assistant Home Domain（M4）

通过 **配置别名** 控制 Home Assistant 设备，主 Agent 与子 Agent 使用 `home_*` 工具，无需记忆 `entity_id`。

前置：`assistant.enabled: true` 且配置 `assistant.home`。

**逐步接入**（创建 HA 令牌 → 第一次关客厅灯）：[接入清单](./assistant-home-setup)。

## 配置

```yaml
assistant:
  enabled: true
  home:
    enabled: true
    restUrl: ${HA_URL}          # 如 http://192.168.1.10:8123
    restToken: ${HA_TOKEN}      # HA 长期访问令牌
    # mcpServer: homeassistant  # 可选，后续 MCP 扩展
    aliases:
      客厅灯: light.living_room
      大门锁: lock.front_door
    policy:
      requireMaster: true
      confirmServices: [lock, alarm_control_panel]
```

`.env` 示例：

```bash
HA_URL=http://homeassistant.local:8123
HA_TOKEN=eyJhbGciOi...
```

启动日志应出现：`assistant_home: true; aliases: N`

## 工具

| 工具 | 说明 |
|------|------|
| `home_list_aliases` | 列出已配置别名 |
| `home_get_state` | 读状态（参数 `alias`） |
| `home_turn_on` | 开/解锁等（按 domain 映射 HA service） |
| `home_turn_off` | 关/锁等 |

主 Agent 可直接调用；复杂场景可 `spawn_task` 子 Agent **`home`**（`agents/home.agent.md`）。

## 权限

| 策略 | 行为 |
|------|------|
| `requireMaster: true` | 非 Owner 调用 `home_*` 被拒绝 |
| `confirmServices` | 写 `lock` / `alarm_control_panel` 等返回 `ZHIN_NEEDS_OWNER`，需 Owner 确认 |

读状态（`home_get_state`）不触发 lock 审批，但仍需 master（若 `requireMaster` 开启）。

## 对话示例

Owner 私聊：

> 关掉客厅灯

Agent 调用 `home_turn_off(alias="客厅灯")`，内部解析为 `light.living_room` → `light.turn_off`。

> 大门锁现在什么状态？

`home_get_state(alias="大门锁")`

## 与 Event Ingress 配合

Job 可使用 `notify.channel: ha`（M3 Router 占位）；M4 以 REST 工具为主，HA 自动化触发 Agent 见 [assistant-events](./assistant-events)。

## 相关

- [Assistant Runtime 路线图](../architecture/assistant-runtime)
- [MCP 集成](./mcp) — 可选接入 HA MCP Server
