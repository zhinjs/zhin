# @zhin.js/next-feature-component

下一代 Runtime 的 Component Feature provider。它从 `components/**/*.ts|tsx` 发现纯 render definition，并投影为支持 Plugin override 与 ancestor fallback 的 owner-aware `ComponentIndex`。

> 当前包属于 `feature/next` 绿地实现，版本仍为 `0.0.0` 且未作为稳定 API 发布。

## 目录约定

```text
components/
  status.ts
  forms/
    input.tsx
```

- 递归发现 `components/**/*.ts` 与 `components/**/*.tsx`。
- 目录和文件 basename 使用小写字母、数字与连字符。
- 相对路径形成稳定 localName，例如 `forms/input`。
- 模块必须 default export `defineComponent(...)` 的结果。
- TSX 只是 ModuleRuntime 可编译的作者语法；本包不依赖 React、JSX runtime 或前端 bundler。

## 定义 Component

```ts
import { defineComponent } from '@zhin.js/next-feature-component';

export default defineComponent<{ label: string }, SendContent>({
  render(props, { owner, requester, config, use }) {
    return renderStatus({
      ...props,
      theme: config.theme,
      locale: use(localeToken),
      declaredBy: owner.id,
      requestedBy: requester.id,
    });
  },
});
```

Definition 不限定输出类型。IM Runtime 可以返回 `SendContent`，Console 或其他 Feature 也可以使用自己的结构化结果；Component Feature 自身不依赖任何领域 UI 类型。

## Owner Resolution

```ts
const index = snapshot.projections.get(componentFeatureId);
if (!(index instanceof ComponentIndex)) throw new Error('Component is missing');

const content = await index.render(requesterPluginId, 'forms/input', props);
```

解析从 requester 的 exact owner 开始，沿 Plugin parent 逐级回退到 Root。因此 child 可以覆盖同名 parent Component，也可以继承 ancestor Component。render context 的 `owner/config/use()` 始终属于实际声明者，`requester` 则保留发起 Plugin 身份，避免借用 ancestor Component 时读取错配置或 Resource。

同一 owner/localName 冲突会在 projection prepare 阶段失败，不采用扫描顺序覆盖。

## HMR

修改单个 Component 文件只替换该 Capability Slot 并重建 projection。旧 snapshot lease 保留旧 Component；Plugin setup、Feature provider 和其他 Component 模块不重复加载。

## Plugin Manifest

```json
{
  "dependencies": {
    "@zhin.js/next-feature-component": "^0.0.0"
  },
  "zhin": {
    "features": [
      { "package": "@zhin.js/next-feature-component", "api": "^1.0.0" }
    ]
  }
}
```

## 开发验证

```bash
pnpm --filter @zhin.js/next-feature-component test
pnpm --filter @zhin.js/next-feature-component build
```

## 相关文档

- [Feature Kit](../feature-kit/README.md)
- [IM、Agent 与 Console Runtime](../../../docs/architecture/target-implementation/domain-runtimes.md)
- [Greenfield Bootstrap 状态](../../../docs/architecture/target-implementation/greenfield-bootstrap.md)
