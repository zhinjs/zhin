# @zhin.js/component

Zhin Plugin Runtime 的 Component Feature。它从 `components/**/*.ts(x)` 发现纯渲染定义，
按请求 Plugin 解析最近 owner override，并通过统一 IM 出站链路生成内容。

```ts
import { defineComponent } from '@zhin.js/component';

export default defineComponent({
  render: (props: { text: string }) => props.text,
});
```

Node 运行时不执行 TSX；客户端构建 adapter 负责静态产物。Component execution context
只读取当前 snapshot 的 Config 与 Resource，不维护模块级 registry。

验证：`pnpm --filter @zhin.js/component test && pnpm --filter @zhin.js/component build`。

出站契约见 [目标架构](../../../TARGET-ARCHITECTURE.md)。
