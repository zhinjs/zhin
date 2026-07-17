# Config、Discovery 与 HMR

这三个模块位于 Root 组合层，共享 Plugin tree 和 source ownership，但分别保持单一职责：Config 产生 owner-scoped values，Discovery 产生 Slot，HMR 只规划并提交 generation。

## 0. Root Resource Contracts

基础能力通过小 interface 和稳定 Token 暴露：

```ts
export interface RuntimeEnvironment {
  readonly mode: string;
  readonly platform: string;
  is(mode: string): boolean;
}

export interface EnvSchema<T> {
  parse(source: Readonly<Record<string, string | undefined>>): T;
  readonly secretKeys?: readonly string[];
}

export interface EnvStore {
  parse<T>(schema: EnvSchema<T>): Readonly<T>;
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

export const EnvironmentToken = createToken<RuntimeEnvironment>('zhin.environment');
export const EnvToken = createToken<EnvStore>('zhin.env');
export const DatabaseToken = createToken<DatabaseView>('zhin.database');
export const LoggerToken = createToken<Logger>('zhin.logger');
```

Root Bootstrap 私有持有 process env、database pool 和 logger factory，并为每个 Plugin owner 生成 EnvStore/DatabaseView/Logger binding。Plugin 看不到 pool 的 `close()`；只有 Root generation disposer 能关闭物理资源。

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
  read(): Promise<unknown>;
  patch(operations: readonly ConfigPatch[]): Promise<void>;
}

export interface ConfigPatch {
  readonly path: readonly string[];
  readonly value: unknown;
}

export interface ValidationIssue {
  readonly pointer: string;
  readonly keyword: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export interface SchemaCompiler {
  compile<T>(schema: JsonSchema): (input: unknown) => ValidationResult<T>;
  defaults(schema: JsonSchema): unknown;
}
```

`ConfigDocumentPort` 的 YAML 实现使用 AST patch 保留注释、`${ENV}` 和格式。JSON Schema compiler 应由成熟实现适配；Kernel 与 Plugin 作者不感知具体库。

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

标准 Agent Feature 扫描 `agents/<name>.md`，Command Feature 扫描 `commands/<name>.ts|tsx`。这些约定属于各自 provider，而不是此模块的常量。Discovery 只返回 source descriptors；Server/Client Module Runtime 或 Markdown parser 负责加载。完整 contract 见 [Plugin Monorepo 与 Feature Provider](./plugin-monorepo-and-features.md)。

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

Coordinator 不先 stop active Plugin。Capability executor 只选择性 load 目标 definition；subtree executor 只为受影响 Plugin forest 创建 shadow Scope，并复用未变化 ancestor/sibling 的独立 lifetime。两条路径都通过共享 `FeatureProjector` 重建所有 projection，再由 RootController CAS 发布完整 snapshot；失败会回滚 shadow disposer 并保持 active generation。成功后旧 generation 才进入 lease drain/dispose。Root、manifest、Feature provider、未知 importer 与 topology 变化仍走完整 shadow generation；排他 socket/worker 的 Resource handoff 留待后续阶段。

## 10. Config/HMR 测试矩阵

- Root `plugin` 与 children `plugins` envelope 正确投影。
- 父 schema property 与 child instance key 冲突时启动失败。
- ConfigView 不包含 child 字段。
- YAML patch 保留注释、`${ENV}` 和无关节点。
- 同一个 support module 变化会批量替换全部 importer Slot。
- `plugin.ts`/`schema.json` 变化升级为 subtree。
- client Page/Layout 变化不触发 Server Plugin setup。
- shadow validation/compile/setup 任一步失败时 active generation 不变。
- HMR burst 串行化，过期 expected generation 不可提交。
