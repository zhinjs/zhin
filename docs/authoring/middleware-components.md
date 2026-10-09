---
title: 中间件与组件
description: 入站结果传递、出站信封改写与统一 JSX/HTML 渲染
---

# 中间件与组件

指令 `execute`、入站中间件 `handle` 和组件 `render` 可以直接返回 JSX。`zhin.js/jsx` 提供同一套 JSX 类型、编译运行时与 `renderToHtml`；`zhin.js/component` 提供注册组件能力。可选样式组件安装 `@zhin.js/components`，它不依赖 React 或截图引擎。

## JSX 创作

项目 `tsconfig.json` 设置 `"jsx": "react-jsx"`、`"jsxImportSource": "zhin.js"`，代码保存为 `.tsx`。服务端约定入口支持 `commands/**/index.tsx`、`middlewares/<name>/index.tsx`、`components/<name>/index.tsx`；CLI 开发 loader 转译 JSX，生产模式使用编译产物。

```tsx
import { defineCommand } from 'zhin.js/command';
import { Card, CardHeader, Badge } from '@zhin.js/components';

export default defineCommand({
  execute: () => (
    <Card>
      <CardHeader title={<strong>服务状态</strong>} badge={<Badge>在线</Badge>} />
      <p>运行正常</p>
    </Card>
  ),
});
```

展示位采用 `JSXRenderable`：支持文本、数字、其他 JSX、数组、异步节点和空值。标题、标签、值等都可组合；颜色、尺寸、百分比等样式或计算参数有各自类型。纯 JSX 函数组件无需注册，异步函数也可以作为标签。文本默认转义；普通字符串 `'<b>内容</b>'` 始终是文本。`rawHtml()` 或 `<Raw html={...} />` 仅用于明确插入可信 HTML。

样式组件通过 `ThemeProvider` 共享配色、字体、背景、圆角、边框、阴影与文案；局部使用 `custom.style`、`custom.text` 覆盖。默认间距为 4/8/12/16/24px，上下、左右分别对称：组件外距用 margin，容器内距用 padding，Divider 也带外距。普通 block 的相邻纵向 margin 可以折叠；Flex/Grid 下会相加。完整配置见 [组件库说明](../../packages/toolkit/components/README.md)。

## 入站中间件

```tsx
import { defineMiddleware } from 'zhin.js/middleware';
import type { Message } from 'zhin.js';

export default defineMiddleware<Message>({
  handle({ input }, next) {
    if (input.content === '状态') return <p>在线</p>;
    return next();
  },
});
```

| 写法 | 行为 |
| --- | --- |
| `return <Card />` | 短路下游，形成自动回复结果 |
| `return next()` | 透传下游结果与作者 |
| `await next()`，无返回值 | 仍透传下游结果 |
| `await next(); return <Card />` | 替换下游尚未发送的自动回复 |
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
    input.replace(<p>经过审核的内容</p>);
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
  render: ({ title, rows }) => <Card><CardHeader title={title} /><KvTable rows={rows} /></Card>,
});
```

调用使用同一组件入口：

```ts
import { component } from 'zhin.js/component';
return component('status-card', { title: 'my-bot', rows: [{ label: 'RSS', value: '42MB' }] });
```

名字沿调用者插件向祖先查找，子插件可覆盖同名组件。`render(props, context)` 的上下文包含当前 operation 的 config、use、owner、generation 和 requester；异步执行和热重载不会切到另一代资源。注册组件可返回另一组件调用，深度上限 32。

组件可提供 `previewProps` 作为 Console 的公开示例数据。Console 预览使用同一 JSX/HTML 渲染器，并保留本次请求的 generation 与取消信号，输出可展示的 HTML 消息段。

## HTML 与平台能力

统一链路为 **JSX → HTML → segment.html → Adapter policy → 出站中间件 → Endpoint**。适配器 `segments.html` 声明 `direct` 时保留 HTML（如 Sandbox、Email）；`image` 时使用可选 `@zhin.js/html-renderer` 输出 PNG；`text` 时转文本。未声明采用可渲染则图片、否则文本的策略。direct 只影响 HTML，其他媒体与交互段照常校验。

需要自定义图片宽度或文本降级内容时：

```ts
import { renderToHtml } from 'zhin.js/jsx';
import { segment } from 'zhin.js';
return segment.html({ html: await renderToHtml(node), width: 640, text: '服务在线' });
```

缺少 renderer、截图失败或平台无法投递二进制图片时，在投递前降级文本。平台上传或发送失败后不追加文本重发，以免重复。空 JSX 不发消息；JSX 求值失败报告投递错误，不把异常堆栈当聊天内容。生成的 HTML 不再执行文本模板。

混合消息使用外部数组，例如 `[<Card />, segment.mention('user-id')]`；JSX 子树内部只表达 HTML，不能隐式塞入平台 Segment。

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
