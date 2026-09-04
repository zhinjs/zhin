# @zhin.js/html-renderer

HTML → PNG/SVG，供 Zhin.js 出站富媒体段（`segment.html` / `segment.markdown`）与可选 `aiTextAsImage` 使用。

现在默认使用 **Shotium（裁剪版 Chromium）** 渲染 PNG，保留 **Satori + Resvg** 作为 SVG 与故障回退路径，因此原有 API 与 SVG 能力不丢失。

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
const svg = await renderer.render('<div>Hello</div>', { format: 'svg' });
```

- `format: 'png'`：优先走 Shotium。
- `format: 'svg'`：保持原有 SVG 输出。
- Shotium 失败时会自动回退到旧渲染链，避免功能丢失。

Core 出站链通过动态 import 自动调用，业务代码通常只需 `segment.html({ html: '...' })`。
