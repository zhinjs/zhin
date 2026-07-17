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

```ts
export interface MessageMiddleware<TConfig = unknown> extends Definition<'middleware'> {
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

Middleware index 按 `(phase, order, owner topology order, CapabilityId)` 排序。一次 Message 使用同一 generation 的整条链。

## 5. Inbound Runner 与 Command Dispatcher

```ts
export class InboundRunner {
  #middleware = new GenerationCache<readonly CapabilitySlot<MessageMiddleware>[]>();

  constructor(
    private readonly snapshots: SnapshotStore,
    private readonly dispatcher: MessageDispatcher,
  ) {}

  run(message: Message): Promise<void> {
    return this.snapshots.using(async (snapshot) => {
      const slots = this.#middleware.get(snapshot, (value) =>
        selectSlots<MessageMiddleware>(value, 'middleware').sort(compareMiddleware),
      );
      const entries = slots.map((slot) => ({
        slot,
        context: { ...capabilityContext(snapshot, slot), message },
      }));
      await composeMiddleware(entries, () => this.dispatcher.dispatch(message, snapshot))();
    });
  }
}
```

Dispatcher 使用成熟 matcher adapter，不在框架内重写 command grammar：

```ts
export interface CommandMatcher {
  compile(pattern: string): CompiledPattern;
  match(pattern: CompiledPattern, content: string): CommandMatch | undefined;
}

export class MessageDispatcher {
  #commands = new GenerationCache<readonly CompiledCommand[]>();

  constructor(private readonly matcher: CommandMatcher) {}

  async dispatch(message: Message, snapshot: RuntimeSnapshot): Promise<void> {
    const commands = this.#commands.get(snapshot, (value) =>
      selectSlots<CommandDefinition>(value, 'command').map((slot) => ({
        slot,
        pattern: this.matcher.compile(slot.definition.pattern),
      })),
    );

    for (const command of commands) {
      const match = this.matcher.match(command.pattern, message.content);
      if (!match) continue;
      await command.slot.definition.execute({
        ...capabilityContext(snapshot, command.slot),
        message,
        match,
      });
      return;
    }
  }
}
```

Command collision/priority 在 prepare 阶段诊断；Dispatcher 不根据“最后注册者”决定覆盖。

## 6. Component 与 Outbound Renderer

Component definition 是纯 render function；Renderer 按 owner-aware identity 解析：

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
Message.$reply / Adapter.sendMessage
  -> OutboundRenderer
  -> before.sendMessage snapshot
  -> Endpoint.send
```

Adapter 是 owner-bound Resource/Feature definition，Endpoint 是运行实例。平台实现不能绕过 Renderer 直接发送结构化内容。

## 7. Adapter 与 Endpoint Runtime

```ts
export interface AdapterDefinition<C = unknown> extends Definition<'adapter'> {
  readonly capabilities: readonly ('inbound' | 'outbound')[];
  create(context: CapabilityContext<C>): AdapterInstance | Promise<AdapterInstance>;
}

export interface AdapterInstance {
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  send?(endpoint: EndpointId, payload: PlatformPayload): Promise<SendResult>;
}
```

Adapter instance 的 start/stop disposer 属于 owner Plugin generation。共享网络连接若要跨 Slot HMR 存活，应提升为 Plugin Resource，而不是藏在 module global。

## 8. Agent Capability Index

Tool、Skill、Agent、MCP 仍由各自 Feature 表达，CapabilityIngress 只做 snapshot projection：

```ts
export interface AgentCapabilityIndex {
  readonly tools: ReadonlyMap<string, CapabilitySlot<ToolDefinition>>;
  readonly skills: ReadonlyMap<string, CapabilitySlot<SkillDefinition>>;
  readonly agents: ReadonlyMap<string, CapabilitySlot<AgentDefinition>>;
  readonly mcp: ReadonlyMap<string, CapabilitySlot<McpDefinition>>;
}

export function buildAgentCapabilityIndex(
  snapshot: RuntimeSnapshot,
): AgentCapabilityIndex {
  return Object.freeze({
    tools: qualifiedIndex(snapshot, 'tool'),
    skills: qualifiedIndex(snapshot, 'skill'),
    agents: qualifiedIndex(snapshot, 'agent'),
    mcp: qualifiedIndex(snapshot, 'mcp'),
  });
}

export class CapabilityIngress {
  #cache = new GenerationCache<AgentCapabilityIndex>();

  read(snapshot: RuntimeSnapshot): AgentCapabilityIndex {
    return this.#cache.get(snapshot, buildAgentCapabilityIndex);
  }
}
```

Orchestrator 一次 turn lease 一个 snapshot：

```ts
await snapshots.using(async (snapshot) => {
  const capabilities = ingress.read(snapshot);
  await orchestrator.run({ request, capabilities, generation: snapshot.generation });
});
```

Tool execute 获得 owner ConfigView/Resource；Skill/Agent Markdown 是 immutable definition。MCP client connection 属于 Resource/disposer，不存入 Feature definition。

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
