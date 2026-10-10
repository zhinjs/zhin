# @zhin.js/jsx

Lazy JSX elements and the HTML serializer used by `zhin.js/jsx`. The package has no runtime dependencies and does not send messages, access a Plugin generation or take screenshots.

Use `jsxImportSource: "zhin.js"` in a Zhin application. A JSX expression produces a branded element; `renderToHtml` evaluates synchronous or asynchronous function components and preserves nested markup.

```tsx
import { renderToHtml } from 'zhin.js/jsx';

const card = <section style={{ padding: 16 }}><h2>服务状态</h2><p>在线</p></section>;
const html = await renderToHtml(card);
```

Server-side TSX support only transpiles JSX; it is not a stylesheet build pipeline. **Direct `import './card.css'`, CSS Modules and CSS `?raw` imports are unsupported.** Sass/SCSS, Less, Stylus, PostCSS and other style preprocessing or generation are outside its scope. Use inline `style` objects or declaration strings on JSX elements, and `ThemeProvider` / `custom.style` for visual components. Browser Console pages use a separate build pipeline and are outside this server-side TSX contract.

Commands, inbound middleware and registered component renders can return these elements directly; the IM runtime converts each JSX root to an HTML segment. To specify image dimensions or fallback text, use `segment.html({ html: await renderToHtml(card), width: 540, text: '服务状态：在线' })`.

Strings are escaped text, including strings returned from function components. Only explicit `rawHtml(markup)`, `<Raw html={markup} />` or `dangerouslySetInnerHTML={{ __html: markup }}` insert trusted markup. Do not pass user-provided HTML into those raw channels. Intrinsic `script` elements, browser event handlers and React hooks are unsupported.

Fragments and arrays retain child order; promises are awaited. `null`, `undefined` and booleans render nothing, while `0` remains visible. Style objects use camelCase or CSS property names; nonzero numeric lengths acquire `px`, unitless properties and CSS variables do not. SVG case-sensitive names such as `viewBox` are preserved, and aliases such as `strokeWidth` are translated.

Use `JSXRenderable` for a custom component's children or display props, including values produced by calling an asynchronous component directly. An asynchronous component may declare its return type as `Promise<JSXNode>`; its result is accepted by JSX children, arrays, `createElement` and `renderToHtml`.

Cycles, malformed nodes, child content in HTML void elements and component errors reject rendering. `renderToHtml(node, { maxDepth: 100 })` bounds nested elements, components, arrays and promises; 100 is the default.

Run `pnpm --filter @zhin.js/jsx build`, `pnpm --filter @zhin.js/jsx test` and `pnpm --filter @zhin.js/jsx test-type`.
