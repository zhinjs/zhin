# LINE 实机验收准备

在已有 LINE Official Account 中启用 Messaging API，并打开对应 LINE Developers Channel。官方步骤见 [Build a bot](https://developers.line.biz/en/docs/messaging-api/building-bot/)。

将 Channel Secret 与 Channel Access Token 分别填入本地 `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`。变量模板见 [webhook.env.example](./webhook.env.example)，只追加缺少的变量，保留原 `.env`。

先设置 `LINE_TEST_CHAT_ID=pending`，运行 `pnpm --filter platform-acceptance-bot dev:line`。设置 `ACCEPTANCE_HTTP_PORT=18181`，使 Cloudflare Tunnel 转发至该实例；后台 Webhook URL 填 `https://test.l2cl.link/line/webhook`，验证成功后启用 Use webhook。不要同时运行其他占用 18181 的实例。

添加自己的 Official Account 为好友，发 `/start`，从终端 `receive | conv: private:...` 获取会话 ID。填入 `LINE_TEST_CHAT_ID` 后重启，发送 `/acceptance probe:line0001`，预期收到 `acceptance:line-a:line0001`。私聊 kind 为 `private`；群组或 room 为 `group`。

完成基础收发后继续记录重复消息、重启和回调重投结果。LINE webhook 会通过 HTTPS POST 投递消息事件，详细说明及 redelivery 设置见 [官方接收消息说明](https://developers.line.biz/en/docs/messaging-api/receiving-messages)。
