# @zhin.js/html-renderer

HTML → 图片，供 Zhin.js 出站富媒体段（`segment.html` / `segment.markdown`）与可选 `aiTextAsImage` 使用。

现在只使用 **Shotium（裁剪版 Chromium）** 渲染，不再依赖 `satori + resvg`。

## 安装

```bash
pnpm add @zhin.js/html-renderer
```

未安装时，Adapter policy 为 `html:'image'` / `markdown:'image'` 的出站会自动 **降级为 text** 并打一次 warning。

## 配置（zhin.config.yml）

```yaml
htmlRenderer:
  width: 1080
  viewport:
    height: 600
  backgroundColor: "#ffffff"
  scale: 1
  aiTextAsImage: false
```

兼容旧字段 `defaultWidth` / `defaultBackgroundColor` / `defaultFonts`；新后端还支持 `viewport`、`scale`、`timeout`、`waitUntil`、`fontFamily`、`allowFileAccess`、`cacheDir`、`cacheMaxBytes`、`userAgent`、`idleTimeoutMs`、`logStats`。

## API

```typescript
import { createHtmlRenderer } from '@zhin.js/html-renderer';

const renderer = createHtmlRenderer({ width: 540 });
const png = await renderer.render('<div>Hello</div>', { format: 'png' });
const stillPng = await renderer.render('<div>Hello</div>', { format: 'svg' });
```

- `format: 'png'`：优先走 Shotium。
- `format: 'svg'`：为兼容旧调用方，仍可传入，但会返回 `png` 并警告一次。
- `renderJsx()` / `renderComponent()`：继续保留，可直接把 JSX/函数组件转成图片。

Core 出站链通过动态 import 自动调用，业务代码通常只需 `segment.html({ html: '...' })`。
