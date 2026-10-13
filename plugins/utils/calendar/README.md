# @zhin.js/plugin-calendar

为 Agent 提供日历查询与创建：CalDAV（iCloud / Fastmail / Nextcloud），以及 **Google Calendar / Microsoft Outlook（Graph）** 的 OAuth **refresh_token** 流程（内存缓存 access token，临近过期自动刷新）。

## 安装

```bash
pnpm add @zhin.js/plugin-calendar
```

根 `package.json#zhin`：

```json
{
  "features": [{ "package": "@zhin.js/tool" }, { "package": "@zhin.js/skill" }],
  "plugins": [
    { "package": "@zhin.js/plugin-calendar", "instanceKey": "calendar" }
  ]
}
```

## 配置（`zhin.config.yml`）

```yaml
plugins:
  calendar:
    provider: google # none | caldav | google | microsoft
    timezone: Asia/Manila
    work_day_start: "09:00"
    work_day_end: "18:00"
    google:
      enabled: true
      client_id: ${GOOGLE_CALENDAR_CLIENT_ID}
      client_secret: ${GOOGLE_CALENDAR_CLIENT_SECRET}
      refresh_token: ${GOOGLE_CALENDAR_REFRESH_TOKEN}
      calendar_id: primary # 可改为其它日历 ID
      token_file: "" # 可选，如 data/calendar-google-token.json（轮换 refresh 时落盘）
    microsoft:
      enabled: false
      client_id: ${MS_GRAPH_CLIENT_ID}
      client_secret: ${MS_GRAPH_CLIENT_SECRET} # 公共客户端可留空
      refresh_token: ${MS_GRAPH_REFRESH_TOKEN}
      tenant: common
      calendar_id: "" # 空 / primary / me = 默认日历；否则 Graph calendar id
      token_file: ""
    caldav:
      enabled: false
      calendar_url: ${CALDAV_CALENDAR_URL}
      username: ${CALDAV_USERNAME}
      password: ${CALDAV_PASSWORD}
```

**不要**再配置 `access_token`：插件只用 `refresh_token` 换取并缓存 access token（提前约 5 分钟刷新、并发单飞）。Microsoft 若返回新的 `refresh_token`，会打明确警告；配置了 `token_file` 则写入该 JSON，否则请手动更新环境变量。

多日历：在对应 provider 的 `calendar_id` 选择要操作的日历（Google 默认 `primary`，Outlook 默认 `me/calendar`）。

## 一次性授权 CLI

先准备好 Client ID（及 Google 的 Secret），在 shell 里 **export** 环境变量（脚本**不会**读取或写入 `.env`）：

```bash
export GOOGLE_CALENDAR_CLIENT_ID=...
export GOOGLE_CALENDAR_CLIENT_SECRET=...
pnpm --filter @zhin.js/plugin-calendar auth google

export MS_GRAPH_CLIENT_ID=...
# export MS_GRAPH_CLIENT_SECRET=...   # 可选
# export MS_GRAPH_TENANT=common
pnpm --filter @zhin.js/plugin-calendar auth microsoft
```

流程：本地监听 `http://127.0.0.1:53682/callback`（可用 `CALENDAR_OAUTH_PORT` 改端口）→ PKCE + state → 打开浏览器 → 打印 `refresh_token`，请**手动**粘贴进 `.env`。

### Google Cloud 控制台（步骤）

1. 打开 [Google Cloud Console](https://console.cloud.google.com/) → 创建/选择项目。
2. **API 和服务 → 库** → 启用 **Google Calendar API**。
3. **OAuth 同意屏幕**：选 External（或 Internal）。Testing 模式下把你的 Google 账号加为 **测试用户**。
   - 注意：Testing 模式下 refresh token 大约 **7 天**过期，需重新 `auth google`；发布为 Production 后长效（仍受 Google 策略约束）。
4. **凭据 → 创建凭据 → OAuth 客户端 ID → 应用类型选「桌面应用」(Desktop)**。
5. 记下 Client ID / Client Secret，export 后运行 `auth google`。  
   脚本回调为 `http://127.0.0.1:<port>/callback`；Desktop 客户端通常允许 loopback。
6. 把打印的 `GOOGLE_CALENDAR_REFRESH_TOKEN` 写入环境变量，并在配置里引用 `${GOOGLE_CALENDAR_REFRESH_TOKEN}`。

Scopes：`calendar.events` + `calendar.readonly`（`access_type=offline&prompt=consent`）。

### Azure 应用注册（Outlook / Microsoft 365）

1. [Azure Portal](https://portal.azure.com/) → **Microsoft Entra ID → 应用注册 → 新注册**。
2. 支持账户类型选 **个人 Microsoft 帐户 + 组织目录**（或多租户，按需）。
3. 重定向 URI：平台选 **移动和桌面应用程序** 或「公共客户端」，添加  
   `http://localhost` / `http://127.0.0.1`（与脚本端口组合的完整 callback 按门户要求添加；脚本使用 `http://127.0.0.1:<port>/callback`）。
4. **身份验证**：允许公共客户端流（若不用 secret）。
5. **API 权限**：委派权限添加 `Calendars.ReadWrite`、`User.Read`，并完成管理员同意（若需要）。`offline_access` 由授权请求带上。
6. **概述**复制应用程序（客户端）ID → `MS_GRAPH_CLIENT_ID`。若建了机密，再设 `MS_GRAPH_CLIENT_SECRET`（公共客户端可省略）。
7. `pnpm --filter @zhin.js/plugin-calendar auth microsoft`，把 `MS_GRAPH_REFRESH_TOKEN` 写入环境变量。

## Agent 技能

技能 `calendar-scheduling`：

| 工具             | 说明                                  |
| ---------------- | ------------------------------------- |
| `list_events`    | 列出时间范围内事件                    |
| `find_free_time` | 工作时段内找空档                      |
| `create_event`   | 创建事件（`role(master)` + 始终批准） |

创建前应向用户确认标题、时间与时区。
