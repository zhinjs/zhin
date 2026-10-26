# @zhin.js/plugin-calendar

为 Zhin Agent 提供日历查询与创建：CalDAV（iCloud / Fastmail / Nextcloud），以及 **Google Calendar / Microsoft Outlook（Graph）**。

Google / Outlook 的授权在**聊天里完成**：master 发送 `calendar auth google`，点开机器人回复的链接登录，refresh_token 会保存到插件数据库，不需要手动改 `.env`。授权失效时，日历工具会提示重新授权，并主动通知上次完成授权的会话（只通知一次）。

## 安装

```bash
pnpm add @zhin.js/plugin-calendar
```

根 `package.json#zhin`：

```json
{
  "features": [
    { "package": "@zhin.js/command" },
    { "package": "@zhin.js/tool" },
    { "package": "@zhin.js/skill" }
  ],
  "plugins": [
    { "package": "@zhin.js/plugin-calendar", "instanceKey": "calendar" }
  ]
}
```

聊天授权依赖 zhin 的数据库（保存 refresh_token）、HTTP Host（接收 OAuth 回调）和消息出站（通知授权结果）。缺少数据库或 HTTP Host 时，`calendar auth` 会直接说明原因；CalDAV 不受影响。

## 使用流程（Google / Outlook）

1. 在 Google Cloud 或 Azure 创建 OAuth 客户端（见下文），把 Client ID / Secret 写进运行项目的 `.env`。
2. 在 `zhin.config.yml` 配置 `plugins.calendar`（见下文），重启或重载。
3. master 在聊天中发送 `calendar auth google`（或 `calendar auth microsoft`）。
4. 打开机器人回复的链接，登录并同意授权。链接 10 分钟内有效，只能用一次。
5. 浏览器显示「授权成功」，机器人在原会话回复授权成功。完成。

## 聊天命令（仅 master）

| 命令                                  | 说明                                                      |
| ------------------------------------- | --------------------------------------------------------- |
| `calendar auth google`                | 生成 Google 授权链接（PKCE + state，10 分钟有效、一次性） |
| `calendar auth microsoft` / `outlook` | 生成 Outlook（Microsoft Graph）授权链接                   |
| `calendar status`                     | 查看当前 provider 与各平台授权状态（不会显示 token）      |
| `calendar logout google\|microsoft`   | 删除数据库中保存的授权                                    |

refresh_token 的读取顺序：**插件数据库（聊天授权写入）优先**，没有时才用配置里的 `refresh_token`（兼容旧的 `.env` 方式）。

## 配置（`zhin.config.yml`）

```yaml
configVersion: 2
plugins:
  calendar: "@zhin.js/plugin-calendar"
calendar:
  provider: google # none | caldav | google | microsoft
  timezone: Asia/Manila
  work_day_start: "09:00"
  work_day_end: "18:00"
  # OAuth 回调：默认使用 zhin HTTP Host 的本机地址，例如 http://127.0.0.1:8068/calendar/oauth/callback
  oauth_redirect_base_url: "" # 浏览器和机器人不在同一台机器时，填外部可访问地址，如 https://bot.example.com
  oauth_callback_path: /calendar/oauth/callback
  google:
    enabled: true
    client_id: ${GOOGLE_CALENDAR_CLIENT_ID}
    client_secret: ${GOOGLE_CALENDAR_CLIENT_SECRET}
    refresh_token: "" # 可选后备；聊天授权后可以留空
    calendar_id: primary
    token_file: ""
  microsoft:
    enabled: false
    client_id: ${MS_GRAPH_CLIENT_ID}
    client_secret: ${MS_GRAPH_CLIENT_SECRET} # 公共客户端可留空
    refresh_token: ""
    tenant: common
    calendar_id: "" # 空 / primary / me = 默认日历；否则 Graph calendar id
    token_file: ""
  caldav:
    enabled: false
    calendar_url: ${CALDAV_CALENDAR_URL}
    username: ${CALDAV_USERNAME}
    password: ${CALDAV_PASSWORD}
```

运行项目的 `.env`（放在启动 zhin 的项目根目录，不是插件目录）：

```bash
GOOGLE_CALENDAR_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CALENDAR_CLIENT_SECRET=xxxx
# Outlook
MS_GRAPH_CLIENT_ID=xxxx
MS_GRAPH_CLIENT_SECRET= # 可选
```

### 回调地址与反向代理 / 隧道

回调地址 = `oauth_redirect_base_url`（为空时用 HTTP Host 本机地址）+ `oauth_callback_path`。这个地址必须同时满足：

- 打开授权链接的浏览器能访问到它；
- 已登记在 OAuth 客户端的「重定向 URI」里（必须**完全一致**）。

如果反向代理或 Cloudflare Tunnel 只转发部分路径（例如只放行 `/grokbot/*`），要么在隧道里额外放行 `/calendar/oauth/callback`，要么把 `oauth_callback_path` 改到已放行的前缀下，例如：

```yaml
oauth_redirect_base_url: https://bot.example.com
oauth_callback_path: /grokbot/calendar/oauth/callback
```

注意：Google「桌面应用」客户端只接受 `127.0.0.1` / `localhost` 回调。如果用公网域名回调，需要创建「Web 应用」类型的客户端，并把完整回调地址加入「已获授权的重定向 URI」。

## Google Cloud 设置

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)，创建或选择一个项目。
2. **API 和服务 → 库**，搜索并**启用 Google Calendar API**。  
   漏掉这一步，授权会成功，但读日历时报 `403 accessNotConfigured`（Google Calendar API has not been used in project … or it is disabled）。
3. **OAuth 同意屏幕**：用户类型选 External（Workspace 内部用可选 Internal）。  
   应用处于 **Testing（测试）** 状态时，必须在「测试用户」里**添加要授权的 Google 账号**，否则浏览器会显示「尚未完成 Google 验证流程」和 `403 access_denied`。  
   Testing 状态下 refresh_token 约 **7 天**过期，到期后再发一次 `calendar auth google` 即可；发布为 Production 后长期有效（仍受 Google 策略约束）。
4. **凭据 → 创建凭据 → OAuth 客户端 ID**：
   - 机器人和浏览器在同一台电脑：选「**桌面应用**」，回调用默认的 `http://127.0.0.1:<HTTP 端口>/calendar/oauth/callback`。
   - 通过公网域名回调：选「**Web 应用**」，在「已获授权的重定向 URI」加入完整回调地址。
5. 把 Client ID / Client Secret 写进 `.env` 的 `GOOGLE_CALENDAR_CLIENT_ID` / `GOOGLE_CALENDAR_CLIENT_SECRET`，重载后发送 `calendar auth google`。

申请的 scope：`calendar.events` + `calendar.readonly`（`access_type=offline&prompt=consent`）。

## Azure 应用注册（Outlook / Microsoft 365）

1. [Azure Portal](https://portal.azure.com/) → **Microsoft Entra ID → 应用注册 → 新注册**。
2. 支持的账户类型：个人 Outlook.com 账号选「任何组织目录中的帐户和个人 Microsoft 帐户」；仅公司账号可选单租户（此时 `tenant` 填租户 ID）。
3. **身份验证 → 添加平台**：
   - 本机回调：选「移动和桌面应用程序」，添加 `http://127.0.0.1:<HTTP 端口>/calendar/oauth/callback`（或 `http://localhost`，以门户允许为准），并打开「允许公共客户端流」，这样不需要 secret。
   - 公网回调：选「Web」，添加完整回调地址，并在「证书和密码」创建客户端密码，填到 `MS_GRAPH_CLIENT_SECRET`。
4. **API 权限 → Microsoft Graph → 委派的权限**：添加 `Calendars.ReadWrite`、`User.Read`、`offline_access`，组织账号按需「授予管理员同意」。
5. **概述**里复制「应用程序(客户端) ID」到 `MS_GRAPH_CLIENT_ID`。
6. `provider: microsoft`、`microsoft.enabled: true`，重载后发送 `calendar auth microsoft`。

授权请求的 scope：`offline_access Calendars.ReadWrite User.Read`。

## CalDAV

```yaml
configVersion: 2
plugins:
  calendar: "@zhin.js/plugin-calendar"
calendar:
  provider: caldav
  caldav:
    enabled: true
    calendar_url: ${CALDAV_CALENDAR_URL} # 日历 collection URL
    username: ${CALDAV_USERNAME}
    password: ${CALDAV_PASSWORD} # iCloud 请使用 App 专用密码
```

CalDAV 不需要聊天授权。

## 故障排查

| 现象                                                      | 原因与处理                                                                                                           |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 读日历报 `403 accessNotConfigured` / API 未启用           | 该 Google Cloud 项目没有启用 Google Calendar API。到「API 和服务 → 库」启用，几分钟后重试。                          |
| 浏览器显示「尚未完成 Google 验证流程」`403 access_denied` | 同意屏幕处于 Testing，账号不在测试用户里。添加测试用户后重新 `calendar auth google`。                                |
| `redirect_uri_mismatch`                                   | 回调地址与客户端登记的不一致。核对 `calendar auth` 回复里的「回调地址」，原样登记到客户端。                          |
| 点击链接后浏览器打不开回调页                              | 浏览器访问不到 zhin HTTP Host。配置 `oauth_redirect_base_url`，或让隧道放行 `oauth_callback_path`。                  |
| 「授权链接无效、已使用或已过期」                          | 链接超过 10 分钟、已用过，或 zhin 重启过。重新发送 `calendar auth <provider>`。                                      |
| 工具提示「日历授权已失效…（invalid_grant）」              | refresh_token 过期或被撤销（Google Testing 约 7 天、用户改密码、取消授权）。master 发送 `calendar auth <provider>`。 |
| 工具提示「日历尚未授权」                                  | 数据库和配置里都没有 refresh_token。发送 `calendar auth <provider>`。                                                |
| 日志提示「提供方返回了新的 refresh_token」                | Microsoft 会轮换 refresh_token。聊天授权时新值自动写回数据库；只用 `.env` 时请按日志更新，或配置 `token_file`。      |

## 可选：命令行授权（后备方式）

不方便走聊天回调时（例如没有 HTTP Host），可以用随包附带的命令行工具获取 refresh_token，再写入 `.env` 的 `GOOGLE_CALENDAR_REFRESH_TOKEN` / `MS_GRAPH_REFRESH_TOKEN`：

```bash
export GOOGLE_CALENDAR_CLIENT_ID=...
export GOOGLE_CALENDAR_CLIENT_SECRET=...
npx zhin-calendar-auth google

export MS_GRAPH_CLIENT_ID=...
npx zhin-calendar-auth microsoft
```

它在本机监听 `http://127.0.0.1:53682/callback`（`CALENDAR_OAUTH_PORT` 可改端口），需要把这个地址登记为客户端的重定向 URI。工具只读取已 export 的环境变量，只打印 refresh_token，不写任何文件。在 zhin 仓库内也可以用 `pnpm --filter @zhin.js/plugin-calendar auth google`。

## Agent 技能

技能 `calendar-scheduling`：

| 工具             | 说明                                  |
| ---------------- | ------------------------------------- |
| `list_events`    | 列出时间范围内事件                    |
| `find_free_time` | 工作时段内找空档                      |
| `create_event`   | 创建事件（`role(master)` + 始终批准） |

创建前应向用户确认标题、时间与时区。

## Language / 语言

授权命令按当前操作语言回复，OAuth 回调页面、完成通知和后续授权失效通知固定使用发起授权时的语言。refresh_token 轮换保留该语言和原完整通知目标。状态页中的授权指令由当前命令上下文解析真实前缀与插件命名空间；没有可用命令上下文时只描述授权入口，不猜测指令。

Calendar authorization captures the initiating language. Browser callbacks and subsequent authorization-loss notifications use that language; token rotation preserves it. Event titles, descriptions and external provider messages are not automatically translated. Timezone remains independent of language.
