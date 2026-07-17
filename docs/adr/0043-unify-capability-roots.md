# ADR 0043: 统一 Capability Root 与声明式文件接口

## 状态

Accepted with amendment；目录与具体 Feature 的 ownership 由 ADR 0048 修订。

## 背景

Zhin 的 Capability 应当具有统一的作者体验、身份、owner 归属和装配链。当前代码只作为领域参考，不作为目标 interface 的约束。

ADR 0042 已确定 Feature 是插件侧装配目录、Capability Ingress 是 Agent 能力进入 Orchestrator 的 seam。本 ADR 定义 Feature 之前的唯一文件创作面，并把 Middleware、Command 与 Component 纳入同一模型。

## 决策

### D1. 两类 Capability Root 使用同一契约

框架只从两类 Capability Root 发现能力：

- 项目根目录，owner 为 Root Plugin。
- 已加载插件的包根目录，owner 为对应 Plugin。

两类根目录使用完全相同的结构：

```text
<capability-root>/
├── schema.json
├── pages/
│   ├── <page>.ts|tsx
│   ├── $nav.tsx
│   └── $footer.tsx
├── commands/**/<command>.ts|tsx
├── components/<component>.ts|tsx
├── middlewares/<middleware>.ts
├── agents/<name>.agent.md
├── skills/<skill>/SKILL.md
├── tools/<tool>.ts
└── mcp/<name>.ts
```

这些是官方标准 Feature provider 的默认写入格式，不是 Kernel 内建列表。第三方 Feature 可以声明新的目录与 definition contract，详见 ADR 0048。

`schema.json` 是 Capability Root 所属 Plugin 的 Config Resource contract，不计入八类 Feature。其层级组合、默认值物化和 ConfigView 规则由 ADR 0045 定义。

### D2. 路径是 local identity

- Page localName 来自 `<page>.ts|tsx`。
- Layout localName 是保留文件 `$nav.tsx` 或 `$footer.tsx` 对应的 `nav`、`footer`。
- Command localName 来自 `commands/` 下不含扩展名的相对路径；例如 `gh/issue/list.ts` 是 `gh/issue/list`，Runtime 命令词是 `gh issue list`。末尾文件也可使用 `[name:string|number|boolean=default].ts(x)` 声明类型化参数；例如 `gh/pr/[title:string=defaultTitle].ts` 编译为稳定 localName `gh/pr/$title` 与 Runtime pattern `gh pr [title]`。参数语法、类型转换和字面命令优先级均由 Command Feature 负责，Kernel 只校验 canonical Capability 身份。
- Component localName 来自 `<component>.ts|tsx`。
- Middleware localName 来自 `<middleware>.ts`。
- Agent localName 来自 `<name>.agent.md`，identity 移除完整 `.agent.md` 后缀。
- Skill localName 来自 `<skill>` 目录。
- Tool localName 来自 `<tool>.ts`。
- MCP localName 来自 `<name>.ts`。

Canonical identity 是 `(ownerPlugin, featureId, localName)`。项目根能力可投影为 bare runtime name；插件能力进入全局命名空间时，由框架生成 qualified runtime name。不同 owner 的同名能力不通过扫描顺序覆盖。

Command `pattern` 和 Component 展示名属于各自运行时 interface，不参与 Capability identity。

### D3. TypeScript Capability 使用纯 definition interface

Zhin 提供：

- `definePage()`
- `defineCommand()`
- `defineComponent()`
- `defineMiddleware()`
- `defineAgentTool()`
- `defineMcp()`

五个函数只验证并标记 definition，不定位 Plugin、不写 Feature、不产生注册副作用。

Page 模块默认导出浏览器组件，并以可选的 `meta` named export 提供 `definePage()` metadata。路由不由 metadata 指定，而是由 owner 与文件路径生成；详细契约见 ADR 0046。

```ts
// commands/hello.ts
import { defineCommand } from 'zhin.js';

export default defineCommand({
  pattern: 'hello <name:word>',
  description: '打招呼',
  async execute({ params }) {
    return `Hello, ${params.name}!`;
  },
});
```

```tsx
// components/user-card.tsx
import { defineComponent } from 'zhin.js';

export default defineComponent<{ name: string }>(({ name }) => (
  <message>{name}</message>
));
```

```ts
// middlewares/trace-message.ts
import { defineMiddleware } from 'zhin.js';

export default defineMiddleware({
  phase: 'before-dispatch',
  order: 0,
  async handle({ message, logger }, next) {
    const startedAt = performance.now();
    try {
      await next();
    } finally {
      logger.debug({ messageId: message.id, elapsedMs: performance.now() - startedAt });
    }
  },
});
```

标准 Middleware Feature 通过必填归一化的 `target` 区分 `inbound` 与 `outbound` typed context。Agent event、HTTP 等其它协议不得仅因都采用洋葱模型而共用该 definition；它们应在各自领域拥有独立 Feature 与 interface。

Middleware chain 按 `(phase, order, owner topology order, identity)` 确定性排序。同一 Runtime snapshot 内链顺序不变；一次局部热更以新 generation 整体发布重新 compose 后的链，不在进行中的消息里替换函数。

```ts
// tools/weather.ts
import { defineAgentTool } from 'zhin.js/agent';

export default defineAgentTool({
  description: '查询天气',
  inputSchema,
  async execute({ city }) {
    return getWeather(city);
  },
});
```

### D4. 注入表示 owner 归属

Feature provider 由 Root 根据静态 package manifest 解析并按 `FeatureId` 去重。provider 的 discoverer 把 definition 写入 owner-bound Slot。Plugin dispose/reload 以 owner 为单位原子撤销或替换贡献。

因此“注入对应插件”表示能力归属与生命周期绑定，不表示每个插件维护独立 Feature 实例。

### D5. 发现器只写 Feature

目标装配链是：

```text
Capability Root
  -> enabled Feature provider discoverer
  -> owner-bound Capability Slot
  -> runtime snapshot or Capability Ingress
  -> Runtime Authority
```

- PageFeature 由 Console Router 与 Navigation 消费。
- LayoutFeature 由 Console Shell 消费。
- CommandFeature 由 Message Dispatcher 消费。
- ComponentFeature 由 Outbound Renderer 消费。
- MiddlewareFeature 由 Inbound Runner 消费。
- AgentFeature、SkillFeature、ToolFeature、MCPFeature 经 Capability Ingress 进入 Agent Orchestrator。

`addRoute()`、`addPage()`、`addMiddleware()`、`addCommand()`、`addComponent()`、`addTool()` 不属于目标作者 interface。框架内部通过 Feature interface 完成装配。

### D6. 当前实现只作为参考

当前 `index.ts + add*`、`agent/`、`*.tool.md`、分形 `agent.ts` 和其它发现路径不属于目标架构。目标实现不承担读取、迁移或兼容这些格式的义务。

Schedule、Hook、State、Dynamic 及其它领域 Middleware 的声明式文件格式不在本 ADR 范围内；新增时必须遵守相同的 owner、identity 和单一写入面原则。Adapter 与 MCP 格式已由后续绿地实现修订为 `adapters/**/*.ts` 与 `mcp/*.ts`。

## 与既有 ADR 的关系

- 补充 ADR 0042：统一 Capability Feature 之前的作者侧入口。
- 取代 ADR 0039 D1 的 `agent/` 创作面目标。ADR 0039 的 IM、安装分层、安全和 Host 决策继续有效。

## Greenfield 搭建顺序

1. 定义 `CapabilityIdentity`、`CapabilityRoot`、owner 和通用 definition brand。
2. 建立 Feature provider contract，并让官方 Feature 包复用 root 解析、诊断和 owner 绑定管线。
3. 实现 `definePage()`、`defineCommand()`、`defineComponent()`、`defineMiddleware()`、`defineAgentTool()`。
4. 将 definition 写入 owner-bound Slot，并实现 Feature projection 的 replace/dispose。
5. 让 IM Runtime 与 Agent Capability Ingress 只读 Feature snapshot。
6. 最后接入脚手架、构建、发布检查和热重载。

## 后果

### 正面

- 项目能力与插件能力只有 owner 不同，作者只学习一套目录。
- 官方与第三方 Capability 共享 identity、发现、诊断和生命周期模型。
- `index.ts` 回归生命周期和特殊组合，不再承担常规能力清单。
- Feature 是唯一装配目录，Runtime Authority 是唯一执行权威。

### 设计成本

- flat Agent Markdown 必须承载完整 Agent metadata 与 instructions。
- Component TSX 需要统一 JSX runtime 和生产构建规则。
- Command pattern、Component tag 与 Capability identity 必须明确分离。
- 插件 qualified runtime name 必须由框架统一生成。

## 修订

ADR 0048 取代本 ADR 中“八类能力由框架固定”“Feature 由 Root Plugin 内建提供”的部分。保留本 ADR 对纯 definition、owner identity 和单一写入面的决策。

## 参考

- [目标架构 SSOT](../../TARGET-ARCHITECTURE.md)
- [ADR 0042](./0042-capability-features-and-on-demand-ingress.md)
- [ADR 0045](./0045-hierarchical-plugin-config-schema.md)
- [ADR 0046](./0046-convention-pages-and-plugin-navigation.md)
