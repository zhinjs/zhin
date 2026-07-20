# IM、Agent 与 Console Runtime

Domain Runtime 的共同规则：从一个 RuntimeSnapshot 读取 Slot，建立 generation-scoped 派生索引，解释并执行；不拥有可写 registry。

## 1. Capability Definition

`define*()` 使用稳定字符串标记，不捕获当前 Plugin：

```ts
interface Definition<K extends string> {
  readonly kind: K;
}

export interface CommandDefinition<TConfig = unknown> extends Definition<'command'> {
  readonly pattern: string;
  readonly description?: string;
  execute(context: CommandContext<TConfig>): unknown | Promise<unknown>;
}

export function defineCommand<TConfig>(
  definition: Omit<CommandDefinition<TConfig>, 'kind'>,
): Readonly<CommandDefinition<TConfig>> {
  return Object.freeze({ kind: 'command', ...definition });
}
```

Command Feature provider 同时校验自己的 file convention 与 definition brand。例如 `commands/foo.ts` 默认导出 Tool definition 时直接报 source diagnostic。这是领域 Feature 内部的类型，不是 Kernel 的全局 `CapabilityKind`。

## 2. Execution Context

```ts
export interface CapabilityContext<TConfig = unknown> {
  readonly owner: PluginNodeSnapshot;
  readonly generation: number;
  readonly config: Readonly<TConfig>;
  use<T>(token: Token<T>): T;
}

export function capabilityContext<TConfig>(
  snapshot: RuntimeSnapshot,
  slot: CapabilitySlot,
): CapabilityContext<TConfig> {
  const owner = snapshot.tree.get(slot.owner);
  const resources = snapshot.resources.get(slot.owner);
  if (!owner || !resources) throw new Error(`Broken slot owner: ${slot.id}`);

  return Object.freeze({
    owner,
    generation: snapshot.generation,
    config: snapshot.config.get(slot.owner) as Readonly<TConfig>,
    use<T>(token: Token<T>): T {
      if (!resources.has(token.id)) throw new Error(`Missing resource ${token.id}`);
      return resources.get(token.id) as T;
    },
  });
}
```

Resource inheritance已在 commit 前展开进 owner resource snapshot，因此 Runtime lookup 是一次 Map read，不遍历 Plugin tree。

## 3. Generation Cache

```ts
export class GenerationCache<T> {
  #generation = -1;
  #value?: T;

  get(snapshot: RuntimeSnapshot, build: (snapshot: RuntimeSnapshot) => T): T {
    if (this.#generation !== snapshot.generation) {
      this.#value = build(snapshot);
      this.#generation = snapshot.generation;
    }
    return this.#value as T;
  }
}
```

Cache 可以丢弃重建，不能被外部写入。这是 Runtime 所需索引和 Feature 单一事实源之间的区别。

## 4. IM Middleware

当前 `@zhin.js/middleware` 已实现该切片：递归发现 `middlewares/**/*.ts`，按 phase/order/topology/CapabilityId 排序，并由 `MiddlewareIndex.run()` 在同一 snapshot 上执行 onion compose。重复调用 `next()` 会失败；单文件 HMR 不执行 Plugin setup 或重新 import provider。

```ts
export interface MessageMiddleware<TConfig = unknown> extends Definition<'middleware'> {
  readonly target?: 'inbound' | 'outbound';
  readonly phase?: 'before-dispatch' | 'after-dispatch';
  readonly order?: number;
  handle(
    context: CapabilityContext<TConfig> & { readonly message: Message },
    next: () => Promise<void>,
  ): void | Promise<void>;
}

export function composeMiddleware(
  entries: readonly {
    slot: CapabilitySlot<MessageMiddleware>;
    context: CapabilityContext;
  }[],
  terminal: () => Promise<void>,
): () => Promise<void> {
  return async function run(): Promise<void> {
    let cursor = -1;

    const dispatch = async (index: number): Promise<void> => {
      if (index <= cursor) throw new Error('next() called more than once');
      cursor = index;
      const entry = entries[index];
      if (!entry) return terminal();
      await entry.slot.definition.handle(entry.context as never, () => dispatch(index + 1));
    };

    await dispatch(0);
  };
}
```

Middleware index 先按 target 过滤，再按 `(phase, order, owner topology order, CapabilityId)` 排序。一次 Message 或 send 使用同一 generation 的整条链。

## 5. Inbound Runner 与 Command Dispatcher

当前 `@zhin.js/core/runtime` 已实现 Inbound Runner。`ImRuntime.receive()` acquire 一个 `SnapshotLease`，依次执行 target 为 `inbound` 的 Middleware、MessageDispatcher 与 CommandIndex，并在 finally 释放 lease。处理中提交新 generation 不会替换当前消息使用的 Command、Component、配置或 Endpoint。

MessageDispatcher 只拥有命令前缀和“非 undefined 返回值自动回复”语义。文件层级、动态参数、类型转换、字面量优先和最长命令前缀匹配继续由 `@zhin.js/command` 的 CommandIndex 负责。`/gh issue list open` 匹配 `gh issue list`，`open` 进入 `context.args`，原始 Message 进入 `context.input`。

Command collision 在 projection prepare 阶段诊断；Dispatcher 不根据注册或扫描顺序决定覆盖。`Message.$reply()` 只在当前入站作用域有效，防止 lease 释放后继续引用 retired projection。

## 6. Component 与 Outbound Renderer

`@zhin.js/component` 递归发现 `components/**/*.ts|tsx`，从 requester exact owner 向 Root 做 ancestor fallback。render context 的 owner config/resource 属于实际声明者，并单独保留 requester identity。它不依赖 React 或平台 payload。

`@zhin.js/core/runtime` 的 OutboundRenderer 已把它接入发送链。`component(name, props)` 是惰性调用，`raw(payload)` 是显式平台 payload；数组递归渲染，Component 递归上限为 32。target 为 `outbound` 的 Middleware 可通过 `OutboundEnvelope.replace()` 替换渲染结果，或不调用 `next()` 短路发送。

```ts
export interface ComponentDefinition<P = unknown> extends Definition<'component'> {
  render(props: P, context: CapabilityContext): SendContent | Promise<SendContent>;
}

export interface OutboundRenderer {
  render(content: SendContent, snapshot: RuntimeSnapshot): Promise<PlatformPayload>;
}
```

统一出站路径保持：

```text
Message.$reply / ImRuntime.send
  -> OutboundRenderer
  -> ComponentIndex
  -> outbound MiddlewareIndex
  -> AdapterIndex.send
  -> EndpointInstance.send
```

回复和主动发送没有第二条旁路。平台实现不能从 Command/Component 绕过 Renderer 直接发送结构化内容。

## 7. Adapter 与 Endpoint Runtime

当前 `@zhin.js/adapter` 从 `adapters/**/*.ts` 发现 `defineAdapter()`。`create()` 在 projection prepare 中只构造 inert Endpoint；transport 生命周期由 Feature projection handoff 驱动：

```text
prepare:            candidate.create()
before commit CAS:  previous.close() -> candidate.start()
after commit CAS:   candidate.open()
retired lease=0:    previous.stop()
rollback:           candidate.stop() -> previous.open()
```

Feature projection handoff 排在 Plugin Resource handoff 之后激活、之前 quiesce，保证底层 Resource 的生命周期覆盖 Endpoint。Endpoint 通过 owner Resource 中的 `messageGatewayToken` 上送标准 IncomingMessage；出站只实现 `send({ target, payload })`。

共享网络连接若必须跨 Adapter Slot HMR 存活，应提升为 Plugin Resource，而不是藏在 module global。当前所有 projection 每代重建，因此任意 generation 都会候选化 Endpoint；后续 projection retention 可以优化重连，但不能改变 transaction/admission 语义。

## 8. Agent Capability Index

Tool、Skill、Agent、MCP 已由四个独立 Feature package 表达：

- `tools/<name>.ts` 默认导出 `defineAgentTool()`。
- `skills/<name>/SKILL.md` 是 immutable Skill instructions。
- `agents/<name>.agent.md` 是 immutable Agent instructions。
- `mcp/<name>.ts` 默认导出 provider-neutral `defineMcp()`。

`@zhin.js/agent/runtime` 的 CapabilityIngress 只读四个 generation projection，按 requester owner 应用 nearest-ancestor inheritance，返回 Tool/MCP 执行 handles 与 Skill/Agent descriptors。缺少某个 Feature 时对应列表为空，不建立隐藏 registry。

AgentRuntime 一次 turn lease 一个 snapshot：

```ts
await agentRuntime.runTurn(owner, async (capabilities) => {
  await orchestrator.run({ request, capabilities, generation: capabilities.generation });
});
```

Tool execute 获得声明 owner 的 ConfigView/Resource，不读取 requester 私有值。MCP `create()` 只构造 inert client，`start/stop` 进入 Feature generation handoff；旧 turn 连接随 lease 延迟释放。`runTurn()` 回调结束后，逃逸的 Tool/MCP handles 会失效。

## 9. Schedule 与其它 Runtime

Schedule 遵循同一模式：

```text
Schedule Slot -> generation index -> Schedule Runtime Authority -> timer handles
```

timer handle 是 Runtime 派生资源，必须按 generation diff 启停。Schedule 不应重新引入 Plugin 级 registry。HTTP Route、Hook、MessageFilter 后续增加 convention 时沿用相同 Slot/Runtime 关系。

## 10. Page Manifest

```ts
export interface PageManifest {
  readonly id: CapabilityId;
  readonly owner: PluginId;
  readonly localName: string;
  readonly module: string;
  readonly title: string;
  readonly icon?: string;
  readonly order: number;
  readonly hideInNav: boolean;
  readonly requiredPermissions: readonly string[];
  readonly requiredRoles: readonly string[];
}

export function pageRoute(owner: PluginId, root: PluginId, localName: string): string {
  const relative = owner === root ? '' : owner.slice(root.length).replace(/^\//, '');
  return `/${relative ? `${relative}/` : ''}p-${localName}`;
}
```

生产 manifest 是 Page source 的构建产物，不是第二份作者配置。

正式实现已落在 `@zhin.js/console-contract`、`@zhin.js/page`、`@zhin.js/layout` 与
`@zhin.js/pagemanager/plugin-runtime`。Page/Layout convention 仅向
`ModuleRuntime.loadClientModule()` 请求 `{ module, hash, metadata }` artifact，不通过
Server Module Runtime 执行 TSX。

## 11. Navigation Builder

```ts
export interface NavNode {
  readonly id: string;
  readonly type: 'plugin' | 'page';
  readonly label: string;
  readonly path?: string;
  readonly order: number;
  readonly children: readonly NavNode[];
}

export function buildNavigation(
  snapshot: RuntimeSnapshot,
  pages: readonly PageManifest[],
  access: AccessSnapshot,
): readonly NavNode[] {
  const visible = pages.filter((page) => access.allows(page));
  const byOwner = groupBy(visible, (page) => page.owner);

  const visit = (plugin: PluginNodeSnapshot): NavNode | undefined => {
    const children = plugin.children
      .map((id) => visit(required(snapshot.tree, id)))
      .filter((node): node is NavNode => Boolean(node));
    const leaves = (byOwner.get(plugin.id) ?? []).map((page) => ({
      id: page.id,
      type: 'page' as const,
      label: page.title,
      path: pageRoute(page.owner, snapshot.root, page.localName),
      order: page.order,
      children: [],
    }));

    const items = [...leaves, ...children].sort(compareNavNode);
    if (!items.length) return undefined;
    return {
      id: plugin.id,
      type: 'plugin',
      label: plugin.metadata.displayName ?? plugin.instanceKey,
      order: plugin.metadata.order ?? 100,
      children: items,
    };
  };

  const root = required(snapshot.tree, snapshot.root);
  const rootPages = (byOwner.get(root.id) ?? []).map((page) => ({
    id: page.id,
    type: 'page' as const,
    label: page.title,
    path: pageRoute(page.owner, snapshot.root, page.localName),
    order: page.order,
    children: [],
  }));
  const pluginGroups = root.children
    .map((id) => visit(required(snapshot.tree, id)))
    .filter((node): node is NavNode => Boolean(node));
  return [...rootPages, ...pluginGroups].sort(compareNavNode);
}
```

Root 自己的 Page 是顶层 leaf，Root Plugin 本身不产生可见 group。Root children 仍产生 Plugin group。

## 12. Layout Resolver

```ts
export interface LayoutManifest {
  readonly owner: PluginId;
  readonly slot: 'nav' | 'footer';
  readonly module: string;
}

export function resolveLayout(
  owner: PluginId,
  slot: LayoutManifest['slot'],
  snapshot: RuntimeSnapshot,
  layouts: ReadonlyMap<string, LayoutManifest>,
): LayoutManifest | undefined {
  let current: PluginId | undefined = owner;
  while (current) {
    const found = layouts.get(`${current}\0${slot}`);
    if (found) return found;
    current = snapshot.tree.get(current)?.parent;
  }
  return undefined;
}
```

Console Shell 负责 semantic region、responsive layout、focus、Suspense 和 Error Boundary。`$nav.tsx` 只收到已鉴权 NavNode[]；`$footer.tsx` 只收到只读 footer context。

`ConsoleRuntime.runView()` 为 route guard、Navigation 和 Layout chain 持有同一 snapshot lease；回调退出后 catalog 失效。`LayoutIndex.chain()` 按最近 owner 到 Root 返回 renderer 回退顺序，Shell 仍是 Error Boundary 与内置 renderer 的 authority。

## 13. Root Bootstrap

```ts
export async function bootstrapRoot(options: BootstrapOptions): Promise<RootHandle> {
  const definition = await options.modules.importPlugin(options.entry);
  const topology = await options.loader.resolve(definition, options.entry);
  const schemas = await options.config.loadSchemas(topology);
  const documentSchema = composeDocumentSchema(schemas);
  const raw = await options.config.document.read();
  const validated = options.config.compiler.compile<ConfigEnvelope>(documentSchema)(raw);
  if (!validated.ok) throw new ConfigValidationError(validated.issues);

  const prepared = await options.preparer.initial(topology, validated.value);
  const snapshots = new SnapshotStore(prepared);
  const root = new RootController(snapshots);

  await options.runtimes.start({ root, snapshots });
  return {
    root,
    stop: async (reason) => {
      await options.runtimes.quiesce(reason);
      await root.stop();
    },
  };
}
```

Bootstrap 是唯一 composition root。它可以选择不安装 Agent/Console Runtime，保持默认 IM 体积；Plugin Kernel 和作者 interface 不因此分叉。

## 14. Runtime 测试矩阵

- Middleware next 多调、漏调、异常和顺序。
- Command matcher index 只随 generation 重建。
- 一次 Message/Agent turn 始终使用同一 generation。
- Tool 使用自己的 owner config/resource，不读取调用者 Plugin 私有配置。
- Adapter stop 在 owner generation dispose 时恰好一次。
- Page route 与 Plugin mount path 一致。
- Navigation permission filter 后不留下空 group。
- Layout nearest-ancestor resolution 与渲染失败回退。
- 不启用 Agent/Console 时默认 IM Bootstrap 不解析可选包。
