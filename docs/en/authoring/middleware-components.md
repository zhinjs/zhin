---
title: "Middleware & Components"
description: "Use middleware for keyword replies and filtering, write mixed messages, buttons and cards in JSX, and see how they look on each platform"
---

# Middleware & components

For per-conversation preferences before rendering, see [Customize built-in presentation](./behavior-customization.md).

- **Middleware** is an interceptor every message passes through — keyword replies, filters, moderation.
- **Components** are reusable message cards written in JSX.

Commands, middleware and components can all return JSX directly: the same content shows as an image on image-capable platforms and falls back to text elsewhere.

## Middleware

### Keyword replies

```ts
// middlewares/keyword-reply/index.ts
import { defineMiddleware } from 'zhin.js/middleware';
import type { Message } from 'zhin.js';

export default defineMiddleware<Message>({
  handle({ input }, next) {
    if (input.content === 'status') return 'online';
    return next();
  },
});
```

When a user sends "status" the bot replies "online"; everything else goes through `next()` to later middleware and commands. `input` is the incoming message — commonly `content` (text), `sender` and `$reply()`.

### What the return value does

| Code | Result |
| --- | --- |
| `return 'online'` or `return <text>online</text>` | Stop here and reply with this content |
| `return next()` | Pass it on and keep whatever reply comes back |
| `await next()` with no return | Same as above |
| `await next(); return <text>OK</text>` | Let later steps run, then **replace** their reply with yours |
| No `next()` and no return | Swallow the message; no reply |

- The bot **auto-replies once**, after the whole chain finishes. Manual `$reply()` calls can send several times and can't be taken back later.
- Call `next()` at most once per middleware. Its return value is only for passing results back — it isn't a message you can modify.
- A matched command that returns nothing still counts as handled and won't be passed to the AI.

### Control the order

```ts
export default defineMiddleware<Message>({
  phase: 'before-dispatch', // default; or 'after-dispatch'
  order: 10,                // default 0; lower runs first
  handle({ input }, next) { /* ... */ },
});
```

Sorting compares `phase` → `order` → plugin mount order → capability id.

The middleware argument also has `config` (plugin config), `use(token)` (plugin services), `owner` and `generation`. Declare `adapter` and `$client` gets that platform SDK's type.

### Rewrite or block outgoing messages

With `target: 'outbound'`, the middleware handles messages **about to be sent**:

```tsx
// middlewares/review/index.tsx
import { defineMiddleware } from 'zhin.js/middleware';
import type { OutboundEnvelope } from 'zhin.js/core/runtime';

export default defineMiddleware<OutboundEnvelope>({
  target: 'outbound',
  async handle({ input }, next) {
    input.replace(<text>Reviewed content</text>); // rewrite the content
    await next();                                 // without next(), nothing is sent
  },
});
```

Outbound middleware rewrites with `input.replace()` rather than a return value. `input.payload` is the content about to go to the platform — good for review and blocking; replaced content still goes through rendering and platform validation.

## Writing messages in JSX

### Setup

In your project's `tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "zhin.js"
  }
}
```

Then save files as `.tsx`, e.g. `commands/card/index.tsx`. Projects from `npm create zhin-app` are already configured. This JSX is Zhin's own implementation and **has nothing to do with React**.

### Mixed content

Lowercase tags are built-in message elements; no import needed:

```tsx
// commands/hi/index.tsx
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  execute: () => <>
    hello
    <image src="https://example.com/photo.png" />
    <mention target="123" />
  </>,
});
```

One message containing, in order: text, an image, and a mention. Common tags include `text`, `image`, `mention`, `face`, `audio`, `video`, `file`, `reply`, `forward`, `link`, `qrcode`, `markdown`, `keyboard` and `tts`; full list in [Reference · Built-in tags](#built-in-tags).

### Buttons

```tsx
<button onClick={(message) => <>
  <text>Clicked</text><mention target={message.sender!.id} />
</>}>Show result</button>
```

When the user clicks, `onClick` runs in the original conversation and its return value is sent as a reply. Platforms with native buttons show a button; others show a numbered option ("reply 1 to show result").

::: details More button rules
- Returning a string, segment or JSX from `onClick` replies once; `null`, `undefined` or booleans send nothing; the number `0` replies `0`. You can also call `message.$reply()` inside the callback.
- Callbacks are valid only for the original conversation and current version: they expire after an hour, a plugin hot reload, or a process restart.
- To restrict who may click, check `message.sender` in the callback.
- Fallback numbers increase over the process lifetime and are never reused; interleaved conversations may skip numbers but stay isolated. Adjacent `<button>`s are numbered as one group.
- The callback function never goes to the platform; the framework binds a random token, and native-button platforms report it back via callback.
:::

### Styled cards

Install the component library with `pnpm add @zhin.js/components` and put cards inside `<html>`:

```tsx
// commands/status/index.tsx
import { defineCommand } from 'zhin.js/command';
import { Card, CardHeader, Badge } from '@zhin.js/components';

export default defineCommand({
  execute: () => (
    <html><Card>
      <CardHeader title={<strong>Service status</strong>} badge={<Badge>online</Badge>} />
      <p>All good</p>
    </Card></html>
  ),
});
```

Content inside `<html>` is rendered as HTML. On platforms that can't show HTML directly it becomes an image when `@zhin.js/html-renderer` is installed, or text otherwise — see [How it looks on each platform](#how-it-looks-on-each-platform).

The library needs neither React nor a screenshot engine. Set a theme once with `ThemeProvider` (colors, fonts, radius, shadows…) and override locally with `custom.style` / `custom.text`. Full component list: [components README](https://github.com/zhinjs/zhin/blob/main/packages/toolkit/components/README.md).

::: warning No CSS files
Server-side TSX only transpiles JSX — **you can't `import './card.css'`**, and CSS Modules, Sass, Less and PostCSS aren't supported. Use inline `style` (object or string), themes, or the Tailwind utilities below.
:::

### Tables, Markdown and code blocks

```tsx
import { Table, Checkbox, Switch, Button, Markdown, CodeBlock } from '@zhin.js/components';

const report = <Table
  headers={['Task', 'Done', 'Notify', 'Status']}
  rows={[
    [<strong>Release check</strong>, <Checkbox checked label="passed" />,
      <Switch checked label="on" />, <Button disabled>Awaiting release</Button>],
  ]}
/>;

const article = <Markdown source={'## Checklist\n\n- [x] Smoke test passed\n- [ ] Awaiting release'} />;
const snippet = <CodeBlock language="typescript" title={<strong>plugin.ts</strong>}
  source={'const ready = true;\nconsole.log(ready);'} />;
```

- `Checkbox`, `Radio`, `Switch` and `Button` only **display** state and have no click events. For interaction use `<button onClick>` above.
- `Markdown` renders a string into themed headings, lists, quotes and tables; fenced code goes to `CodeBlock` (language label, highlighting, optional line numbers).
- `TableRow` and `TableCell` compose tables freely; `List` supports ordered, unordered and nested lists.

### Tailwind utilities

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
      <span style={tw('text-xl font-semibold text-brand')}>Service status</span>
      <span style={tw('text-sm text-slate-600')}>Everything is running</span>
    </div>
  </Card>
);
```

`tw()` compiles class names into inline styles usable in `style`, `custom.style` or themes. Static layout, spacing, sizing, typography, color, radius, borders and shadows are supported; interactive, responsive or cross-element variants such as `hover:`, `md:`, `group-*` and `space-*` can't become inline styles and throw a clear error. Use `gap` for spacing between elements. See the [Tailwind README](https://github.com/zhinjs/zhin/blob/main/packages/toolkit/tailwind/README.md).

## Registered components

Register a card you use often as a component and call it by name from any command:

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

Call it:

```ts
import { component } from 'zhin.js/component';
return component('status-card', { title: 'my-bot', rows: [{ label: 'RSS', value: '42MB' }] });
```

In `.tsx`, registered components also work as tags without an import:

```tsx
// components/music/index.tsx
import { defineComponent } from 'zhin.js/component';

export default defineComponent<{ title: string; url: string; audio?: string }>({
  render: (props) => <share {...props} />,
});

// commands/song/index.tsx
// execute: () => <music title="Hotel California" url="https://music.163.com/#/song?id=387717" />
```

- Names are looked up from the current plugin up through its parents; a child plugin can override a component of the same name. Built-in tag names are reserved.
- With `previewProps`, Console can preview the component with that sample data.
- Display slots such as `title`, `label` and `value` accept `JSXRenderable`: text, numbers, JSX, arrays, async content or nothing.

## How it looks on each platform

| Content | Platform shows HTML directly (e.g. Sandbox, Email) | `@zhin.js/html-renderer` installed | Neither |
| --- | --- | --- | --- |
| Cards inside `<html>` | Shown as HTML | Rendered to a PNG image | Falls back to text |
| Images, mentions, buttons… | Sent per platform capability | Same | Same |

To set a custom image width or fallback text:

```ts
import { renderToHtml } from 'zhin.js/jsx';
import { segment } from 'zhin.js';
return segment.html({ html: await renderToHtml(node), width: 640, text: 'Service online' });
```

- With no renderer, a failed screenshot, or a platform that can't take images, content falls back to text before sending; after a platform send failure, text is **not** re-sent, to avoid duplicates.
- Empty JSX sends nothing; a JSX evaluation error is recorded as a delivery failure, never posted to chat as a stack trace.

## Reference

### Built-in tags

Lowercase tags map to segment types and their attributes to segment data, with type hints: `text`, `image`, `mention`, `face`, `audio`, `video`, `file`, `record`, `voice`, `reply`, `forward`, `share`, `dice`, `rps`, `card`, `keyboard`, `action`, `markdown`, `link`, `qrcode`, `tts`, plus `button` with callbacks and the `html` boundary.

- `<image src={...}>` takes a URL, path, base64 or `MediaRef`; `<image media={...} />` also works.
- `<card {...payload} />` is a platform-native card handled by the adapter — **not** the library's `Card`.
- `<markdown>` outputs a Markdown segment — **not** the library's `Markdown`.

### Middleware context

| Field | Description |
| --- | --- |
| `input` | A `Message` inbound; an `OutboundEnvelope` with `replace()` for `target: 'outbound'` |
| `config` | This plugin's config |
| `use(token)` | Get plugin services |
| `owner` / `generation` | Owning plugin and current version number |
| `$client` | With `adapter` declared, that platform's native client type |

## Going deeper

::: details Type inference and JSX details
- `defineMiddleware` from `zhin.js/middleware` types inbound `handle` input as `Message` and outbound as `OutboundEnvelope` by default, so common cases need no assertions. The underlying `@zhin.js/middleware` keeps a generic `unknown` default; non-IM Host calls never fabricate a message. A handler's `interaction` may be missing — check before use.
- Server convention entries support `commands/**/index.tsx`, `middlewares/<name>/index.tsx` and `components/<name>/index.tsx`; the CLI transpiles JSX in development and production uses build output. Browser Console pages use a separate build.
- Text inside HTML is escaped by default; the string `'<b>content</b>'` is always text. Only `rawHtml()` or `<Raw html={...} />` inserts trusted HTML.
- Plain function components like `Foo` need no registration and may return segments, text, JSX, arrays, async results or `null` (omitted). HTML tags and HTML display components belong inside `<html>` only.
- Plugins may extend the JSX type namespace with attribute hints for custom lowercase tags; at runtime an unknown tag name must have a registered component — it is never sent silently as an unknown segment.
- A component's `render(props, context)` context holds the current execution's config, use, owner, generation and requester; async work and hot reload never switch to another version's resources. Components may call each other up to a depth of 32. Console preview uses the same renderer and keeps the request's version and cancellation signal.
- Full pipeline: JSX → ordered segments → adapter policy → outbound middleware → platform send; only `<html>` subtrees go through HTML → `segment.html`. An adapter's `segments.html` set to `direct` keeps HTML, `image` converts to PNG, `text` converts to text; when undeclared, it renders to an image if possible and to text otherwise. `direct` affects only HTML; other segments are still validated.
- Library default spacing is 4/8/12/16/24px; margins for outer spacing, padding for inner. Adjacent vertical margins of normal blocks collapse but add up in Flex / Grid. Tailwind priority follows generated CSS order, not class order; unknown classes throw. HTML and image rendering (`@pixel.js/shotium`) share the same inline styles; fonts depend on the rendering environment or explicit registration.
:::

### Case study: games with buttons and numbers

Game plugins (`plugins/games/*` + `@zhin.js/game-kit`) show "write content once, present it per platform capability": button-capable platforms get a keyboard, others get an ASCII board with a "reply 1-9" hint.

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
  fallbackHint: 'Move: reply a number 1-9 (empty cells only)',
  postChoices: terminal ? [{ id: 'restart', label: '🔄 Play again', style: 'primary' }] : undefined,
  channelType,
});
```

Button payloads look like `ttt:<sessionId>:<cell>`. A matching inbound middleware merges both input paths: button callbacks are parsed with `parseGridPayload`; plain digits are mapped back to a payload via `buildGridFallbackMap` and handled by the same function.

## Next steps

- [Commands](./commands.md): return this content from commands.
- [Convention directories](./conventions.md): where middleware and components go.
- [Adapters](../adapters/index.md): which message elements each platform supports.
