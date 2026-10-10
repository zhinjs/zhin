# @zhin.js/satori

将 HTML/CSS 转换为 SVG，提供内置字体。聊天协议接入使用 [`@zhin.js/adapter-satori`](../../../plugins/adapters/satori/README.md)。

```bash
pnpm add @zhin.js/satori
```

```ts
import { htmlToSvg, getAllBuiltinFonts } from '@zhin.js/satori';

const svg = await htmlToSvg('<div style="display:flex;padding:20px">服务正常</div>', {
  width: 540,
  fonts: getAllBuiltinFonts(),
});
```

`htmlToSvg` 使用 html-react-parser 和 React 解析 HTML，再调用官方 Satori 布局引擎。支持的 CSS 范围受 Satori 限制；它不是 Chromium，也不执行页面脚本。本包导出 `htmlToSvg`、`sanitizeHtml`、字体函数和类型。

`sanitizeHtml` 清理危险元素、事件属性和危险 URI，保留普通文本与 HTML 样式内容。HTML 嵌套深度上限为 100，超出时抛出 `RangeError`。

Zhin 应用使用 `zhin.js/jsx`；独立工具可直接安装 [`@zhin.js/jsx`](../../im/jsx/README.md)。样式组件请安装可选包 [`@zhin.js/components`](../components/README.md)，先用 `renderToHtml` 序列化，再将 HTML 传给本包。本包不再导出 JSX runtime、字符串模板、组件或底层 Satori 默认函数。

```bash
pnpm add @zhin.js/satori @zhin.js/jsx @zhin.js/components
```

```ts
import { jsx, renderToHtml } from '@zhin.js/jsx';
import { CardCanvas, Card, CardHeader } from '@zhin.js/components';
import { htmlToSvg, getAllBuiltinFonts } from '@zhin.js/satori';

const node = jsx(CardCanvas, {
  children: jsx(Card, { children: jsx(CardHeader, { title: '服务状态' }) }),
});
const svg = await htmlToSvg(await renderToHtml(node), {
  width: 540,
  fonts: getAllBuiltinFonts(),
});
```

普通聊天发送仍通过统一消息链路。SVG 工具不会发送消息；HTML→PNG 的可选 Host 使用 [`@zhin.js/html-renderer`](../html-renderer/README.md)。
