# @zhin.js/plugin-calendar

为 Agent 提供日历查询与创建能力：优先 CalDAV（iCloud / Fastmail / Nextcloud），可选 Google Calendar 与 Microsoft Graph（预置 OAuth token，不在插件内走授权流程）。

## 安装

```bash
pnpm add @zhin.js/plugin-calendar
```

在根 `package.json#zhin` 挂载：

```json
{
  "features": [{ "package": "@zhin.js/tool" }, { "package": "@zhin.js/skill" }],
  "plugins": [
    { "package": "@zhin.js/plugin-calendar", "instanceKey": "calendar" }
  ]
}
```

## 配置

```yaml
plugins:
  calendar:
    provider: none # caldav | google | microsoft
    timezone: Asia/Manila
    work_day_start: "09:00"
    work_day_end: "18:00"
    caldav:
      enabled: false
      calendar_url: ${CALDAV_CALENDAR_URL}
      username: ${CALDAV_USERNAME}
      password: ${CALDAV_PASSWORD}
    google:
      enabled: false
      access_token: ${GOOGLE_CALENDAR_ACCESS_TOKEN}
      refresh_token: ${GOOGLE_CALENDAR_REFRESH_TOKEN}
      client_id: ${GOOGLE_CALENDAR_CLIENT_ID}
      client_secret: ${GOOGLE_CALENDAR_CLIENT_SECRET}
      calendar_id: primary
    microsoft:
      enabled: false
      access_token: ${MS_GRAPH_ACCESS_TOKEN}
      refresh_token: ${MS_GRAPH_REFRESH_TOKEN}
      client_id: ${MS_GRAPH_CLIENT_ID}
      client_secret: ${MS_GRAPH_CLIENT_SECRET}
      tenant: common
```

## Agent 技能与工具

技能 `calendar-scheduling`：

| 工具             | 说明                                  |
| ---------------- | ------------------------------------- |
| `list_events`    | 列出时间范围内的事件                  |
| `find_free_time` | 在工作时段内找空档                    |
| `create_event`   | 创建事件（`role(master)` + 始终批准） |

创建前应向用户确认标题、时间与时区。
