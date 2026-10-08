# 高级消息适用性与验收边界

本表区分协议能力、当前 Zhin 编码和真实客户端证据。`unsupported_operation` 表示当前调用路径不能承载请求，不自动证明平台所有 API 均不支持。`confirmed` 只说明所调用 API 接纳；格式、图片展示、引用关联、按钮点击及撤回效果还需客户端观察。本次表格审查与回归为本地证据，不增加任何实机通过项。

| 平台 / 能力 | 当前实现 | 限制及下一步真实验收 |
| --- | --- | --- |
| Email Markdown / share | Markdown 转 HTML 并附纯文本；share 转标题链接和描述 | 不是邮件客户端原生 Markdown。富媒体 / 应用 share 元数据明确拒绝；收件端核对链接及排版。 |
| Email 按钮 | `interactive: text` 允许文字交互降级；Endpoint 的 keyboard/action 明确拒绝 | SMTP/IMAP 没有本适配器的 Bot 点击回调。HTML 链接可以导航，但不能当 canonical 按钮业务回调。邮箱客户端专属交互扩展尚未实现，不能推断整个邮件生态不支持。 |
| Email 引用 | 当前未映射 canonical reply 到 In-Reply-To / References | RFC 5322 提供线程关联头；不是协议不支持。应明确拒绝未实现段，或先补可验证的 Message-ID 关联合同。不能把普通新邮件成功当原生引用通过。 |
| Email 撤回 | 未声明 recall operation，无 Endpoint 撤回实现 | SMTP 接纳后没有本适配器的通用撤回协议。服务商专属撤回另需 API 与权限合同；删除本地 IMAP 邮件不能证明收件人邮件已撤回。 |
| 钉钉 Markdown / URL 图片 | 原生 markdown 消息；URL 图片以 Markdown 图片语法嵌入 | URL 需可由平台获取。不是原生图片上传；实际显示需客户端观察。path/base64 图片及 audio/video/file 当前请求前拒绝，尚未接入平台媒体上传 API。 |
| 钉钉 share | 原生 link 卡片，title/url/description/image；周围文字并入描述 | 一个消息只承载一张链接卡。audio/artist/duration/config 无当前映射，明确拒绝，避免只发普通链接却确认全部内容。 |
| 钉钉按钮 | 配置应用互动卡片模板并走 Stream 卡片回调 | 固定模板数量、变量与 actor/source-card 校验见 [模板指南](../../plugins/adapters/dingtalk/CARD-TEMPLATE.md)。传统 actionCard 跳转 URL 不等于业务回调；未配模板是配置缺失，不是平台不支持。 |
| 钉钉引用 / 撤回 | canonical reply 明确拒绝；未声明 recall，无 control 实现 | 当前路径未实现。不能据此断言钉钉所有机器人 / 应用消息 API 不具备这些能力；接入前需核验具体消息类型、标识、权限及 API 合同。 |
| NapCat Markdown | direct canonical markdown 明确拒绝 | 官方兼容表只允许双层合并转发中的 Markdown。当前未实现该转发路径，不能把直接出站限制写成平台完全没有 Markdown。 |
| NapCat share / 按钮 | 直接 share/keyboard 明确拒绝 | 官方 share 仅接收；没有当前 canonical 原生按钮回调闭环。JSON 卡片、音乐卡片及小程序扩展不能冒充同一能力已实现。 |
| OneBot11 Markdown / 按钮 | 标准无对应段，直接 canonical markdown/keyboard 明确拒绝 | 桥的私有扩展可能存在；需单独适配和验收，不能泛化标准结论。文字降级不算原生按钮通过。 |
| OneBot11 share | 映射标准 url/title/content/image | 只支持链接 share；富媒体 / 应用元数据明确拒绝。标准支持不能证明某个桥实现，NapCat 是明确反例。 |
| NapCat / OneBot11 引用 / 撤回 | reply message_id→id；recall→delete_msg | 本地映射不证明桥具备权限或实际删除成功；客户端核对被引用及被撤回的确切消息。 |

## 已确认的编码风险

审查发现 OneBot11 与钉钉 share 原先丢弃 audio/artist/duration/config 后仍发送链接，可能让统一回执确认一个语义不完整的请求。本轮在编码前明确拒绝这些未实现字段，保留标准链接卡行为，并覆盖混合文字 + share 的回归。

Email reply 原先落入 formatter 的 default 分支而被丢弃；已交由 Email 负责代理处理，避免与其发送分类改动冲突。引用邮件头实现仍是独立能力，不能仅把拒绝修复称为引用支持。

## 公开依据

- [RFC 5322 第 3.6.4 节：Message-ID / In-Reply-To / References](https://www.rfc-editor.org/rfc/rfc5322.html#section-3.6.4)
- [OneBot11 标准消息段](https://github.com/botuniverse/onebot-11/blob/master/message/segment.md)
- [NapCat 消息兼容表](https://napneko.github.io/develop/msg)
- [钉钉机器人发送消息入口](https://open.dingtalk.com/document/orgapp/robot-send-message)与仓库模板指南。官方页面动态内容不能在本次文本抓取中核验完整媒体、引用及撤回 API；这些项保留为未实现 / 待合同核验，不作平台不支持结论。
