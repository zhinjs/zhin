# @zhin.js/interaction

Transport-neutral contracts for structured user input. The package has no IM or rendering dependency;
`@zhin.js/core` projects requests to each endpoint's Markdown and interactive controls.

```ts
const result = await context.interaction!.sequence({
  title: '发布配置',
  description: '请完成以下信息后再提交。',
  tip: '每一步都会校验输入。',
  steps: [
    { id: 'environment', type: 'select', title: '目标环境', options: [
      { label: '测试', value: 'staging' as const },
      { label: '生产', value: 'production' as const },
    ] },
    { id: 'replicas', type: 'number', title: '实例数', integer: true, min: 1 },
    { id: 'confirmed', type: 'confirm', title: '确认发布？', default: false },
  ],
});

// { environment: 'staging' | 'production'; replicas: number; confirmed: boolean }
```

Use `ask()` for one step. Supported request types are `text`, `number`, `confirm`, `select`,
`multiselect`, and `list`. Invalid replies keep the same interaction pending until a valid answer,
timeout, abort, or supersession.
