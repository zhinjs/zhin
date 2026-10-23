---
title: Agent 结构化回复
description: 最终回复的 JSON Schema 契约、真实 @ 与统一发送链路
---

# Agent 结构化回复

IM 会话中的 Agent 默认使用 `ai.agent.outputSchema: segments`。模型的最终回复是
受 JSON Schema 约束的对象：`messages` 里每一项是一条聊天消息，按顺序发出；每条消息里
普通文字、@ 和媒体使用同一个有序 `segments` 数组：

```json
{
  "messages": [
    { "segments": [{ "type": "text", "data": { "text": "看了下" } }] },
    { "segments": [
      { "type": "mention", "data": { "target": "123456789" } },
      { "type": "text", "data": { "text": " 是缓存没清，清掉就好" } },
      { "type": "image", "data": { "media": { "kind": "url", "value": "https://example.com/result.png" } } }
    ] }
  ]
}
```

拆成几条由模型决定：通常一条，像人一样先回个反应再说正事时才拆成两三条。后续消息之间
有一小段停顿（按长度 0.4～1.5 秒）。第一条发出后后面某条失败时报告 `partial_delivery`，
不会重发已送达的消息。旧的单条 `{"segments":[...]}` 回复（例如历史记录里的）仍被当作一条消息接受。

用户看到的是平台消息，不会看到 JSON。`mention.data.target` 是该平台的用户 ID。
仅输出文字 `@昵称` 不会产生平台提醒。数组可以交错多个 @、文字和媒体；顺序被保留。
`{"messages":[]}` 表示本次无需回复。Markdown 使用 `data.content`，附件使用 `data.media`。
Markdown 的图片语法和 `@昵称` 不代替独立的 image / mention 段；Markdown 原文交给现有渲染链路处理。

[English](../en/ai/structured-replies.md)

## 身份从哪里来

- 当前发言者：使用当前 Turn context 的 `Sender id`。
- 其他成员：使用当前会话上下文已有的用户 ID，或平台成员查询工具的结果。
- 只有昵称且存在重名，或没有可用查询能力时：用文字段询问澄清，不猜账号。

Schema 校验类型和字段结构，不证明 ID 的真实性或群成员资格；平台查询能力仍受原有
Skill、Tool 和权限边界控制。不会把 peer role、Bot Endpoint ID 自动解释为用户 ID，
也不会为了 @ 注入新的平台权限或全局成员目录。

## 契约与处理流程

```text
模型（JSON Schema）
  → Agent 校验完整 { messages } 对象，按条依次发送
  → 最终 Turn 事件 + ReplyPort 共用同一份消息输出
  → 媒体能力/大小处理
  → Message.$reply / Adapter.sendMessage
  → renderSendMessage → before.sendMessage → Endpoint
```

Schema 从 Core 的 canonical 消息段契约派生，Markdown 渲染扩展使用封闭的 `data.content` 结构。
模型只看到消息段的必填字段，所有对象
关闭额外属性且列出的字段均必填，满足严格结构化输出 Provider 的对象要求。
模型可用的段类型按**本轮回复的 Endpoint** 决定，Schema、提示词与校验器都由同一份类型集合生成：

- Adapter 未声明 `segments.supported` 时：text、mention、markdown、image、audio、video、file、keyboard。
- 声明了 `segments.supported` 时：只提供其中出现的类型（可选 mention、媒体、keyboard、share、dice、rps）；
  text 总是可用，markdown 与 keyboard 在 Endpoint 会降级为文字（`markdown: 'text'` / `interactive: 'text'`）时也可用。

Adapter 还可以用 `segments.model` 为已提供的段声明平台扩展，只注入该平台的提示词与 Schema，不改变全局契约：

```ts
segments: {
  supported: ['text', 'mention', 'image', 'share' /* … */],
  model: {
    share: {
      fields: ['description', 'image', 'audio', 'platform'],   // 允许模型填写的可选字符串字段
      hint: 'renders as a QQ link card. For a song, set audio to the playable link …',
    },
  },
}
```

`fields` 在模型 Schema 中变为必填字符串，模型没有真实值时写 `""`，校验后这些空字段被移除。
`hint` 以 `- share on this platform: …` 追加到该平台的回复提示词。icqq 用它让模型把音乐搜索
工具的结果发成带播放链接与封面的分享卡片；`platform`（qq / netease / kugou / kuwo / migu）由 icqq
映射成对应音乐应用的 appid，模型不需要也不应该填写 `config.appid`。

reply、forward、face 不提供给模型：它们需要平台消息 ID、转发 ID 或表情 ID，模型没有可靠来源。
这样模型选出的段不会在出站投影因“Adapter 不支持该段”被拒发。
可选展示字段、平台扩展和交互回调由工具/渲染器提供，不由最终回复模型制造。
插件和工具的完整消息段契约不变。

| 段类型 | `data` 必填结构 | 用途 |
| --- | --- | --- |
| `text` | `{ text: string }` | 普通文字 |
| `markdown` | `{ content: string }` | 标题、列表、强调、代码块等排版 |
| `mention` | `{ target: string }` | @ 真实平台用户 ID |
| `image / audio / video / file` | `{ media: { kind, value } }` | 图片、语音/音频、视频、文件 |
| `keyboard` | `{ rows: [[{ label, payload }]] }` | 快捷回复按钮，每行最多 5 个；点击即把 payload 作为用户下一条消息发出 |
| `dice / rps` | `{}` | 平台骰子、猜拳 |
| `share` | `{ url: string, title: string }` | 链接分享 |

模型的 keyboard 只写 `label` 与 `payload`；发布时补齐按钮 id、`command` 交互模式和文字降级
（编号列表，回复编号等同点击），与卡片按钮同一套构造。空 keyboard 被丢弃。

媒体 `kind` 为 `url / path / base64 / file`，`value` 分别为链接、本地路径、内联 base64、
平台不透明文件引用。使用已有上下文或工具产出的引用，不编造附件地址。可读取媒体经既有
字节校验识别类型；不可读取、格式不符或超出大小限制时返回附件不可用提示。平台不透明引用
的字节由平台保管，宿主不能据此验证附件大小。

IM 专属输出类型属于 `@zhin.js/agent`，不进入通用 `@zhin.js/ai` 引擎。模型中间的工具调用
继续使用各工具自己的 Schema。进度摘要使用文字；工具步数耗尽后的最终总结继续使用
同一消息 Schema。最终事件、发送、Console 完成预览和日志都读取已校验输出。

## 失败与流式行为

- 严格校验不通过时，先做不花模型调用的宽松处理，处理后的对象仍要通过同一份完整 Schema：
  - JSON 前后带了一句话或 Markdown 围栏、括号多一个或少一个：取出第一个能解析的对象；
  - 完全没有 JSON 的纯文字回复：作为一条文字消息发出；
  - Schema 要求字符串、模型写成整数的 ID（如 @ 的目标）：转成字符串后再校验。
- 仍不合法（字段错误、JSON 被截断等）：最多进行一次仅纠正格式的模型调用，不携带会话历史或业务工具。仍不合法则发送宿主固定失败提示，不发送有效部分或原始 JSON。
- 不静默退回昵称文本。
- 模型把工具调用写成了文字（DeepSeek 的 DSML、`<invoke>`、`<tool_call>` 等）时，这段回复无论在 JSON 里还是纯文字里都不会发出，也不做格式修正，因为改写它等于宣称做了一件没做的事；改为发送宿主固定失败提示。`<text>…</text>` 这类包裹会被拆开，每段作为一条消息。
- 结构化回复完成并校验后才发布可读的最终文本预览；流式过程中不展示半截 JSON。
- 出站文字、Markdown 与段内嵌套字符串仍经过已有的泄漏检查，媒体仍经过能力与附件大小处理。
- Provider 错误及总结调用失败时的固定提示由宿主生成，不要求把错误提示再交给模型编码。
- 格式纠正最多等待 30 秒，遵守当前回合取消信号；超过 32,000 字符的回复不截断纠正。格式失败不会重新执行工具，已经完成的工具副作用不会被重试。
- thinking 不属于最终回答，宽松处理只读回答正文。MiniMax 通过 SDK 的 JSON 响应工具或 JSON 文本返回对象时，都要经过同一份完整 Schema 校验。
- 结构化输出的获取方式按 Provider 决定（`compat.structuredOutput`）：`native` 使用 Provider 的结构化输出 / JSON 模式；`prompt` 把 Schema 写进系统提示词，再宽松解析回答正文。DeepSeek 默认 `prompt`：它的思考模型在 JSON 模式下经常想完只返回空白（实测 8 次中 4 次），不用 JSON 模式时 12 次全部可用。其他 Provider 默认 `native`，遇到 JSON 模式返回空内容的模型可以手动改成 `prompt`：

  ```yaml
  ai:
    providers:
      my-gateway:
        sdk: openai-compatible
        compat:
          structuredOutput: prompt
  ```

默认 IM 模式要求 Provider/模型支持当前 JSON Schema 与工具调用。Provider 不支持时会按
现有调用错误路径报告，不会声称已成功 @。确定要使用纯文本的应用可显式配置
`ai.agent.outputSchema: false`；此模式不把模型文字中的 @ 转成真实提醒。

隔离执行（如子 Agent）和非 IM 入口不继承 IM 预设。传入自定义 Schema 时，输出按该调用方
契约处理，不添加 IM 消息提示词，也不会把任意 JSON 猜成消息段。

## 验证边界

确定性测试使用模拟 Provider 验证 Schema 下发、工具后最终回复、多个 @ 顺序、媒体策略、
非法结构整体拒绝、总结恢复、泄漏检查及终态输出。它们不等同于真实群聊提醒、各平台
客户端展示或所有 Provider 的线上兼容性验证。
