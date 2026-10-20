# 飞书长连接与钉钉 Stream 测试准备

凭据只保存在本地，不发到聊天。变量模板见 [webhook.env.example](./webhook.env.example)，手动追加缺少的变量到已有 `.env`，保留原内容。默认飞书 `LARK_MODE=websocket`、钉钉 `DINGTALK_MODE=stream`，这两种接收方式无需公网回调地址。

## 飞书

1. 在 [飞书开放平台](https://open.feishu.cn/app) 已创建的企业自建应用中开启机器人能力，设置测试用户可用范围。
2. 将 App ID、App Secret 分别填入本地 `LARK_APP_ID`、`LARK_APP_SECRET`。
3. 在事件与回调配置中选择使用长连接接收事件，订阅 `im.message.receive_v1`。授予对应会话接收消息与机器人发送消息的权限，发布测试版本。
4. 将 `LARK_TEST_CHAT_ID=pending`，运行 `pnpm --filter platform-acceptance-bot dev:lark`，给机器人发一条消息。从终端入站日志获取会话 ID，填入 `LARK_TEST_CHAT_ID` 后重启。私聊使用 `LARK_TEST_CHAT_KIND=private`；群聊使用 `group`，并将机器人加入测试群。
5. 发送 `/acceptance probe:lark0001`，核对回复 `acceptance:lark-a:lark0001`。

长连接说明见 [官方 Node SDK](https://github.com/larksuite/node-sdk)。长连接模式不需要 Verification Token。

## 钉钉

1. 在 [钉钉开放平台](https://open.dingtalk.com/) 已创建的企业内部应用中开启机器人能力，消息接收模式选择 Stream，并设置测试用户可用范围。
2. 将 Client ID（AppKey）、Client Secret（AppSecret）分别填入 `DINGTALK_APP_KEY`、`DINGTALK_APP_SECRET`。若后台提供 RobotCode，一并填入 `DINGTALK_ROBOT_CODE`。
3. 发布机器人测试版本，私聊机器人或将机器人加入测试群。
4. 将 `DINGTALK_TEST_CHAT_ID=pending`，运行 `pnpm --filter platform-acceptance-bot dev:dingtalk`。发送一条消息，从终端入站日志获取会话 ID，填写后重启。私聊使用 `DINGTALK_TEST_CHAT_KIND=private`，群聊使用 `group`。
5. 发送 `/acceptance probe:dingtalk0001`，核对回复 `acceptance:dingtalk-a:dingtalk0001`。

后台创建步骤见 [钉钉官方 Stream 机器人教程](https://open-dingtalk.github.io/developerpedia/docs/explore/tutorials/stream/bot/go/create-bot/)。

## HTTP 回调兼容模式

需要验证原有 HTTP 模式时，显式设置 `LARK_MODE=webhook` 或 `DINGTALK_MODE=webhook`。飞书还需填写 `LARK_VERIFY_TOKEN`。回调地址分别为 `https://test.l2cl.link/lark/webhook` 与 `https://test.l2cl.link/dingtalk/webhook`，隧道转发到 `ACCEPTANCE_HTTP_PORT=18181`。

两种长连接测试也共用本地控制台端口，依次启动，避免同时占用 18181。聊天 ID 为 `pending` 时仅记录入站，不回复；验收通过后继续测重复消息、重启和断线恢复。
