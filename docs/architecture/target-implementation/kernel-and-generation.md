# Kernel 与原子 Generation

本页给出 `@zhin.js/kernel` 的关键实现形状。代码强调 interface 与不变量，错误类型和诊断字段可在实现时扩展，但不能改变单一 generation 模型。

## 1. 稳定 Identity

HMR 环境不能把模块内新建的 `Symbol()` 当作跨 generation identity。Token 与 Capability 都使用显式稳定字符串：

```ts
declare const tokenIdBrand: unique symbol;
declare const pluginIdBrand: unique symbol;
declare const capabilityIdBrand: unique symbol;
declare const featureIdBrand: unique symbol;

export type TokenId = string & { readonly [tokenIdBrand]: true };
export type PluginId = string & { readonly [pluginIdBrand]: true };
export type CapabilityId = string & { readonly [capabilityIdBrand]: true };
export type FeatureId = string & { readonly [featureIdBrand]: true };

export interface Token<T> {
  readonly id: TokenId;
  readonly description?: string;
  readonly _type?: (value: T) => T;
}

export function createToken<T>(id: string, description?: string): Token<T> {
  if (!/^[a-z][a-z0-9.-]*$/.test(id)) {
    throw new TypeError(`Invalid token id: ${id}`);
  }
  return Object.freeze({ id: id as TokenId, description });
}

export function capabilityId(
  owner: PluginId,
  feature: FeatureId,
  localName: string,
): CapabilityId {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(localName)) {
    throw new TypeError(`Invalid local name: ${localName}`);
  }
  return `${owner}\0${feature}\0${localName}` as CapabilityId;
}
```

Token id 使用反向域名或 package namespace，例如 `zhin.database`、`acme.weather-client`。Kernel 不维护全局 Token object registry，比较只看 `token.id`。

## 2. Disposer Stack

所有 setup side effect 必须进入一个可逆 stack：

```ts
export type Dispose = () => void | Promise<void>;

export class DisposeStack {
  #items: Dispose[] = [];
  #sealed = false;
  #disposed = false;

  onDispose(dispose: Dispose): void {
    if (this.#sealed) throw new Error('DisposeStack already sealed');
    if (this.#disposed) throw new Error('DisposeStack already disposed');
    this.#items.push(dispose);
  }

  seal(): void {
    this.#sealed = true;
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;

    const errors: unknown[] = [];
    for (const dispose of this.#items.splice(0).reverse()) {
      try {
        await dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Dispose failed');
  }
}
```

它刻意不依赖 TC39 `AsyncDisposableStack`，以兼容当前 Node 范围，并保持异常聚合语义明确。

## 3. Prepared Scope

Scope 只服务于装配期；Runtime 使用 commit 后的 immutable resource snapshot：

```ts
interface Binding<T = unknown> {
  readonly value: T;
  readonly owner: PluginId;
}

export class Scope {
  #bindings = new Map<TokenId, Binding>();
  #sealed = false;

  constructor(
    readonly owner: PluginId,
    readonly parent?: Scope,
    readonly disposers = new DisposeStack(),
  ) {}

  provide<T>(token: Token<T>, value: T, dispose?: Dispose): void {
    if (this.#sealed) throw new Error(`Scope already sealed: ${this.owner}`);
    if (this.#bindings.has(token.id)) {
      throw new Error(`Duplicate resource ${token.id} in ${this.owner}`);
    }
    this.#bindings.set(token.id, Object.freeze({ value, owner: this.owner }));
    if (dispose) this.disposers.onDispose(dispose);
  }

  use<T>(token: Token<T>): T {
    const local = this.#bindings.get(token.id);
    if (local) return local.value as T;
    if (this.parent) return this.parent.use(token);
    throw new Error(`Missing resource ${token.id} for ${this.owner}`);
  }

  has<T>(token: Token<T>): boolean {
    return this.#bindings.has(token.id) || Boolean(this.parent?.has(token));
  }

  seal(): void {
    this.#sealed = true;
    this.disposers.seal();
  }

  snapshot(): ReadonlyMap<TokenId, unknown> {
    if (!this.#sealed) throw new Error(`Scope not sealed: ${this.owner}`);
    const inherited = this.parent ? new Map(this.parent.snapshot()) : new Map<TokenId, unknown>();
    for (const [id, binding] of this.#bindings) inherited.set(id, binding.value);
    return inherited;
  }
}
```

Resource shadowing 是显式的最近祖先规则。父层无法通过 Scope 向下读取 child 私有 binding。

## 4. Plugin Definition 与 Instance

definition 是纯数据；instance 是 RootController 构造的运行时节点：

```ts
export interface PluginMetadata {
  readonly displayName?: string;
  readonly icon?: string;
  readonly order?: number;
}

export interface PluginSetupContext<TConfig = unknown> {
  readonly plugin: PluginInstance;
  readonly config: ConfigView<TConfig>;
  readonly resources: Scope;
  readonly lifecycle: DisposeStack;
}

export interface PluginDefinition<TConfig = unknown> {
  readonly name: string;
  readonly metadata?: PluginMetadata;
  readonly requires?: readonly Token<unknown>[];
  setup?(context: PluginSetupContext<TConfig>): void | Dispose | Promise<void | Dispose>;
}

export function definePlugin<TConfig>(
  definition: PluginDefinition<TConfig>,
): Readonly<PluginDefinition<TConfig>> {
  if (!/^[a-z][a-z0-9-]*$/.test(definition.name)) {
    throw new TypeError(`Invalid plugin name: ${definition.name}`);
  }
  return Object.freeze({
    ...definition,
    requires: Object.freeze([...(definition.requires ?? [])]),
  });
}

export class PluginInstance {
  #children: PluginInstance[] = [];

  constructor(
    readonly id: PluginId,
    readonly instanceKey: string,
    readonly definition: Readonly<PluginDefinition>,
    readonly scope: Scope,
    readonly parent?: PluginInstance,
  ) {
    if (parent) parent.#children.push(this);
  }

  get children(): readonly PluginInstance[] {
    return this.#children;
  }

  get root(): PluginInstance {
    return this.parent?.root ?? this;
  }

  get role(): 'root' | 'child' {
    return this.parent ? 'child' : 'root';
  }
}
```

不使用 EventEmitter 作为 Plugin 的核心 interface。生命周期通知通过 Root snapshot/change stream 提供；领域事件进入各自 Runtime。Child topology 与启用的 Feature provider 位于静态 `package.json#zhin` manifest，Kernel definition 不重复保存，详见 [Plugin Monorepo 与 Feature Provider](./plugin-monorepo-and-features.md)。

## 5. Capability Slot

```ts
export interface CapabilitySlot<T = unknown> {
  readonly id: CapabilityId;
  readonly owner: PluginId;
  readonly feature: FeatureId;
  readonly localName: string;
  readonly source: string;
  readonly moduleId?: string;
  readonly definition: T;
}

export function createSlot<T>(input: Omit<CapabilitySlot<T>, 'id'>): CapabilitySlot<T> {
  return Object.freeze({
    ...input,
    id: capabilityId(input.owner, input.feature, input.localName),
  });
}
```

Kernel 不枚举具体能力类型。`FeatureId`、目录约定、definition validation 和 runtime projection 由可发布的 Feature provider package 拥有。Slot 不持有 generation；generation 属于整个 RuntimeSnapshot，避免同一快照里出现难以推理的局部版本组合。

## 6. Runtime Snapshot

```ts
export interface PluginNodeSnapshot {
  readonly id: PluginId;
  readonly instanceKey: string;
  readonly parent?: PluginId;
  readonly children: readonly PluginId[];
  readonly metadata: PluginMetadata;
}

export interface RuntimeSnapshot {
  readonly generation: number;
  readonly root: PluginId;
  readonly tree: ReadonlyMap<PluginId, PluginNodeSnapshot>;
  readonly config: ReadonlyMap<PluginId, unknown>;
  readonly resources: ReadonlyMap<PluginId, ReadonlyMap<TokenId, unknown>>;
  readonly capabilities: ReadonlyMap<CapabilityId, CapabilitySlot>;
}

export interface PreparedGeneration {
  readonly snapshot: Omit<RuntimeSnapshot, 'generation'>;
  readonly dispose: Dispose;
  readonly handoff?: GenerationHandoff;
}

export interface GenerationHandoff {
  quiescePrevious(previous: RuntimeSnapshot): Promise<void>;
  activateNext(): Promise<void>;
  deactivateNext(): Promise<void>;
  resumePrevious(): Promise<void>;
  openNext(): void;
}
```

未变化 Plugin Scope 不需要执行 handoff，而是由 `SharedLifetime` 管理跨 generation 所有权：每个 PreparedGeneration acquire 一个幂等 lease，旧 generation drain 时 release；只有最后一个 lease 释放才 children-first dispose Scope。需要暂停流量或切换连接所有权的 Resource 才实现显式 `GenerationHandoff`。

所有 Map 在发布前复制并且只通过 `ReadonlyMap` 暴露。Kernel 不宣称 `Object.freeze(new Map())` 能阻止 `.set()`；实现内部绝不泄漏可变 Map reference。

## 7. Snapshot Lease Store

```ts
interface GenerationRecord {
  readonly snapshot: RuntimeSnapshot;
  readonly dispose: Dispose;
  readonly done: Promise<void>;
  resolve(): void;
  leases: number;
  retired: boolean;
  disposing: boolean;
}

export interface SnapshotLease {
  readonly value: RuntimeSnapshot;
  release(): void;
}

export class SnapshotStore {
  #current: GenerationRecord;
  #records = new Map<number, GenerationRecord>();
  #pending = new Set<Promise<void>>();
  #listeners = new Set<(next: RuntimeSnapshot, previous: RuntimeSnapshot) => void>();

  constructor(
    initial: PreparedGeneration,
    private readonly onDisposeError: (error: unknown) => void = () => {},
    private readonly onListenerError: (error: unknown) => void = () => {},
  ) {
    this.#current = this.#record(0, initial);
  }

  get generation(): number {
    return this.#current.snapshot.generation;
  }

  acquire(): SnapshotLease {
    const record = this.#current;
    record.leases++;
    let released = false;

    return {
      value: record.snapshot,
      release: () => {
        if (released) return;
        released = true;
        record.leases--;
        this.#finalize(record);
      },
    };
  }

  async using<T>(run: (snapshot: RuntimeSnapshot) => Promise<T>): Promise<T> {
    const lease = this.acquire();
    try {
      return await run(lease.value);
    } finally {
      lease.release();
    }
  }

  subscribe(listener: (next: RuntimeSnapshot, previous: RuntimeSnapshot) => void): Dispose {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  commit(expected: number, prepared: PreparedGeneration): RuntimeSnapshot {
    if (this.generation !== expected) {
      throw new Error(`Generation changed: expected ${expected}, got ${this.generation}`);
    }

    const previous = this.#current;
    const next = this.#record(expected + 1, prepared);
    this.#current = next;
    this.#retire(previous);
    queueMicrotask(() => {
      for (const listener of this.#listeners) {
        try {
          listener(next.snapshot, previous.snapshot);
        } catch (error) {
          this.onListenerError(error);
        }
      }
    });
    return next.snapshot;
  }

  async drain(): Promise<void> {
    await Promise.all(this.#pending);
  }

  async close(): Promise<void> {
    this.#retire(this.#current);
    await this.drain();
  }

  #record(generation: number, prepared: PreparedGeneration): GenerationRecord {
    const snapshot = Object.freeze({ ...prepared.snapshot, generation });
    let resolve!: () => void;
    const done = new Promise<void>((ok) => {
      resolve = ok;
    });
    const record = {
      snapshot,
      dispose: prepared.dispose,
      done,
      resolve,
      leases: 0,
      retired: false,
      disposing: false,
    };
    this.#records.set(generation, record);
    return record;
  }

  #retire(record: GenerationRecord): void {
    if (record.retired) return;
    record.retired = true;
    this.#pending.add(record.done);
    this.#finalize(record);
  }

  #finalize(record: GenerationRecord): void {
    if (!record.retired || record.leases !== 0 || record.disposing) return;
    record.disposing = true;
    this.#records.delete(record.snapshot.generation);
    void Promise.resolve(record.dispose()).catch((error) => {
      try {
        this.onDisposeError(error);
      } catch {
        // Error reporting cannot prevent generation retirement.
      }
    }).finally(() => {
      record.resolve();
      this.#pending.delete(record.done);
    });
  }
}
```

`subscribe()` 是 generation 观察口，不是能力注册源。Schedule、Console manifest push 等需要主动响应更新的 Runtime 订阅它；Message/Agent turn 仍在工作开始时显式 lease。通知放入 microtask，避免 listener IO 延长原子 commit。

生产实现应通过 Root Logger 报告异步 dispose 失败，并为 drain 增加 timeout/cancellation port；核心引用计数和 commit 必须保持同步、短小。

## 8. Root Transaction Queue

JavaScript 单线程不等于异步事务不会交错。RootController 使用一个小型串行队列：

```ts
export class RootController {
  #tail: Promise<void> = Promise.resolve();
  #stopping = false;

  constructor(
    readonly snapshots: SnapshotStore,
    private readonly onControlError: (error: unknown) => void = () => {},
  ) {}

  transact(
    prepare: (current: RuntimeSnapshot) => Promise<PreparedGeneration>,
  ): Promise<RuntimeSnapshot> {
    if (this.#stopping) return Promise.reject(new Error('Root is stopping'));

    const operation = this.#tail.then(async () => {
      const lease = this.snapshots.acquire();
      let prepared: PreparedGeneration | undefined;
      let quiesced = false;
      let activated = false;
      let committed = false;
      try {
        prepared = await prepare(lease.value);
        if (prepared.handoff) {
          quiesced = true;
          await prepared.handoff.quiescePrevious(lease.value);
          activated = true;
          await prepared.handoff.activateNext();
        }
        const handoff = prepared.handoff;
        const nextSnapshot = this.snapshots.commit(lease.value.generation, prepared);
        committed = true;
        prepared = undefined;
        try {
          handoff?.openNext();
        } catch (error) {
          try {
            this.onControlError(error);
          } catch {
            // Control error reporting cannot roll back an already committed generation.
          }
        }
        return nextSnapshot;
      } catch (error) {
        const errors = [error];
        if (!committed && activated) {
          try {
            await prepared?.handoff?.deactivateNext();
          } catch (cleanupError) {
            errors.push(cleanupError);
          }
        }
        if (!committed && quiesced) {
          try {
            await prepared?.handoff?.resumePrevious();
          } catch (cleanupError) {
            errors.push(cleanupError);
          }
        }
        if (errors.length > 1) throw new AggregateError(errors, 'Generation handoff failed');
        throw error;
      } finally {
        lease.release();
        await prepared?.dispose();
      }
    });

    this.#tail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    await this.#tail;
    await this.snapshots.close();
  }
}
```

`prepare` 可以由启动、配置更新、Capability HMR 或 Plugin subtree HMR 复用。RootController 不理解 Message、Tool 或 Page。

Capability-only transaction 没有 `handoff`，只做 shadow prepare + CAS。Plugin subtree 涉及 socket、timer、worker 等排他资源时才提供 handoff：暂停受影响 Runtime admission，激活新资源，commit 后同步开放新入口；失败则 deactivate 新资源并恢复旧入口。

## 9. Tree Setup

```ts
async function setupNode(
  node: PluginInstance,
  configFor: (owner: PluginId) => ConfigView,
  discover: (node: PluginInstance) => Promise<readonly CapabilitySlot[]>,
  slots: Map<CapabilityId, CapabilitySlot>,
): Promise<void> {
  for (const token of node.definition.requires ?? []) node.scope.use(token);

  const dispose = await node.definition.setup?.({
    plugin: node,
    config: configFor(node.id),
    resources: node.scope,
    lifecycle: node.scope.disposers,
  });
  if (dispose) node.scope.disposers.onDispose(dispose);

  for (const slot of await discover(node)) {
    if (slots.has(slot.id)) throw new Error(`Duplicate capability ${slot.id}`);
    slots.set(slot.id, slot);
  }

  for (const child of node.children) {
    await setupNode(child, configFor, discover, slots);
  }
}

function sealTree(node: PluginInstance): void {
  node.scope.seal();
  for (const child of node.children) sealTree(child);
}
```

实际实现将 topology resolution、schema validation 和 instance construction 放在 setup 前，并在整树 setup/discovery 成功后调用 `sealTree(root)`。seal 后任何迟到的 Resource/disposer 注册都会失败，从而保证 commit 后的 generation 不可变。

Plugin `setup()` 只能构造 inactive Resource、读取配置和登记 disposer，不得启动 detached timer/socket/task。长期工作有两种合法归属：

- 由 Schedule、Adapter、Agent 等 Runtime Authority 根据 snapshot 启停。
- 实现 Root 可编排的 prepare/activate/quiesce/dispose Resource contract，进入 GenerationHandoff。

## 10. Kernel 测试矩阵

- Token 跨不同 object instance 仍按稳定 id 解析。
- child Resource shadow 不影响 parent/sibling。
- setup 第 N 步失败时 disposer 严格逆序执行。
- generation CAS 冲突不会发布 prepared snapshot。
- retired generation 在最后一个 lease 释放前不 dispose。
- transaction prepare 失败时 active generation 不变。
- stop 后拒绝新 transaction，并等待已排队 transaction。
- 同一 Plugin package 多实例拥有不同 PluginId 与 CapabilityId。
- Root promotion 不改变 definition，只改变 instance projection。
