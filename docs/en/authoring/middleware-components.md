---
title: Middleware and components
description: Inbound results, outbound replacements and shared JSX/HTML rendering
---

# Middleware and components

Command `execute`, inbound middleware `handle`, and registered component `render` may return JSX directly. `zhin.js/jsx` provides the shared lazy tree, compiler runtime and `renderToHtml`. `zhin.js/component` provides component registration and calls. Optional visual components live in `@zhin.js/components`, without React or a screenshot engine.

## Author JSX

Set `"jsx": "react-jsx"` and `"jsxImportSource": "zhin.js"` in tsconfig.json. Use `.tsx` entries such as `commands/**/index.tsx`, `middlewares/<name>/index.tsx` and `components/<name>/index.tsx`. The development loader transpiles JSX; production runs compiled output.

Server-side TSX support only transpiles JSX; it is not a stylesheet build pipeline. **Direct `import './card.css'`, CSS Modules and CSS `?raw` imports are unsupported.** Sass/SCSS, Less, Stylus, PostCSS and other style preprocessing or generation are outside its scope. Use inline `style` objects or declaration strings on JSX elements, and `ThemeProvider` / `custom.style` for visual components. Browser Console pages use a separate build pipeline and are outside this server-side TSX contract.

```tsx
import { defineCommand } from 'zhin.js/command';
import { Card, CardHeader, Badge } from '@zhin.js/components';
export default defineCommand({
  execute: () => <Card><CardHeader title={<strong>Status</strong>} badge={<Badge>Online</Badge>} /></Card>,
});
```

Display props use `JSXRenderable`, accepting text, numbers, nested JSX, arrays, asynchronous nodes and empty values. Color, size and calculation parameters retain their specific types. Pure function components need no registration; async functions work as tags. Text is escaped, and plain HTML-looking strings remain text. Use `rawHtml()` or `<Raw html={...} />` only to insert trusted markup explicitly.

`ThemeProvider` shares colors, fonts, backgrounds, radii, borders, shadows and copy. Use `custom.style` and `custom.text` for local overrides. Default spacing uses 4/8/12/16/24px, with equal top/bottom and left/right values: margin separates components, padding spaces container content, and Divider has outer margins. Adjacent vertical margins may collapse in block flow; Flex/Grid margins add together. See the [component library](https://github.com/zhinjs/zhin/blob/main/packages/toolkit/components/README.md) for configuration.

Use `Table` with `headers` and `rows`, or compose `TableRow` and `TableCell` with nested JSX. `Checkbox`, `Radio`, `Switch`, and `Button` are display components: props control checked/disabled states and button variants. They have no click handlers or internal state and provide visual output in both HTML and image messages.

```tsx
import { Table, Checkbox, Switch, Button } from '@zhin.js/components';

const report = <Table
  headers={['Task', 'Complete', 'Notify', 'Action status']}
  rows={[
    [<strong>Release acceptance</strong>, <Checkbox checked label="Passed" />,
      <Switch checked label="Enabled" />, <Button disabled>Awaiting release</Button>],
  ]}
/>;
```

`List` supports ordered/unordered lists and nested display nodes. `Markdown` takes a string `source` and renders themed JSX headings, lists, quotes and tables. Fenced code uses `CodeBlock`, with a language label, syntax highlighting, optional line numbers and wrapping. Use `CodeBlock` directly with a JSX `title`. Raw HTML remains text; Markdown images display their alternative text.

```tsx
import { Markdown, CodeBlock } from '@zhin.js/components';

const article = <Markdown source={'## Acceptance\n\n- [x] Smoke passed\n- [ ] Awaiting release'} />;
const snippet = <CodeBlock language="typescript" title={<strong>plugin.ts</strong>}
  source={'const ready = true;\nconsole.log(ready);'} />;
```


### Static Tailwind utilities

Install optional `@zhin.js/tailwind`; no CSS file or stylesheet build plugin is needed. Initialize once, then use the synchronous `tw()` result with JSX `style`, component `custom.style` or `theme.components`:

```tsx
import { createTailwindStyle } from '@zhin.js/tailwind';
import { Card } from '@zhin.js/components';

const tw = await createTailwindStyle({
  theme: { '--color-brand': '#2563eb' },
});

const card = (
  <Card custom={{ style: tw('p-6 rounded-2xl bg-white shadow-lg') }}>
    <div style={tw('flex flex-col gap-4')}>
      <span style={tw('text-xl font-semibold text-brand')}>Service status</span>
      <span style={tw('text-sm text-slate-600')}>All services are healthy</span>
    </div>
  </Card>
);
```

Single-element static layout, spacing, sizing, typography, colors, borders, radii and shadows use the official Tailwind compiler. Conflicts follow generated CSS order, rather than class-string order. Interaction/responsive variants (`hover:`, `md:`) and selectors across elements (`group-*`, `space-*`) cannot become single-element inline styles and throw explicit errors, as do unknown utilities. Use `gap` or child margins for spacing.

Native HTML and `@zhin.js/html-renderer` (`@pixel.js/shotium`) consume the same inline styles. Images are static; fonts come from the renderer environment or explicit registration. This API does not process `className` or enable `.css` imports, CSS Modules or preprocessors. See the [Tailwind package](https://github.com/zhinjs/zhin/blob/main/packages/toolkit/tailwind/README.md) for the support boundary.

## Inbound results

```tsx
import { defineMiddleware } from 'zhin.js/middleware';
import type { Message } from 'zhin.js';
export default defineMiddleware<Message>({
  handle({ input }, next) {
    if (input.content === 'status') return <p>Online</p>;
    return next();
  },
});
```

| Code | Behavior |
| --- | --- |
| `return <Card />` | Stop downstream and provide an automatic reply |
| `return next()` | Forward the downstream result and its owner |
| `await next()` without return | Still forward the downstream result |
| `await next(); return <Card />` | Replace the pending automatic reply |
| Neither next nor a result | Consume input without an automatic reply |

The complete chain produces one automatic reply. Explicit `$reply()` calls may send several messages; upstream replacement cannot undo them. A matched command returning void remains handled and does not trigger AI. `next()` returns an opaque continuation for forwarding, not an editable message, and may be called once per frame.

Sorting is **phase → order → plugin topology → slot id** within each target. Phase defaults to `before-dispatch`, with `after-dispatch` as the second sorting group; automatic delivery happens after the full chain unwinds. Order defaults to 0. Context includes input, config, use, owner and generation. Declaring an adapter types `$client` for that platform.

## Outbound replacements

```tsx
import { defineMiddleware } from 'zhin.js/middleware';
import type { OutboundEnvelope } from 'zhin.js/core/runtime';
export default defineMiddleware<OutboundEnvelope>({
  target: 'outbound',
  async handle({ input }, next) {
    input.replace(<p>Reviewed content</p>);
    await next();
  },
});
```

Outbound handles return void. Use replace to change content and next to allow delivery. Replacements pass through the shared renderer and platform validation. Payload is the current platform candidate, available for moderation and auditing.

## Registered components

```tsx
// components/status-card/index.tsx
import { defineComponent } from 'zhin.js/component';
import type { JSXRenderable } from 'zhin.js/jsx';
import { Card, CardHeader, KvTable } from '@zhin.js/components';
interface Props { title: JSXRenderable; rows: readonly { label: JSXRenderable; value: JSXRenderable }[]; }
export default defineComponent<Props>({
  render: ({ title, rows }) => <Card><CardHeader title={title} /><KvTable rows={rows} /></Card>,
});
```

```ts
import { component } from 'zhin.js/component';
return component('status-card', { title: 'my-bot', rows: [{ label: 'RSS', value: '42MB' }] });
```

Provide `previewProps` for public Console example data. Console previews use the same JSX/HTML renderer, preserve the request's generation and cancellation signal, and return displayable HTML message segments.

Names resolve from the requesting plugin toward its ancestors, allowing local overrides. Render context contains the operation's config, use, owner, generation and requester. Async execution keeps its original snapshot across hot reload. Registered components may return other component calls, up to depth 32.

## Platform HTML policy

The path is **JSX → HTML → segment.html → Adapter policy → outbound middleware → Endpoint**. Declared `segments.html: direct` preserves HTML (Sandbox and Email); image uses the optional `@zhin.js/html-renderer`; text extracts text. An undeclared policy uses an image when available and text otherwise. Other media and interaction segments are still validated in direct mode.

```ts
import { renderToHtml } from 'zhin.js/jsx';
import { segment } from 'zhin.js';
return segment.html({ html: await renderToHtml(node), width: 640, text: 'Service online' });
```

Missing renderers, rendering failures or unavailable binary delivery fall back before sending. Upload/send failures never trigger an extra text replay. Empty JSX sends nothing; evaluation errors fail delivery instead of appearing as chat messages. Generated HTML never runs text templates again.

Use an outer array for mixed content, such as `[<Card />, segment.mention('user-id')]`. JSX subtrees express HTML, not platform Segments.

## Dual-Mode Degradation in Game Plugins

Game plugins (`plugins/games/*` + `@zhin.js/game-kit`) package "button keyboard + text numbers" as two consumption modes for the same content. Platforms supporting keyboards use button mode: `buildGridKeyboard` / `buildChoiceKeyboard` produce `keyboard` segments, with button payloads in the form `ttt:<sessionId>:<cell>`. Platforms without button capability use text mode: the same message includes an ASCII board and `fallbackHint` (e.g., "Place: reply with numbers 1-9 (empty spaces only)"), and `fallback.map` maps numbers back to payloads.

```ts
// plugins/games/tic-tac-toe/src/board-view.ts (excerpt)
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

The companion inbound middleware normalizes both input paths: direct payloads (button callback converted to text) go through `parseGridPayload`; plain numeric text is reverse-looked-up via `buildGridFallbackMap` into payloads, then processed by the same handler. At this point you can see that middleware and component degradation are two sides of the same idea: **content is written once and rendered according to platform capability**.
