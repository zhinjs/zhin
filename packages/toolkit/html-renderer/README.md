# @zhin.js/html-renderer

HTML → PNG/SVG，供 Zhin.js 出站富媒体段（`segment.html` / `segment.markdown`）与可选 `aiTextAsImage` 使用。

基于 `@zhin.js/satori` + `@resvg/resvg-js`，**不**再作为插件加载。

## 安装

```bash
pnpm add @zhin.js/html-renderer
```

未安装时，Adapter policy 为 `html:'image'` / `markdown:'image'` 的出站会自动 **降级为 text** 并打一次 warning。

## 配置（zhin.config.yml）

```yaml
htmlRenderer:
  defaultWidth: 1080
  defaultBackgroundColor: "#ffffff"
  aiTextAsImage: false   # true 时纯文本出站转 PNG（before.sendMessage）
```

## API

```typescript
import { createHtmlRenderer } from '@zhin.js/html-renderer';

const renderer = createHtmlRenderer({ defaultWidth: 540 });
const png = await renderer.render('<div>Hello</div>', { format: 'png' });
```

Core 出站链通过动态 import 自动调用，业务代码通常只需 `segment.html({ html: '...' })`。

## IM 组件与 Context（安装包后 zhin 启动自动注册）

无需再写 plugins 列表，安装 `@zhin.js/html-renderer` 后启动时自动：

| 能力 | 说明 |
|------|------|
| **`RenderImage` 组件** | 模板/命令中 `<RenderImage html="..." width="540"/>`，异步渲染为 `image` 段 |
| **`html-renderer` Context** | `useContext('html-renderer', (r) => …)` 或 `inject('html-renderer')` |
| **Agent 工具** | `html_render`、`html_card`（需已装 `@zhin.js/agent` 且 tool 服务可用） |

自定义组件仍用 `defineComponent` + `addComponent`；需要转图时在组件内 `inject('html-renderer')` 或返回 `segment.html({ html })` 走出站 policy。
