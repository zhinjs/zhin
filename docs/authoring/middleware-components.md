---
title: 中间件与组件
description: 入站结果传递、出站信封改写与统一 JSX/HTML 渲染
---

# 中间件与组件

指令 `execute`、入站中间件 `handle` 和组件 `render` 可以直接返回 JSX。`zhin.js/jsx` 提供同一套 JSX 类型、编译运行时与 `renderToHtml`；`zhin.js/component` 提供注册组件能力。可选样式组件安装 `@zhin.js/components`，它不依赖 React 或截图引擎。

## IM 上下文类型

`zhin.js/middleware` 的 `defineMiddleware(...)` 默认给入站 `handle` 提供 `Message`；显式 `target: 'outbound'` 时，`input` 默认是可 `replace(...)` 的 `OutboundEnvelope`。无需给常见 IM 中间件手写断言，设置 `adapter` 后 `$client` 仍按该适配器注册的原生 Client 推导。

底层 `@zhin.js/middleware` 保持通用的 `unknown` 默认输入，可显式声明 `undefined`；非 IM Host 调用没有凭空生成的消息。Handler 的 `interaction` 仍可能缺失，调用前应检查它是否存在。

## JSX 创作

项目 `tsconfig.json` 设置 `"jsx": "react-jsx"`、`"jsxImportSource": "zhin.js"`，代码保存为 `.tsx`。服务端约定入口支持 `commands/**/index.tsx`、`middlewares/<name>/index.tsx`、`components/<name>/index.tsx`；CLI 开发 loader 转译 JSX，生产模式使用编译产物。

服务端 TSX 支持只负责 JSX 转译，不包含样式构建。**不支持直接 `import './card.css'`、CSS Modules 或 CSS 的 `?raw` 导入**，也不提供 Sass/SCSS、Less、Stylus、PostCSS 等预处理或生成流程。HTML 标签在 `<html>` 内使用内联 `style`（CSS 对象或声明字符串）；样式组件使用 `ThemeProvider` 和 `custom.style`。浏览器 Console 页面走独立构建链路，不属于此服务端 TSX 承诺。

```tsx
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

HTML 组件的展示位采用 `JSXRenderable`：支持文本、数字、其他 JSX、数组、异步节点和空值。标题、标签、值等都可组合；颜色、尺寸、百分比等样式或计算参数有各自类型。纯 JSX 函数组件无需注册，异步函数也可以作为标签。HTML 内文本默认转义；普通字符串 `'<b>内容</b>'` 始终是文本。`rawHtml()` 或 `<Raw html={...} />` 仅用于明确插入可信 HTML。

样式组件通过 `ThemeProvider` 共享配色、字体、背景、圆角、边框、阴影与文案；局部使用 `custom.style`、`custom.text` 覆盖。默认间距为 4/8/12/16/24px，上下、左右分别对称：组件外距用 margin，容器内距用 padding，Divider 也带外距。普通 block 的相邻纵向 margin 可以折叠；Flex/Grid 下会相加。完整配置见 [组件库说明](https://github.com/zhinjs/zhin/blob/main/packages/toolkit/components/README.md)。

表格可使用 `Table` 的 `headers`、`rows`，或组合 `TableRow`、`TableCell` 放入其他 JSX。`Checkbox`、`Radio`、`Switch`、`Button` 是展示组件：选中、禁用、按钮变体由 props 决定，没有点击事件或内部状态，在 HTML 与图片消息中均用于展示。

```tsx
import { Table, Checkbox, Switch, Button } from '@zhin.js/components';

const report = <Table
  headers={['任务', '完成', '通知', '操作状态']}
  rows={[
    [<strong>发布验收</strong>, <Checkbox checked label="通过" />,
      <Switch checked label="开启" />, <Button disabled>等待上线</Button>],
  ]}
/>;
```

`List` 支持有序／无序列表及嵌套展示节点。`Markdown` 的 `source` 是待解析的字符串，标题、列表、引用和表格会变为主题化 JSX；代码围栏交给 `CodeBlock`，提供语言标签、语法高亮、可选行号与换行。`CodeBlock` 也可直接使用，`title` 接受 JSX。原始 HTML 显示为文本，Markdown 图片显示替代文案。

```tsx
import { Markdown, CodeBlock } from '@zhin.js/components';

const article = <Markdown source={'## 验收记录\n\n- [x] 冒烟通过\n- [ ] 等待上线'} />;
const snippet = <CodeBlock language="typescript" title={<strong>plugin.ts</strong>}
  source={'const ready = true;\nconsole.log(ready);'} />;
```


### Tailwind 静态工具类

按需安装 `pnpm add @zhin.js/tailwind`，无需 CSS 文件或样式构建插件。初始化一次后，`tw()` 同步返回内联样式，直接接入现有 `style`、`custom.style` 或 `theme.components`：

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

支持单元素的静态布局、间距、尺寸、字体、颜色、圆角、边框、阴影等；工具类由官方 Tailwind 编译，优先级遵循生成 CSS 的顺序，并非类名字符串的先后顺序。`hover:`、`md:`、`group-*`、`space-*` 等交互、响应式或跨元素选择器无法变成单元素内联样式，会明确报错，未知类也不会被静默忽略。采用 `gap` 或子组件外距处理元素间距。

HTML 与 `@zhin.js/html-renderer`（`@pixel.js/shotium`）消费同一份内联样式；图片是静态结果，字体由渲染环境或显式注册决定。此接口不接管 `className`，也不启用 `.css` 导入、CSS Modules 或预处理器。范围与限制见 [Tailwind 包说明](https://github.com/zhinjs/zhin/blob/main/packages/toolkit/tailwind/README.md)。

### 原生消息标签与自定义组件

默认 JSX 是消息排版。**内置小写标签无需 import，并提供属性类型提示**：`text`、`image`、`mention`、`face`、`audio`、`video`、`file`、`record`、`voice`、`reply`、`forward`、`share`、`dice`、`rps`、`card`、`keyboard`、`action`、`markdown`、`link`、`qrcode`、`tts`，以及带回调的 `button` 和显式 `html` 边界。标签名对应 `Segment.type`，属性对应 `Segment.data`。`<image src={...}>` 支持 URL、路径、base64 或 `MediaRef`，转换为 canonical `data.media`；也可直接传 `<image media={...} />`。

```tsx
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  execute: () => <>
    hello
    <image src="https://example.com/photo.png" />
    <mention target="123" />
    <button onClick={(message) => <>
      <text>已点击</text><mention target={message.sender!.id} />
    </>}>查看结果</button>
  </>,
});
```

`onClick(message)` 在点击所在会话执行，返回字符串、Segment 或 JSX 就自动回复一次；返回 `null`、`undefined` 或布尔值不发送。数字 `0` 会回复 `0`。开发者也可以在回调中显式调用 `message.$reply()`。回调持有当前 operation 的作者与资源上下文，仅对原会话和当前 generation 有效；回调一小时后或插件重载、进程重启后失效。运行实例统一分配递增的降级编号，后续键盘不会复用旧编号；多个会话交错发送时允许跳号，映射仍按会话隔离。需要限制点击者时，回调按 `message.sender` 判断。函数不会写入平台载荷；框架绑定随机回跳标识，支持原生按钮的平台走 callback，不支持的平台降级为数字选项。相邻 `<button>` 合并为一组编号。

`<card {...platformPayload} />` 传递平台原生卡片载荷，由适配器处理；它不是 HTML 样式组件 `Card`。原生 `<markdown>` 输出 Markdown Segment，也不是 HTML 样式组件 `Markdown`。

注册的命名组件可以直接作为标签，不需要导入：

```tsx
// components/music/index.tsx
import { defineComponent } from 'zhin.js/component';

export default defineComponent<{ title: string; url: string; audio?: string }>({
  render: (props) => <share {...props} />,
});

// commands/song/index.tsx
// execute: () => <music title="海阔天空" url="https://music.163.com/#/song?id=387717" />
```

注册组件仍按当前插件到祖先查找，内置 Segment 名称保留给框架。普通函数 `Foo` 可以决定 `<Foo />` 位置的内容，也可以返回 `null` 省略。JSX 类型命名空间可由插件扩展，以补充自定义小写标签的属性提示；未知名字在运行时必须存在注册组件，不能作为未知 Segment 静默发送。

## 入站中间件

```tsx
import { defineMiddleware } from 'zhin.js/middleware';
import type { Message } from 'zhin.js';

export default defineMiddleware<Message>({
  handle({ input }, next) {
    if (input.content === '状态') return <text>在线</text>;
    return next();
  },
});
```

| 写法 | 行为 |
| --- | --- |
| `return <text>OK</text>` | 短路下游，形成自动回复结果 |
| `return next()` | 透传下游结果与作者 |
| `await next()`，无返回值 | 仍透传下游结果 |
| `await next(); return <text>OK</text>` | 替换下游尚未发送的自动回复 |
| 不调用 next，也无返回值 | 消费输入，不自动回复 |

链结束后自动回复一次。显式 `$reply()` 可以发送多次；上游返回值不能撤销已发送的显式回复。命令匹配但返回 void，仍视为已处理，不因没有返回内容而触发 AI。`next()` 返回值是用于透传的 continuation，不是可修改的消息对象；每层最多调用一次。

同一 target 内按 **phase → order → 插件拓扑序 → slot id** 排序。`phase` 默认 `before-dispatch`，另一值为 `after-dispatch`；它是链中的排序分组，自动发送发生在整个链回卷结束后。`order` 默认为 0。上下文包含 `input`、`config`、`use(token)`、`owner`、`generation`；声明 adapter 后 `$client` 获得该平台类型。

## 出站中间件

```tsx
import { defineMiddleware } from 'zhin.js/middleware';
import type { OutboundEnvelope } from 'zhin.js/core/runtime';

export default defineMiddleware<OutboundEnvelope>({
  target: 'outbound',
  async handle({ input }, next) {
    input.replace(<text>经过审核的内容</text>);
    await next();
  },
});
```

出站 `handle` 不返回消息，通过 `replace()` 改写；不调用 `next()` 即停止投递。替换内容也走统一渲染和平台校验。`payload` 是当前候选平台内容，适合审核和拦截，不能绕过 Endpoint 发送边界。

## 注册组件

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

调用使用同一组件入口：

```ts
import { component } from 'zhin.js/component';
return component('status-card', { title: 'my-bot', rows: [{ label: 'RSS', value: '42MB' }] });
```

名字沿调用者插件向祖先查找，子插件可覆盖同名组件。`render(props, context)` 的上下文包含当前 operation 的 config、use、owner、generation 和 requester；异步执行和热重载不会切到另一代资源。注册组件可返回另一组件调用，深度上限 32。

组件可提供 `previewProps` 作为 Console 的公开示例数据。Console 预览使用同一消息 JSX 渲染器，并保留本次请求的 generation 与取消信号；返回 `<html>` 时输出 HTML 段，普通消息 JSX 则输出相应的 Segment。

## HTML 与平台能力

统一链路为 **JSX → 有序 Segment → Adapter policy → 出站中间件 → Endpoint**；只有 `<html>` / `<Html>` 子树经过 **HTML → segment.html**。适配器 `segments.html` 声明 `direct` 时保留 HTML（如 Sandbox、Email）；`image` 时使用可选 `@zhin.js/html-renderer` 输出 PNG；`text` 时转文本。未声明采用可渲染则图片、否则文本的策略。direct 只影响 HTML，其他媒体与交互段照常校验。

需要自定义图片宽度或文本降级内容时：

```ts
import { renderToHtml } from 'zhin.js/jsx';
import { segment } from 'zhin.js';
return segment.html({ html: await renderToHtml(node), width: 640, text: '服务在线' });
```

缺少 renderer、截图失败或平台无法投递二进制图片时，在投递前降级文本。平台上传或发送失败后不追加文本重发，以免重复。空 JSX 不发消息；JSX 求值失败报告投递错误，不把异常堆栈当聊天内容。生成的 HTML 不再执行文本模板。

混合消息直接用 Fragment：`<>hello<image src="https://example.com/a.png" /><mention target="user-id" /><html><Card /></html></>`，形成一条按顺序排列的图文消息。纯函数组件可返回 Segment、文本、JSX、数组、异步结果或 `null`；空值省略。HTML 标签与 HTML 展示组件只放在 `<html>` 内。

## 游戏插件的双模式降级

游戏插件（`plugins/games/*` + `@zhin.js/game-kit`）把「按钮键盘 + 文本数字」做成同一份内容的两种消费方式。支持键盘的平台走按钮模式：`buildGridKeyboard` / `buildChoiceKeyboard` 产出 `keyboard` 段，按钮 payload 形如 `ttt:<sessionId>:<cell>`。没有按钮能力的平台走文本模式：同一条消息附 ASCII 棋盘和 `fallbackHint`（如「落子：回复数字 1-9（仅空格）」），`fallback.map` 把数字映射回 payload。

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

配套的 inbound 中间件把两条输入路径归一：直接 payload（按钮回调转文本）走 `parseGridPayload`；纯数字文本经 `buildGridFallbackMap` 反查为 payload，再走同一处理函数。到这里就能看出，中间件与组件降级是同一思想的两侧：**内容只写一遍，按平台能力选择呈现**。
