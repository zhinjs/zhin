# 新增平台账号准备与首轮测试

这一轮新增 Discord、Slack、KOOK 和 Email。初始化、观察报告及白名单规则与原四个平台一致；账号凭据由用户填入现有 `.env`，不要覆盖整个文件或向聊天发送 Token。

所需字段集中在 [additional.env.example](./additional.env.example)，按平台追加即可。

| 平台 | 需要准备 | 本地变量 |
| --- | --- | --- |
| Discord | 一个 Bot、测试服务器和文字频道；开启 Message Content Intent，允许 Bot 读取和发送消息 | `DISCORD_BOT_TOKEN`、`DISCORD_TEST_CHAT_ID`；频道默认 `DISCORD_TEST_CHAT_KIND=channel` |
| Slack | 开启 Socket Mode 的 App，安装到测试 Workspace；订阅消息事件，邀请 Bot 进入测试频道 | `SLACK_BOT_TOKEN`、`SLACK_APP_TOKEN`、`SLACK_TEST_CHAT_ID`；频道在 Zhin 中为 `group` |
| KOOK | 一个开发者 Bot、测试服务器和文字频道，允许查看和发送消息 | `KOOK_BOT_TOKEN`、`KOOK_TEST_CHAT_ID`；默认 `channel` |
| Email | 专用机器人邮箱和独立发件邮箱，启用 SMTP/IMAP，准备应用专用密码 | 下方邮件变量及 `EMAIL_TEST_CHAT_ID` |

平台官方说明：[Discord Gateway / Message Content](https://docs.discord.com/developers/events/gateway#message-content-intent)、[Slack Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/)、[KOOK 开发者文档](https://developer.kookapp.cn/doc/intro)。本机无可调用 Context7 工具，这些准备要求已通过官方文档及当前适配器源码核对。

邮件配置变量：

```dotenv
EMAIL_SMTP_HOST=
EMAIL_SMTP_PORT=465
EMAIL_SMTP_SECURE=true
EMAIL_SMTP_USER=
EMAIL_SMTP_PASSWORD=
EMAIL_IMAP_HOST=
EMAIL_IMAP_PORT=993
EMAIL_IMAP_TLS=true
EMAIL_IMAP_USER=
EMAIL_IMAP_PASSWORD=
EMAIL_TEST_CHAT_ID=
EMAIL_TEST_CHAT_KIND=private
```

SMTP 的 secure 表示连接时立即 TLS；按邮箱提供方实际配置选择端口和开关。邮件会话 ID 是发件人的纯邮箱地址，不包含显示名；可先用 `EMAIL_TEST_CHAT_ID=pending` 开启 debug，从入站 `conv: private:...` 中读取。

## 启动与收发

```sh
pnpm --filter platform-acceptance-bot dev:discord
pnpm --filter platform-acceptance-bot dev:slack
pnpm --filter platform-acceptance-bot dev:kook
pnpm --filter platform-acceptance-bot dev:email
```

每次启动一个准备好的平台。另开终端执行相应 `observe:<平台> 5m`，在白名单会话发送：

```text
/acceptance probe:sample0002
```

核对回复中的 `<平台>-a` 别名及 `sample0002`。Email 的探针放在纯文本正文首行，邮件主题留空，避免主题前缀影响命令识别。Slack 默认使用 `!acceptance probe:sample0002`，避免客户端把 `/acceptance` 解释为 Slash Command；它是普通消息探针。其他平台默认 `/`。可通过 `<平台大写>_COMMAND_PREFIX` 自定义前缀。

报告保存在 `.acceptance/<平台>/reports/`。首轮通过后按[第二轮验收](./NEXT-TESTS.md)继续；平台确实不支持的媒体/撤回能力保留 unsupported。

## 下一批

飞书、钉钉、LINE 还需要测试公网 HTTPS 回调入口。可以先准备企业自建应用/机器人（飞书、钉钉）或 Messaging API Channel（LINE）、测试会话和权限；当前 example 尚未加入这三种配置，合成回执问题已修复并通过本地回归，真实回调仍待测试；不能直接用已有四个平台的变量替代。
