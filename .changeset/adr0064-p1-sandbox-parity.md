---
"@zhin.js/core": minor
"@zhin.js/adapter": minor
"@zhin.js/client": minor
"@zhin.js/adapter-sandbox": minor
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-telegram": patch
---

ADR 0064 P1：Sandbox 全能力渲染与回归守卫（含 P1b 非段能力）。

- `@zhin.js/core`：新增出站段目录 `OUTBOUND_SEGMENT_CATALOG`（类型名、所属 `messaging.segments.*` 能力、最小合法示例、归一后的类型），canonical 校验的 Core 扩展类型与 IM 投递过滤 `segmentsForImDelivery` 改为从目录派生，三处名单不再漂移；`card` 因此成为 IM 可见段（AI 出站段中的 `card` 不再被过滤）。`html: 'direct'` 的端点收到的 HTML 段没有 `width` 时，Core 盖章设计宽度 540（与 `image` 端点渲染图片的宽度一致，D5）。
- `@zhin.js/adapter`：能力画像 `messaging` 新增 `streaming: { mode, formats? } | false`（`mode` 与端点 `EndpointStreaming.mode` 同名：native / draft / card / edit，`none` 表示不流式；`formats` 为 text / markdown），可按会话类型声明，运行期只能收窄。装配期比较画像与端点 spec 的流式声明，不一致时记 `profile_streaming_mismatch` 警告（D11：先告警，P4 后改为装配失败）。新增导出 `profileStreamingMismatch()` 与类型 `ProfileStreamingMode`。
- `@zhin.js/client`：Markdown 解析器补齐行内图片 `![alt](src)`、嵌套行内格式（链接里的粗体、强调里的链接、`***粗斜体***`、徽章 `[![]()]()`）与嵌套列表；行内扫描改为不回溯的单遍扫描，未闭合的定界符保持线性。图片只接受 http(s) / blob 与栅格图片 base64 data URL（与媒体段同一白名单，拒绝 SVG 与脚本类型），不安全的链接与图片地址原样显示为文字，仍不注入任何原始 HTML。`MarkdownInline` 新增 `image` 与可选 `children`（`value` 始终是纯文本，忽略 `children` 的调用方仍可读），列表项新增可选 `children`；新增导出 `safeMarkdownImageSrc` 与类型 `MarkdownListItem`。IM 可见段补 `card`。
- `@zhin.js/adapter-sandbox`：页面的段渲染拆到 `pages/index/segments/`，导出覆盖整个出站段目录的 `SANDBOX_SEGMENT_RENDERERS`；新增文件卡片（名称、大小、下载链接；base64 以 `application/octet-stream` 下载，不渲染）、链接卡片、本地生成的二维码（与 Core 同一库，SVG，不联网）、TTS（浏览器朗读）；音乐卡片的 `audio` 可直接播放；HTML 卡片没有宽度时按 540 设计宽度排版再等比缩放；合并转发里的段用同一套渲染器显示。兜底渲染只用于历史数据与第三方命名空间段，开发构建中每种类型告警一次。画像声明 `messaging.streaming`（native，text / markdown）、`mention: { user, all }`、`quote`。P1b：端点 control 端口以 `recall` / `edit` / `reaction` 帧实现撤回（含他人消息）、编辑与表情回应（可取消），画像与 `actions` 同步声明，页面就地应用并持久化表情回应；没有在线页面时与发送一样返回未执行。新增依赖 `qrcode`（Core 已依赖，不增加安装体积）。朗读一条 TTS 消息时不会再被另一条消息的清理停掉；畸形的 card / keyboard 数据（`null` 条目、非数组的 rows）跳过该条目，不再让整个页面渲染失败。
- `@zhin.js/adapter-lark` / `-qq` / `-slack` / `-telegram`：画像声明 `messaging.streaming`，与端点已有的流式实现一致（飞书 card、QQ 单聊 native、Slack native、Telegram 私聊 draft），避免新的装配期不一致告警。
- Sandbox 交互与真实平台一致（#1250 评论 6910730259）：
  - `sandbox-action-button-id-dropped`：点击按钮发出的 action 段原先用 payload 顶替了按钮自己的 `id`，按按钮 id 识别按钮的插件（如 `activity:<id>:<n>`）在 Sandbox 里失效。现在与平台回调一致，`id` 是按钮 id、`payload` 是 payload（按钮没有 id 时才退回 payload）。
  - `sandbox-submitted-without-feedback`：「已提交本次选择」只表示已送达。网关处理入站失败（`sandbox_gateway_receive_failed`）时端点把错误推回页面，显示在被点击的卡片旁；页面按消息结局（`/api/conversations/outcomes`）跟踪这次点击，`internal_error` 等失败显示为错误，一段时间内机器人既没有回复也没有结局时提示「没有收到机器人的处理结果」。同一张卡片上的多个按钮点一次后不再全部置灰（只有审批提示仍是单选），已点过的按钮带勾号。
