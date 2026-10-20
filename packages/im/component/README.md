# @zhin.js/component

Zhin Plugin Runtime 的 Component Feature。它从 `components/**/*/index.ts(x)` 发现纯渲染定义，
按请求 Plugin 解析最近 owner override，并通过统一 IM 出站链路生成内容。

```ts
import { defineComponent } from 'zhin.js/component';

export default defineComponent({
  render: (props: { text: string }) => props.text,
});
```

服务端 `.tsx` 使用统一 `zhin.js/jsx`，配置 `jsxImportSource: "zhin.js"`。开发 loader 转译，生产运行编译产物。`render` 可直接返回 JSX；通过 `zhin.js/component` 的 `component(name, props)` 调用，Core 统一转 HTML 段并按 Adapter 能力发送。纯 JSX 函数组件不需要注册，可选样式组件使用 `@zhin.js/components`。展示位用 `JSXNode` 支持嵌套布局。

Component execution context 只读取当前 snapshot 的 Config 与 Resource，不维护模块级 registry。

单文件插件可用 `setup({ addComponent })` 注册 `defineComponent(...)`；它与
`components/` 目录发现共享 ComponentIndex 和 owner override 规则。

验证：`pnpm --filter @zhin.js/component test && pnpm --filter @zhin.js/component build`。

出站契约见 [中间件与组件](../../../docs/authoring/middleware-components.md)。

### Interactive preview examples

Components may opt in with `previewProps`, typed as their render parameters. Console uses these public example parameters for a one-click preview through the real render path. This is an example, not a parameter schema or runtime default; normal rendering still uses the caller’s parameters. Omit secrets and personal data. Without an example, Console submits `{}` and reports any render error.

```ts
export default defineComponent<{ name: string }, string>({
  previewProps: { name: "World" },
  render: ({ name }) => `Hello ${name}`,
});
```
