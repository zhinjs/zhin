# Assistant Event Ingress（M2）

外部系统（如 Home Assistant）可通过 HTTP 向 Zhin 投递事件，触发已注册的 Job 或一次性 Agent 任务。需同时启用 `assistant.enabled` 与 `assistant.events.enabled`。

架构说明见 [Assistant Runtime 路线图](../architecture/assistant-runtime)。

## 配置

```yaml
assistant:
  enabled: true
  events:
    enabled: true
    # 可选：仅允许列出的 source
    allowedSources: [homeassistant, script]
    rateLimitPerMinute: 60
    # token: 可选专用 Bearer；未设时复用 http.token
```

启动日志应包含 `events: true`（与 `assistant_runtime: true` 同条）。

## 端点

```
POST {http.base}/assistant/events
```

默认完整路径：`http://127.0.0.1:3000/api/assistant/events`（取决于 `http.base`）。

鉴权：与 Host API 一致，请求头 `Authorization: Bearer <http.token>`。

## 请求体

### 触发已有 Job

```json
{
  "source": "homeassistant",
  "jobId": "cron_morning_brief",
  "eventId": "optional-dedup-key"
}
```

### 一次性内联 Agent 任务

`jobId` 与 `action` 二选一。

```json
{
  "source": "homeassistant",
  "type": "state_changed",
  "eventId": "ha-door-open-20250605",
  "label": "门磁告警",
  "action": {
    "kind": "agent",
    "prompt": "客厅门已打开，请简要说明当前家中状态并提醒主人。"
  },
  "notify": { "channel": "silent" }
}
```

省略 `notify` 时，执行阶段会合并 `assistant.defaults.notify`（如 master 私聊）。要静默执行请显式传 `"notify": { "channel": "silent" }`。

| 字段 | 说明 |
|------|------|
| `source` | 必填，来源标识 |
| `type` | 可选，事件类型 |
| `eventId` | 可选，幂等键；重复投递返回 `deduped` |
| `payload` | 可选，任意 JSON，写入 Job 的 `eventPayload` |
| `jobId` | 触发 `assistant-jobs.json` 中已有任务 |
| `action` | `{ kind: "agent", prompt }` 创建 event 类型 Job 并立即执行 |

## 响应

成功入队：`202 Accepted`（幂等去重为 `200`）。

```json
{
  "success": true,
  "data": {
    "ok": true,
    "jobId": "event_m3abc12_xyz",
    "status": "queued"
  }
}
```

错误：`400` / `404` / `429` / `503`，`success: false`。

## Home Assistant 示例

`configuration.yaml`：

```yaml
rest_command:
  zhin_event:
    url: "http://127.0.0.1:3000/api/assistant/events"
    method: POST
    headers:
      Authorization: "Bearer YOUR_HTTP_TOKEN"
      Content-Type: "application/json"
    payload: >
      {
        "source": "homeassistant",
        "type": "automation",
        "eventId": "door-{{ now().timestamp() | int }}",
        "action": {
          "kind": "agent",
          "prompt": "门磁触发，请检查并回复主人。"
        }
      }
```

自动化：

```yaml
automation:
  - alias: 门磁通知 Zhin
    trigger:
      - platform: state
        entity_id: binary_sensor.front_door
        to: "on"
    action:
      - service: rest_command.zhin_event
```

## 本地验证

```bash
curl -sS -X POST http://127.0.0.1:3000/api/assistant/events \
  -H "Authorization: Bearer $HTTP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"script","action":{"kind":"agent","prompt":"ping from curl"}}'
```

随后在 `data/assistant-jobs.json` 中应出现 `schedule.kind: "event"` 的记录。

## 相关

- [定时任务与 JobStore](./cron.md)
- [Assistant Runtime 路线图](../architecture/assistant-runtime)
