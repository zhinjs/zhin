---
title: 定制内置展示
description: 在 Root 选择命令反馈、菜单排版和按会话区分的消息展示，复用权限、分页及统一发送链
---

# 定制内置展示

把权限拒绝换成自己的文案、重排菜单，或让某个群只收文本，都可以在应用 Root 的 `setup` 中选择策略。无需匹配内置错误字符串，也无需复制命令执行和消息发送流程。

## 选择合适的入口

| 要改的行为 | 入口 | 保留的框架行为 |
| --- | --- | --- |
| 参数错误、权限拒绝、冷却／繁忙反馈 | `commandFeedbackToken`，来自 `zhin.js/command` | 校验、权限、准入结果和业务执行次数 |
| 菜单内容与布局 | `commandMenuPresentationToken`，来自 `zhin.js/command` | 当前插件目录、每页 30 项、翻页与按钮生命周期 |
| 某个会话的 HTML、Markdown、交互文本表达 | `outboundPresentationToken`，来自 `zhin.js/middleware` | 平台能力校验、出站中间件和投递结果 |
| 给最终内容加标识、审核或替换消息 | [出站中间件](./middleware-components.md) | `envelope.replace(...)` 和 `next()` 的既有语义 |

只改菜单标题、背景和颜色时，继续用 [`menuStyle`](./commands.md#查看已加载的指令菜单)。只有需要换布局时才选择 presenter。

## Root 显式选择

下面是可直接放在应用根目录 `plugin.ts` 的示例。保留项目原有 Command、Adapter 等 Feature 配置；示例不会安装平台或发送启动消息。

<<< ../snippets/behavior-customization.ts

第三方库可以导出类型为 `CommandFeedbackRenderer`、`CommandMenuPresenter`、`OutboundPresentation` 的函数，Root 导入后再 `resources.provide(token, implementation)`。安装子插件，或在子插件中提供同名资源，不会覆盖这些全局策略。每个 token 只绑定一次；多个规则在同一个函数里显式组合，未处理的场景返回 `undefined`。

## 命令反馈的输入和输出

`CommandFeedbackRenderer` 接收两项只读数据：

- `feedback`：`status` 为 `invalid`、`denied` 或 `limited`；包含命令名、原命令 owner，以及对应的 `issues/help` 或 `limit`。
- `context`：完整 `conversation`、可用的 `sender`、`clientAdapter` 和当前 `generation`，没有原始消息正文和发送方法。

返回文本、Segment、JSX 或注册组件，也可异步返回。返回 `undefined` 沿用内置反馈。普通命令成功结果、`--help`、未匹配消息和独立的“正在处理中”提示不进入这个策略。

自定义内容由 Root 创作，因此其中注册组件按 Root 的作用域解析；被拒绝命令的执行 owner 和诊断状态保持原值。不能靠展示策略允许本应拒绝的命令，或直接使用另一个子插件实例的私有组件。

## 菜单只负责当前页的排版

`CommandMenuPresenter` 接收 `{ page, conversation, generation }`。`page` 是冻结的页面模型：

| 字段 | 含义 |
| --- | --- |
| `commands` / `plugins` | 本页指令／子插件的 `name`、`description` |
| `commandTotal` / `pluginTotal` | 当前目录总数 |
| `page` / `pages` | 当前页／总页数 |
| `keyword` / `pluginKey` | 菜单关键词／可选的插件路径 |
| `title` / `appearance` | 当前目录标题／已校验的 `menuStyle` |
| `text` / `hint` | 同一页的内置文本和导航提示 |

返回当前页内容即可。首屏和按钮翻页会调用同一个 presenter；原生翻页控件由框架附加，首尾禁用和过期规则不变。自定义布局若使用 HTML，应为 `segment.html` 提供 `page.text` 作为可读退化内容；JSX HTML 样式需要显式 `<html>` / `<Html>` 边界，见 [JSX 与组件](./middleware-components.md)。

菜单目录保持当前规则，**不表示每条命令都已按当前发送者权限过滤**。展示策略也不是权限过滤器，执行和单条帮助仍受原权限规则保护。

## 按完整会话选择表达

`OutboundPresentation` 是同步纯函数，接收 `{ conversation, requester, generation }`，返回：

```ts
{ html: 'text', markdown: 'text', interactive: 'text' }
```

每项可选，值为 `default` 或 `text`。省略、`default` 或整个结果为 `undefined` 都沿用适配器策略；`text` 选择现有可读文本表达。它不能强制平台获得原生 HTML、按钮或图片能力，也不能把其他不支持的消息段任意转成文本。

按目标区别策略时，比较完整的 `conversation.endpoint.id`、`endpoint.adapter`、`kind`、`id`、`parent` 和 `threadId`；不要只用平台名或群号匹配跨账号目标。`requester` 是内容作者的插件 ID，不是聊天用户；发送者信息只在反馈上下文提供。

偏好在一次发送开始时解析一次，`replace(JSX)` 后仍使用该结果。HTML 选择 `text` 时不调用截图渲染器；只读目标预览使用同样的同步决策，但不执行出站中间件、不注册按钮、不发送消息。不要在策略里访问网络或自行发送。

## 回退与生命周期

- 没有绑定或返回 `undefined`：使用内置展示。
- 策略函数抛错（反馈／菜单也包括 Promise 拒绝）：记一条不含正文和异常详情的诊断，使用内置展示，不重新执行业务。
- 返回内容之后的惰性组件渲染、出站审核或平台投递失败：继续使用统一发送链原有错误语义，**不会再次补发默认回复**；`unknown` 不自动重试。
- 在途请求保持其 snapshot，后续请求使用已提交的新 generation。卸载策略恢复默认；取消和旧按钮仍按原生命周期规则处理。

策略函数属于可信应用代码，不是沙箱。API 不提供权限变更、再次执行命令或改投递目标的接口；应用作者仍需避免在回调里自行产生副作用。
