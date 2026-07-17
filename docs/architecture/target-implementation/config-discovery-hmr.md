# Config、Discovery 与 HMR

这三个模块位于 Root 组合层，共享 Plugin tree 和 source ownership，但分别保持单一职责：Config 产生 owner-scoped values，Discovery 产生 Slot，HMR 只规划并提交 generation。

## 0. Root Resource Contracts

基础能力通过小 interface 和稳定 Token 暴露：

```ts
export interface RuntimeEnvironment {
  readonly name: string;
  readonly mode: string;
  readonly platform: string;
}

export interface EnvSchema<T> {
  parse(source: Readonly<Record<string, string | undefined>>): T;
  readonly secretKeys?: readonly string[];
}

export interface EnvStore {
  readonly owner: PluginId;
  readonly environment: RuntimeEnvironment;
  has(key: string): boolean;
  get(key: string): string | undefined;
  require(key: string): string;
  parse<T>(schema: EnvSchema<T>): Readonly<T>;
  expand<T>(value: T): T;
  redact(value: unknown, secretKeys: readonly string[]): unknown;
}

export interface DatabaseView {
  transaction<T>(run: (tx: Transaction) => Promise<T>): Promise<T>;
  repository<T>(model: Model<T>): Repository<T>;
}

export interface Logger {
  debug(event: string, fields?: Readonly<Record<string, unknown>>): void;
  info(event: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(event: string, fields?: Readonly<Record<string, unknown>>): void;
  error(event: string, fields?: Readonly<Record<string, unknown>>): void;
}

export const runtimeEnvironmentToken = createToken<RuntimeEnvironment>(
  'zhin.runtime-environment',
);
export const envStoreToken = createToken<EnvStore>('zhin.env');
export const DatabaseToken = createToken<DatabaseView>('zhin.database');
export const LoggerToken = createToken<Logger>('zhin.logger');
```

Root Bootstrap 显式接收 process env、database pool 和 logger factory，并为每个 Plugin owner 生成 EnvStore/DatabaseView/Logger binding。Plugin 看不到 pool 的 `close()`；只有 Root generation disposer 能关闭物理资源。

EnvStore 已按 `base → environment.name → Plugin ancestors → exact owner` 实现固定 overlay 顺序。每层的 `undefined` 会删除下层值；`${KEY}` 只在 Plugin 显式调用 `expand()` 时解析，YAML AST 永远保留原表达式。环境层在 Root 构造时冻结，变化进入 process restart，不伪装成 generation HMR。`EnvSchema.secretKeys` 同时用于 parser diagnostic 和结构化日志脱敏，脱敏异常不保留原始 cause。

## 1. Config Ports

Kernel 只需要只读 ConfigView contract：

```ts
export interface ConfigView<T = unknown> {
  readonly owner: PluginId;
  readonly path: readonly string[];
  get(): Readonly<T>;
}
```

文件格式和 Schema compiler 是组合层 adapter：

```ts
export interface ConfigDocumentPort {
  read(): Promise<ConfigDocumentSnapshot>;
  prepare(
    current: ConfigDocumentSnapshot,
    patches: readonly ConfigPatch[],
  ): Promise<PreparedConfigDocument>;
}

export interface ConfigDocumentSnapshot {
  readonly document: Readonly<Record<string, unknown>>;
  readonly revision: string;
}

export interface PreparedConfigDocument {
  readonly document: Readonly<Record<string, unknown>>;
  commit(): Promise<ConfigDocumentSnapshot>;
  rollback(): Promise<void>;
}

export type ConfigPatch =
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: 'remove'; readonly path: readonly string[] };

export interface SchemaCompiler {
  compile<T>(schema: JsonSchema): (input: unknown) => ValidationResult<T>;
  defaults(schema: JsonSchema): unknown;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export interface ValidationIssue {
  readonly pointer: string;
  readonly keyword: string;
  readonly message: string;
}
```

`ConfigPatch` 是 `set/remove` 的判别联合，并拒绝 prototype pollution 路径。`ConfigDocumentPort` 的 YAML 实现使用 AST patch 保留注释、`${ENV}`、scalar style、anchor/alias、缩进与换行。JSON Schema compiler 和 YAML parser 都使用成熟实现；Kernel 与 Plugin 作者不感知具体库。

当前 Runtime 已提供 `ConfigPatchPlanner`、`ConfigDocumentPort` 与 `RootRuntime.patchConfig()`；可选 `@zhin.js/next-config-yaml` 实现 YAML AST 持久化。Planner 在原始 document clone 上应用 patch，随后执行整树 schema 校验，并通过前后 owner ConfigView 的结构化比较计算最浅 forest。原始 candidate 与 AJV materialized document 分离，避免把未显式配置的 schema default 写回文件。

Port 的 `prepare()` 不产生副作用。存在 Plugin view 变化时，Root 先完成 shadow setup，再按 Resource、ConfigDocument 的顺序 activate，最后 CAS 发布 generation；CAS 前失败按 ConfigDocument、Resource 的逆序补偿。只有原始文档变化而 owner view 不变时，Root 在同一串行控制事务内只提交文档，不发布空 generation。revision 冲突、schema 校验或 shadow setup 失败都保持 active snapshot 和原文件不变。

## 2. Schema Composer

Plugin package schema root 必须是可组合 object schema：

```ts
export interface JsonSchema {
  readonly $schema?: string;
  readonly $id?: string;
  readonly $defs?: Readonly<Record<string, JsonSchema>>;
  readonly type?: string | readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | JsonSchema;
  readonly [keyword: string]: unknown;
}

interface ConfigSchemaNode {
  readonly plugin: PluginInstance;
  readonly own: JsonSchema;
  readonly children: readonly ConfigSchemaNode[];
}

export function composeChildSchema(node: ConfigSchemaNode): JsonSchema {
  if (node.own.type !== 'object') {
    throw new Error(`${node.plugin.id}/schema.json must have type=object`);
  }

  const properties: Record<string, JsonSchema> = { ...node.own.properties };
  for (const child of node.children) {
    const key = child.plugin.instanceKey;
    if (key in properties) {
      throw new Error(`Config field/child collision at ${node.plugin.id}.${key}`);
    }
    properties[key] = composeChildSchema(child);
  }

  return Object.freeze({ ...node.own, properties });
}

export function composeDocumentSchema(root: ConfigSchemaNode): JsonSchema {
  const plugins = Object.fromEntries(
    root.children.map((child) => [child.plugin.instanceKey, composeChildSchema(child)]),
  );

  return Object.freeze({
    type: 'object',
    properties: {
      plugin: root.own,
      plugins: {
        type: 'object',
        properties: plugins,
        additionalProperties: false,
      },
    },
    required: ['plugin', 'plugins'],
    additionalProperties: false,
  });
}
```

`$ref` resolution、draft 行为和 error detail 交给 SchemaCompiler。Composer 只做 Zhin 的树投影，不尝试实现 JSON Schema。

## 3. Config Projection

验证成功后一次遍历产生每个 owner 的值：

```ts
interface ConfigEnvelope {
  readonly plugin: unknown;
  readonly plugins: Readonly<Record<string, unknown>>;
}

export function projectConfig(
  root: ConfigSchemaNode,
  document: ConfigEnvelope,
): ReadonlyMap<PluginId, unknown> {
  const result = new Map<PluginId, unknown>();
  result.set(root.plugin.id, pickOwnFields(root.own, document.plugin));

  const visit = (
    node: ConfigSchemaNode,
    raw: unknown,
  ): void => {
    result.set(node.plugin.id, pickOwnFields(node.own, raw));
    const object = asRecord(raw);
    for (const child of node.children) visit(child, object[child.plugin.instanceKey]);
  };

  for (const child of root.children) {
    visit(child, document.plugins[child.plugin.instanceKey]);
  }
  return result;
}

function pickOwnFields(schema: JsonSchema, input: unknown): Readonly<Record<string, unknown>> {
  const source = asRecord(input);
  const own = Object.keys(schema.properties ?? {}).filter((key) => key in source);
  return Object.freeze(Object.fromEntries(own.map((key) => [key, source[key]])));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
```

注意：`composeChildSchema()` 给 effective schema 注入了 child properties，因此 `pickOwnFields()` 必须接收 package 原始 `own` schema，而不是 effective schema，才能防止父 ConfigView 看到 child config。

## 4. 安装时物化

```ts
export async function materializePluginTree(
  document: ConfigDocumentPort,
  root: ConfigSchemaNode,
  compiler: SchemaCompiler,
): Promise<void> {
  const patches: ConfigPatch[] = [];

  const visit = (node: ConfigSchemaNode, path: readonly string[]): void => {
    patches.push({ path, value: compiler.defaults(node.own) ?? {} });
    for (const child of node.children) {
      visit(child, [...path, child.plugin.instanceKey]);
    }
  };

  for (const child of root.children) {
    visit(child, ['plugins', child.plugin.instanceKey]);
  }
  await document.patch(patches);
}
```

真实 adapter 只写缺失 path，不覆盖用户值。required 且无 default 的字段在 patch 前由 installer 交互收集，非交互模式返回 ValidationIssue。

## 5. Feature-owned Convention

Kernel 与 Root Bootstrap 不维护全局目录表。只有 `package.json#zhin.features` 显式启用的 Feature provider 才能贡献 convention：

```ts
export interface SourceConvention {
  readonly directory: string;
  discover(context: DiscoveryContext): AsyncIterable<DiscoveredSource>;
  load(source: DiscoveredSource, context: LoadContext): Promise<unknown>;
}

export interface FeatureProvider<T = unknown> {
  readonly id: FeatureId;
  readonly conventions: readonly SourceConvention[];
  validate(value: unknown, context: ValidationContext): T;
}
```

Skill 使用单独的一层目录扫描：

```ts
async function discoverSkills(root: string): Promise<readonly DiscoveredSource[]> {
  const directory = resolve(root, 'skills');
  const entries = await safeReadDir(directory);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      localName: entry.name,
      source: resolve(directory, entry.name, 'SKILL.md'),
      target: 'server' as const,
    }));
}
```

标准 Agent Feature 扫描 `agents/<name>.agent.md`，Command Feature 递归扫描 `commands/**/*.ts|tsx`，并将相对路径 `gh/issue/list.ts` 投影为 canonical localName `gh/issue/list` 与命令词 `gh issue list`。Command 文件 basename 还可使用 `[name:type=default].ts(x)` 声明末尾参数，例如 `gh/pr/[title:string=defaultTitle].ts` 编译为 canonical localName `gh/pr/$title` 与 pattern `gh pr [title]`；参数 DSL 的解析和校验仍完全属于 Command provider。这些约定属于各自 provider，而不是此模块的常量。Discovery 只返回 source descriptors；Server/Client Module Runtime 负责 TypeScript 模块，Agent/Skill provider 负责读取它们各自的 Markdown SSOT。完整 contract 见 [Plugin Monorepo 与 Feature Provider](./plugin-monorepo-and-features.md)。

## 6. Ownership Index

```ts
export interface SourceRecord {
  readonly source: string;
  readonly owner: PluginId;
  readonly role: 'plugin' | 'schema' | 'manifest' | 'feature' | 'capability';
  readonly capability?: CapabilityId;
}

export class SourceOwnershipIndex {
  #records = new Map<string, SourceRecord[]>();

  add(record: SourceRecord): void {
    const source = normalizePath(record.source);
    const records = this.#records.get(source) ?? [];
    records.push({ ...record, source });
    this.#records.set(source, records);
  }

  recordsFor(source: string): readonly SourceRecord[] {
    return this.#records.get(normalizePath(source)) ?? [];
  }
}
```

package root 的 `plugin.ts`、`schema.json`、manifest、Feature entry 与 capability entry 都进入索引。同一个物理 Feature package 可以挂载到多个 Plugin instance，因此 source 到 owner 是一对多关系；冲突只在同一 owner 内判定。内部 imports 由 Module Runtime 的 reverse importer closure 回溯到这些已知入口。

## 7. Module Runtime Ports

```ts
export interface LoadedModule<T> {
  readonly id: string;
  readonly exports: T;
  readonly dependencies: readonly string[];
}

export interface ServerModuleRuntime {
  import<T>(source: string): Promise<LoadedModule<T>>;
  dependencies(source: string): readonly string[];
  importers(source: string): readonly string[];
}

export interface ClientModuleRuntime {
  build(entries: readonly ClientEntry[]): Promise<ClientManifest>;
  invalidate(source: string): Promise<ClientUpdate>;
}
```

- Production Server adapter 使用预编译 ESM。
- Development adapter 是独立可选包，不进入默认生产依赖闭包。
- Client adapter 生成 Page/Layout manifest 和 browser chunks。
- 当前绿地 Runtime 已以可选 `ModuleRuntime.loadClientModule(source, request)` 固定该 port；默认 ESM adapter 不实现它，因此不会在 Node 端执行 Page/Layout TSX。
- `@zhin.js/next-client-build` 实现了可选 TypeScript AST/build adapter：动态 metadata 带位置失败，chunk/manifest 使用 content hash，生产 loader 不依赖构建机绝对路径。
- RootController 不 import Vite 类型，只依赖以上 ports。

## 8. Invalidation Planner

```ts
export type ReloadPlan =
  | { readonly kind: 'none'; readonly changed: readonly string[] }
  | {
      readonly kind: 'generation';
      readonly changed: readonly string[];
      readonly slots: readonly CapabilityId[];
      readonly subtrees: readonly PluginId[];
    }
  | { readonly kind: 'process'; readonly changed: readonly string[] };

export function planReload(
  changed: readonly string[],
  ownership: SourceOwnershipIndex,
  affectedSources: (source: string) => readonly string[],
): ReloadPlan {
  // lock/workspace files -> process
  // plugin/schema/manifest/feature entry -> owner subtree(s)
  // capability entry or its reverse import closure -> slot(s)
  // untracked file inside a mounted package -> nearest owner subtree
}
```

subtree roots 会折叠祖先/后代重复项；已被 subtree 覆盖的 slot 会被删除。共享 support module、多 owner、Root change、lockfile 与 cycle-safe reverse closure 都要覆盖测试。

## 9. HMR Coordinator

```ts
export class HmrCoordinator {
  constructor(
    private readonly modules: ModuleRuntime,
    private readonly ownership: () => SourceOwnershipIndex,
    private readonly reload: (plan: GenerationReloadPlan) => Promise<void>,
    private readonly onRestartRequired: (plan: ProcessReloadPlan) => void,
  ) {}

  enqueue(source: string): Promise<void> {
    // 同一 microtask 的 watcher burst 合并；transaction 严格串行。
  }
}
```

Coordinator 不先 stop active Plugin。Capability executor 只选择性 load 目标 definition；subtree executor 只为受影响 Plugin forest 创建 shadow Scope，并复用未变化 ancestor/sibling 的独立 lifetime。manifest executor 重新解析完整候选 graph，再由 `TopologyTransactionPlanner` 计算 added/removed/replaced child roots、Feature mounts 与 provider package 变化：新增 child 只 setup 新 forest，删除 child 只退出候选 snapshot，移动 child 是旧 owner remove + 新 owner add；Feature mount 变化只刷新对应 owner 的 Slot，不执行 Plugin setup。三条路径都通过共享 `FeatureProjector` 重建所有 projection，再由 RootController CAS 发布完整 snapshot；失败会回滚 shadow disposer 并保持 active generation。成功后旧 generation 才进入 lease drain/dispose。排他 socket/worker 可由 Plugin 注册 Resource handoff：commit 前暂停 previous admission 并激活 shadow，失败时逆序撤销并恢复 previous，commit 后才开放 next admission。Root setup/schema 由 InvalidationPlanner 直接升级为 process plan；manifest candidate 若改变 Root runtime contract、package ESM ABI、engine、Feature API 或 Plugin execution runtime，则由 `RestartBoundaryPlanner` 在 commit 前升级。Feature provider 源码、未知 importer 与混合 burst 仍走完整 shadow generation。

`RootProcessRestartExecutor` 是 process plan 的可选执行器：先调用 Root `stop()` 阻止 admission、等待全部 snapshot lease、children-first dispose 并关闭 ModuleRuntime，再调用 Host restart adapter。它保留首次 execution promise，确保同一进程 incarnation 不会重复 stop 或重复请求 supervisor。只需要人工提示的 Host 可以不使用 executor，直接处理 `onRestartRequired`。

## 10. Config/HMR 测试矩阵

- Root `plugin` 与 children `plugins` envelope 正确投影。
- 父 schema property 与 child instance key 冲突时启动失败。
- ConfigView 不包含 child 字段。
- 多 owner config patch 先整体校验，再折叠为最浅 replacement forest。
- 相同值与删除不存在路径既不写文档也不发布空 generation；显式写入 schema default 只写文档。
- YAML patch 保留注释、`${ENV}` 和无关节点。
- YAML revision 冲突拒绝覆盖外部编辑；generation 回滚恢复原始文件字节。
- 同一个 support module 变化会批量替换全部 importer Slot。
- `plugin.ts`/`schema.json` 变化升级为 subtree。
- manifest 新增、删除、移动 child 时只 setup 新增/替换 forest，稳定 ancestor/sibling Scope 不重建。
- Feature mount 新增、删除、移动不执行 Plugin setup；Feature package entry 变化刷新全部 owner。
- 等价 manifest 不发布空 generation；topology prepare 失败保持 active graph 与 Scope lifetime。
- Root setup/schema 不进入 generation prepare；package ABI 升级不会误报为普通 reload error。
- process executor 先 drain/stop Root、后调用 Host adapter，且多个请求只执行一次。
- client Page/Layout 变化不触发 Server Plugin setup。
- shadow validation/compile/setup 任一步失败时 active generation 不变。
- handoff 激活失败时只撤销已激活 Resource，并恢复 previous admission。
- `openNext` 失败通过控制面错误处理器报告，不回滚已提交 generation。
- HMR burst 串行化，过期 expected generation 不可提交。
