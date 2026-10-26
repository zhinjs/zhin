---
title: "中间件与组件"
description: "用中间件做关键词回复和消息过滤，用 JSX 写图文消息、按钮和卡片，并了解不同平台上的显示效果"
---

# 中间件与组件

要在渲染前按会话选择文本表达，见[定制内置展示](./behavior-customization.md)。

- **中间件**是每条消息都会经过的拦截器，适合关键词回复、过滤、审核。
- **组件**是可复用的消息卡片，用 JSX 编写。

命令、中间件和组件都可以直接返回 JSX：同一份内容，在支持图片的平台显示为图片，在其他平台自动降级为文字。

## 中间件

### 关键词回复

```ts
// middlewares/keyword-reply/index.ts
import { defineMiddleware } from 'zhin.js/middleware';
import type { Message } from 'zhin.js';

export default defineMiddleware<Message>({
  handle({ input }, next) {
    if (input.content === '状态') return '在线';
    return next();
  },
});
```

用户发送"状态"时 Bot 回复"在线"；其他消息通过 `next()` 交给后面的中间件和命令。`input` 就是收到的消息，常用的有 `content`（文字内容）、`sender`（发送者）和 `$reply()`。

### 返回值决定了会发生什么

| 写法 | 结果 |
| --- | --- |
| `return '在线'` 或 `return <text>在线</text>` | 不再往下传，直接用这个内容回复 |
| `return next()` | 交给后面处理，沿用后面产生的回复 |
| `await next()`，不返回 | 同上 |
| `await next(); return <text>OK</text>` | 先让后面处理，再把它的回复**替换**成你的内容 |
| 不调用 `next()`，也不返回 | 吞掉这条消息，不回复 |

- 整条链走完后才会**自动回复一次**；如果中途用 `$reply()` 手动发送，可以发多次，且之后无法撤回。
- 每个中间件最多调用一次 `next()`。它的返回值只用于往回传递，不是可修改的消息对象。
- 命令匹配成功但没有返回内容，也视为"已处理"，不会再交给 AI。

### 控制执行顺序

```ts
export default defineMiddleware<Message>({
  phase: 'before-dispatch', // 默认；或 'after-dispatch'
  order: 10,                // 默认 0，越小越先执行
  handle({ input }, next) { /* ... */ },
});
```

排序依次比较：`phase` → `order` → 插件挂载顺序 → 能力 id。

中间件的参数还包括 `config`（本插件配置）、`use(token)`（取用插件服务）、`owner`、`generation`。声明 `adapter` 后，`$client` 会带上该平台 SDK 的类型。

### 改写或拦截 Bot 发出的消息

设置 `target: 'outbound'` 后，中间件处理的是**即将发出**的消息：

```tsx
// middlewares/review/index.tsx
import { defineMiddleware } from 'zhin.js/middleware';
import type { OutboundEnvelope } from 'zhin.js/core/runtime';

export default defineMiddleware<OutboundEnvelope>({
  target: 'outbound',
  async handle({ input }, next) {
    input.replace(<text>经过审核的内容</text>); // 改写内容
    await next();                               // 不调用 next() 就不会发送
  },
});
```

出站中间件不通过返回值改写，而是调用 `input.replace()`。`input.payload` 是当前将要发给平台的内容，适合审核和拦截；替换后的内容同样会经过渲染和平台校验。

## 用 JSX 写消息

### 准备工作

在项目 `tsconfig.json` 中设置：

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "zhin.js"
  }
}
```

然后把文件保存为 `.tsx`，例如 `commands/card/index.tsx`。`npm create zhin-app` 生成的项目已经配置好。这里的 JSX 是 Zhin 自己的实现，**与 React 无关**。

### 图文混排

小写标签都是内置的消息元素，不需要 import：

```tsx
// commands/hi/index.tsx
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  execute: () => <>
    你好
    <image src="https://example.com/photo.png" />
    <mention target="123" />
  </>,
});
```

一条消息按顺序包含：文字、图片、@某人。常用标签有 `text`、`image`、`mention`、`face`、`audio`、`video`、`file`、`reply`、`forward`、`link`、`qrcode`、`markdown`、`keyboard`、`tts` 等，全部列表见 [参考 · 内置标签](#内置标签)。

### 按钮

```tsx
<button onClick={(message) => <>
  <text>已点击</text><mention target={message.sender!.id} />
</>}>查看结果</button>
```

用户点击后，`onClick` 在原会话里执行，返回的内容会自动回复。支持原生按钮的平台显示按钮，不支持的平台显示为编号选项（"回复 1 查看结果"）。

::: details 按钮的更多规则
- `onClick` 返回字符串、消息段或 JSX 时自动回复一次；返回 `null`、`undefined` 或布尔值不发送；数字 `0` 会回复 `0`。也可以在回调中调用 `message.$reply()`。
- 回调只对原会话和当前版本有效：一小时后、插件热重载或进程重启后失效。
- 要限制谁能点，在回调里判断 `message.sender`。
- 降级编号在运行期间递增，不会复用旧编号；多个会话交错时可能跳号，但各会话互不干扰。相邻的 `<button>` 会合并为一组编号。
- 回调函数不会发送到平台；框架会绑定一个随机标识，支持原生按钮的平台通过 callback 回传。
:::

### 带样式的卡片

安装组件库 `pnpm add @zhin.js/components`，把卡片放进 `<html>` 里：

```tsx
// commands/status/index.tsx
import { defineCommand } from 'zhin.js/command';
import { Card, CardHeader, Badge } from '@zhin.js/components';

export default defineCommand({
  execute: () => (
    <html><Card>
      <CardHeader title={<strong>服务状态</strong>} badge={<Badge>在线</Badge>} />
      <p>运行正常</p>
    </Card></html>
  ),
});
```

`<html>` 里的内容会被渲染成 HTML；在不能直接显示 HTML 的平台上，安装了 `@zhin.js/html-renderer` 就转成图片，否则降级为文字。见下文 [不同平台上的效果](#不同平台上的效果)。

组件库不依赖 React 或截图引擎。主题通过 `ThemeProvider` 统一设置（配色、字体、圆角、阴影等），局部用 `custom.style`、`custom.text` 覆盖。完整组件列表见 [组件库说明](https://github.com/zhinjs/zhin/blob/main/packages/toolkit/components/README.md)。

::: warning 不支持 CSS 文件
服务端 TSX 只做 JSX 转译，**不能 `import './card.css'`**，也不支持 CSS Modules、Sass、Less、PostCSS。请使用内联 `style`（对象或字符串）、主题，或下面的 Tailwind 工具类。
:::

### 表格、Markdown 与代码块

```tsx
import { Table, Checkbox, Switch, Button, Markdown, CodeBlock } from '@zhin.js/components';

const report = <Table
  headers={['任务', '完成', '通知', '操作状态']}
  rows={[
    [<strong>发布验收</strong>, <Checkbox checked label="通过" />,
      <Switch checked label="开启" />, <Button disabled>等待上线</Button>],
  ]}
/>;

const article = <Markdown source={'## 验收记录\n\n- [x] 冒烟通过\n- [ ] 等待上线'} />;
const snippet = <CodeBlock language="typescript" title={<strong>plugin.ts</strong>}
  source={'const ready = true;\nconsole.log(ready);'} />;
```

- `Checkbox`、`Radio`、`Switch`、`Button` 只用于**展示**状态，没有点击事件。需要交互请用上面的 `<button onClick>`。
- `Markdown` 把字符串渲染成带主题的标题、列表、引用和表格；代码块交给 `CodeBlock`（语言标签、高亮、可选行号）。
- 也可以用 `TableRow`、`TableCell` 自由组合表格，`List` 支持有序 / 无序和嵌套列表。

### Tailwind 工具类

```bash
pnpm add @zhin.js/tailwind
```

```tsx
import { createTailwindStyle } from '@zhin.js/tailwind';
import { Card } from '@zhin.js/components';

const tw = await createTailwindStyle({
  theme: { '--color-brand': '#2563eb' },
});

const card = (
  <Card custom={{ style: tw('p-6 rounded-2xl bg-white shadow-lg') }}>
    <div style={tw('flex flex-col gap-4')}>
      <span style={tw('text-xl font-semibold text-brand')}>服务状态</span>
      <span style={tw('text-sm text-slate-600')}>全部运行正常</span>
    </div>
  </Card>
);
```

`tw()` 把类名编译成内联样式，可以用在 `style`、`custom.style` 或主题里。支持布局、间距、尺寸、字体、颜色、圆角、边框、阴影等静态样式；`hover:`、`md:`、`group-*`、`space-*` 这类交互、响应式或跨元素的写法无法转成内联样式，会明确报错。元素间距请用 `gap`。详见 [Tailwind 包说明](https://github.com/zhinjs/zhin/blob/main/packages/toolkit/tailwind/README.md)。

## 注册组件

把常用的卡片注册成组件，在任何命令里按名字调用：

```tsx
// components/status-card/index.tsx
import { defineComponent } from 'zhin.js/component';
import type { JSXRenderable } from 'zhin.js/jsx';
import { Card, CardHeader, KvTable } from '@zhin.js/components';

interface Props {
  title: JSXRenderable;
  rows: readonly { label: JSXRenderable; value: JSXRenderable }[];
}

export default defineComponent<Props>({
  render: ({ title, rows }) => <html><Card><CardHeader title={title} /><KvTable rows={rows} /></Card></html>,
});
```

调用方式：

```ts
import { component } from 'zhin.js/component';
return component('status-card', { title: 'my-bot', rows: [{ label: 'RSS', value: '42MB' }] });
```

在 `.tsx` 里，注册过的组件也可以直接当标签用，不需要 import：

```tsx
// components/music/index.tsx
import { defineComponent } from 'zhin.js/component';

export default defineComponent<{ title: string; url: string; audio?: string }>({
  render: (props) => <share {...props} />,
});

// commands/song/index.tsx
// execute: () => <music title="海阔天空" url="https://music.163.com/#/song?id=387717" />
```

- 组件名从当前插件开始，逐级向父插件查找；子插件可以覆盖同名组件。内置标签名保留给框架。
- 提供 `previewProps` 后，Console 可以用这份示例数据预览组件。
- `title`、`label`、`value` 这类展示位接受 `JSXRenderable`：文本、数字、JSX、数组、异步内容或空值都可以。

## 不同平台上的效果

| 内容 | 平台能直接显示 HTML（如 Sandbox、Email） | 安装了 `@zhin.js/html-renderer` | 都没有 |
| --- | --- | --- | --- |
| `<html>` 里的卡片 | 原样显示 HTML | 渲染成 PNG 图片 | 降级为文字 |
| 图片、@、按钮等消息元素 | 按平台能力发送 | 同左 | 同左 |

需要自定义图片宽度或降级文字时：

```ts
import { renderToHtml } from 'zhin.js/jsx';
import { segment } from 'zhin.js';
return segment.html({ html: await renderToHtml(node), width: 640, text: '服务在线' });
```

- 缺少渲染器、截图失败或平台无法发送图片时，会在发送前降级为文字；平台发送失败后**不会**再补发文字，避免重复。
- 空 JSX 不发送消息；JSX 求值出错会记为发送失败，不会把异常堆栈发到聊天里。

## 参考

### 内置标签

小写标签对应消息段类型，属性对应消息段数据，带有类型提示：`text`、`image`、`mention`、`face`、`audio`、`video`、`file`、`record`、`voice`、`reply`、`forward`、`share`、`dice`、`rps`、`card`、`keyboard`、`action`、`markdown`、`link`、`qrcode`、`tts`，以及带回调的 `button` 和 HTML 边界 `html`。

- `<image src={...}>` 接受 URL、路径、base64 或 `MediaRef`，也可以直接传 `<image media={...} />`。
- `<card {...payload} />` 是平台原生卡片，交给适配器处理；它**不是**组件库里的 `Card`。
- `<markdown>` 输出 Markdown 消息段；它**不是**组件库里的 `Markdown`。

### 中间件上下文

| 字段 | 说明 |
| --- | --- |
| `input` | 入站时是 `Message`；`target: 'outbound'` 时是可 `replace()` 的 `OutboundEnvelope` |
| `config` | 本插件配置 |
| `use(token)` | 取用插件服务 |
| `owner` / `generation` | 所属插件与当前版本号 |
| `$client` | 声明 `adapter` 后，为该平台的原生客户端类型 |

## 深入

::: details 类型推导与 JSX 细节
- `zhin.js/middleware` 的 `defineMiddleware` 默认为入站 `handle` 提供 `Message` 类型，出站提供 `OutboundEnvelope`，常见场景不需要手写类型断言。底层 `@zhin.js/middleware` 保持通用的 `unknown` 默认输入；非 IM 的 Host 调用不会凭空生成消息。Handler 的 `interaction` 可能缺失，使用前要检查。
- 服务端约定入口支持 `commands/**/index.tsx`、`middlewares/<name>/index.tsx`、`components/<name>/index.tsx`；开发时由 CLI 转译 JSX，生产模式使用编译产物。浏览器端的 Console 页面走独立的构建流程。
- HTML 内的文本默认转义，字符串 `'<b>内容</b>'` 始终是文本；只有 `rawHtml()` 或 `<Raw html={...} />` 会插入可信 HTML。
- 普通函数组件 `Foo` 不需要注册，可以返回消息段、文本、JSX、数组、异步结果或 `null`（省略）。HTML 标签和 HTML 展示组件只能放在 `<html>` 内。
- 插件可以扩展 JSX 类型命名空间，为自定义小写标签补充属性提示；运行时遇到未知标签名时必须存在同名注册组件，不会作为未知消息段静默发送。
- 组件 `render(props, context)` 的上下文包含当前执行的 config、use、owner、generation 与调用方；异步执行和热重载不会切换到另一个版本的资源。组件之间可以嵌套调用，深度上限为 32。Console 预览使用同一渲染器，并保留本次请求的版本与取消信号。
- 完整链路：JSX → 有序消息段 → 适配器策略 → 出站中间件 → 平台发送；只有 `<html>` 子树会经过 HTML → `segment.html`。适配器的 `segments.html` 声明为 `direct` 时保留 HTML，`image` 时转 PNG，`text` 时转文字；未声明时能渲染就转图片，否则转文字。`direct` 只影响 HTML，其他消息段照常校验。
- 组件库默认间距为 4/8/12/16/24px；组件外距用 margin、容器内距用 padding。普通块的相邻纵向 margin 会折叠，Flex / Grid 中会相加。Tailwind 类的优先级遵循生成 CSS 的顺序，而不是类名书写顺序；未知类会报错。HTML 与图片渲染（`@pixel.js/shotium`）使用同一份内联样式，字体由渲染环境或显式注册决定。
:::

### 案例：游戏插件的按钮与数字双模式

游戏插件（`plugins/games/*` + `@zhin.js/game-kit`）展示了"内容只写一遍，按平台能力选择呈现"：支持按钮的平台显示键盘，不支持的平台显示 ASCII 棋盘和"回复数字 1-9"的提示。

```ts
// plugins/games/tic-tac-toe/src/board-view.ts（节选）
return buildGridKeyboard({
  gamePrefix: TTT_PREFIX,
  sessionId,
  rows: 3,
  cols: 3,
  cells: boardToCells(board, highlight),
  statusLine,
  renderAscii: renderTttAscii,
  fallbackHint: '落子：回复数字 1-9（仅空格）',
  postChoices: terminal ? [{ id: 'restart', label: '🔄 再来一局', style: 'primary' }] : undefined,
  channelType,
});
```

按钮的 payload 形如 `ttt:<sessionId>:<cell>`。配套的入站中间件把两条输入路径合并：按钮回调直接用 `parseGridPayload` 解析；纯数字文本先经 `buildGridFallbackMap` 反查成 payload，再走同一个处理函数。

## 下一步

- [命令](./commands.md)：在命令里返回这些内容。
- [约定目录](./conventions.md)：中间件、组件放在哪里。
- [平台适配器](../adapters/index.md)：查看各平台支持哪些消息元素。
