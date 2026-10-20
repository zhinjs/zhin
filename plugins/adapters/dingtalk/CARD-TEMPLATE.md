# 钉钉原生按钮测试模板

此实现使用互动卡片高级版，固定最多 5 个按钮。它不是传统 actionCard URL 导航按钮。

在当前机器人所属应用的卡片平台创建模板，建议本次使用两个固定按钮。在模板数据变量中添加以下字段。模板编辑器的变量类型与 API 的序列化类型要分开：`text` 必须创建为 **富文本/Markdown 内容** 变量，其余为 **普通文本** 变量。富文本组件的“使用变量”菜单不会列出普通文本变量；若已误建普通文本 `text`，先将其改为富文本类型再绑定。

| 字段 | 用法 |
|---|---|
| `title` | 标题组件内容绑定此变量 |
| `text` | **富文本/Markdown 内容类型**；正文组件“使用变量”选择此变量 |
| `button0_label`、`button1_label` | 对应按钮文案绑定变量 |
| `button0_payload`、`button1_payload` | 对应按钮回传请求参数值绑定变量 |
| `button0_visible`、`button1_visible` | 对应按钮显示条件：变量等于字符串 `true` |

`cardData.cardParamMap` 在 API 中仍是 `Map<String, String>`：`text` 的值直接传 Markdown 字符串，例如 `"text": "**确认**\n正文"`，不要把它变成富文本 JSON 对象，也不要额外 JSON.stringify 成带引号的字符串。模板中的富文本类型决定组件如何解释这个字符串；适配器现有 `Record<string, string>` 编码合同保持不变。

每个按钮的点击事件选择 **回传请求**。回传参数名为 `action`，参数值类型选择变量，第一按钮绑定 `button0_payload`，第二按钮绑定 `button1_payload`。不要配置 URL 跳转，不要把变量名写成常量。缺少按钮时适配器传 `visible=false`，固定模板必须据此隐藏；超出固定按钮数量会在发送前拒绝。

保存模板，复制模板 ID（通常以 `.schema` 结尾），关联同一应用；按官方 API 权限说明给应用授予“互动卡片实例写权限”。无需配置公网卡片 HTTP 回调 URL，适配器使用 Stream CALLBACK topic `/v1.0/card/instances/callback`。

配置在 endpoint（或同形顶层）增加：

```yaml
mode: stream
cardTemplateId: ${DINGTALK_CARD_TEMPLATE_ID}
cardButtonCount: 2
```

`cardButtonCount` 范围为 1–5，默认 2。模板实际按钮数量必须与配置一致。增加按钮时按相同模式添加 `button2_*` 等字段。本指南不要求改 `.env`；启动时可注入环境变量，但项目 YAML 必须引用它。

出站文本/Markdown加一个 canonical keyboard 被编码为该模板 `cardParamMap`，调用官方 `createAndDeliver`，关闭转发。群聊使用当前入站 conversationId，私聊使用入站 senderStaffId；没有当前入站上下文时拒绝。只有返回匹配 outTrackId、spaceType、spaceId 的成功投递结果才返回发送成功。

回调必须来自当前 endpoint 保存的已投递 card，匹配 space、corp（原入站存在时）、userIdType=1，私聊还必须匹配原 senderStaffId；action 必须等于该卡片已发送的某个 payload。它映射为 canonical action segment，保留源 outTrackId、真实 conversation 和 actor，然后 await Core 接纳再 ACK。群聊点击者不会继承原发送者管理员权限。卡片关联上限 1024、有效期 1 小时，仅当前 generation 有效；重启/HMR 后旧卡片不能进入新代，不承诺跨进程持久恢复。

实机验收应发送包含明确样本号的正文和两个按钮，观察显示、点击后 Core 业务确认，并校验同账号/同会话/同源卡片。API 成功或截图上出现按钮都不等于 callback 验收通过。

依据：[官方 Markdown 变量说明](https://open.dingtalk.com/document/orgapp/markdown-variable-new)、[官方卡片回调教程](https://opensource.dingtalk.com/developerpedia/docs/explore/tutorials/stream/bot/go/card-callback/)、[官方 Stream 协议](https://opensource.dingtalk.com/developerpedia/docs/learn/stream/protocol/)、[官方 SDK 创建投递实现](https://github.com/open-dingtalk/dingtalk-stream-sdk-python/blob/main/dingtalk_stream/card_replier.py)、[官方 SDK 回调模型](https://github.com/open-dingtalk/dingtalk-stream-sdk-go/blob/main/card/model.go)。
