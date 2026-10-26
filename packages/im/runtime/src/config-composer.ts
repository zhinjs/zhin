import type { RuntimeConfigDocument, PluginId } from '@zhin.js/plugin-runtime';
import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js';
import type { PluginGraphNode, ProjectGraph } from './project-graph.js';
import hostConfigSchema from './host-config-schema.json' with { type: 'json' };
import { readPluginConfigSchema } from './plugin-config-schema.js';
import type { ModuleRuntime } from './module-runtime.js';
import { readApplicationPluginDeclaration } from './application-plugin-declaration.js';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export const HOST_CONFIG_SCHEMA = deepFreeze(hostConfigSchema);

/** Host configuration keys consumed by Runtime composition and Host installers. */
export const HOST_CONFIG_KEYS = Object.freeze(Object.keys(HOST_CONFIG_SCHEMA.properties));

const ROOT_FEATURE_CONFIG_KEYS = ['menuKeyword', 'menuStyle', 'locale'] as const;
/** Command routing keys the framework injects into every Plugin config schema. */
const COMMAND_CONFIG_KEYS = ['commandNamespace', 'disabledCommands'] as const;

export type JsonSchema = Readonly<Record<string, unknown>>;
export interface ComposedConfig {
  readonly effectiveSchema: JsonSchema;
  readonly document: RuntimeConfigDocument;
  readonly views: ReadonlyMap<PluginId, unknown>;
  readonly ownSchemas: ReadonlyMap<PluginId, JsonSchema>;
}

export class ConfigSchemaCollisionError extends Error {
  constructor(readonly plugin: PluginId, readonly instanceKey: string) {
    super(`Config property ${instanceKey} in ${plugin} collides with a child Plugin`);
    this.name = 'ConfigSchemaCollisionError';
  }
}

export class ConfigValidationError extends Error {
  constructor(
    readonly issues: readonly string[],
    /** Source config file name, when known (e.g. `zhin.config.yml`). */
    readonly source?: string,
  ) {
    super(`Invalid Plugin config${source ? ` in ${source}` : ''}:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.name = 'ConfigValidationError';
  }
}

export class ConfigComposer {
  constructor(
    private readonly inactivePluginInstanceKeys: readonly string[] = [],
    private readonly modules?: Pick<ModuleRuntime, 'load'>,
    /** Previously validated generation declarations; never import retired owners just to compare inputs. */
    private readonly validatedSchemas?: ReadonlyMap<PluginId, JsonSchema>,
  ) {}

  async compose(
    graph: ProjectGraph,
    input: RuntimeConfigDocument = {},
    /** Source config file name, annotated on ConfigValidationError. */
    source?: string,
  ): Promise<ComposedConfig> {
    const declaration = readApplicationPluginDeclaration(input, source);
    if (this.inactivePluginInstanceKeys.length > 0) {
      throw new TypeError('Legacy disabled Plugin state must move to disable_plugins; see docs/migrations/plugin-instance-declarations.md');
    }
    const enabledKeys = new Set(declaration.instances.filter(instance => instance.enabled).map(instance => instance.instanceKey));
    if (enabledKeys.size !== graph.root.children.length
      || graph.root.children.some(child => !enabledKeys.has(child.instanceKey))) {
      throw new TypeError('Compose configuration against its candidate application graph before loading Plugin schemas');
    }
    // Effective schemas include child namespaces for whole-tree validation;
    // ownSchemas retain each package's private configuration contract.
    const ownSchemas = new Map<PluginId, JsonSchema>();
    const rootOwn = await readOwnSchema(graph.root, this.modules, this.validatedSchemas);
    ownSchemas.set(graph.root.id, rootOwn);
    const childSchemas = await Promise.all(
      graph.root.children.map(async (child) => [
        child.instanceKey,
        await composeNode(child, ownSchemas, this.modules, this.validatedSchemas),
      ] as const),
    );
    const childSchemaByKey = new Map(childSchemas);
    // Host-level keys (`http`, `database`, `ai`, `mcp`, `a2a`, `speech`,
    // `htmlRenderer`, `assistant`, `log_level`) are consumed by CLI Root installers /
    // start-command, not Plugin ConfigViews.
    const effectiveSchema: JsonSchema = Object.freeze({
      type: 'object',
      $defs: HOST_CONFIG_SCHEMA.$defs,
      additionalProperties: false,
      properties: {
        ...HOST_CONFIG_SCHEMA.properties,
        plugin: withDefault(rootOwn),
        configVersion: { const: 2 },
        plugins: { type: 'object', additionalProperties: { type: 'string' }, default: {} },
        disable_plugins: { type: 'array', items: { type: 'string' }, default: [] },
        ...Object.fromEntries(declaration.instances.map(instance => {
          const schema = childSchemaByKey.get(instance.instanceKey);
          if (instance.enabled && !schema) throw new TypeError(`Candidate graph is missing enabled Plugin ${instance.instanceKey}`);
          return [instance.instanceKey, instance.enabled && schema ? withDefault(schema) : { type: 'object' }];
        })),
      },
    });

    const document = structuredClone(input) as Record<string, unknown>;
    const ajv = configurationValidator();
    const validate = ajv.compile(effectiveSchema);
    if (!validate(document)) {
      throw new ConfigValidationError(formatErrors(validate.errors ?? []), source);
    }

    const views = new Map<PluginId, unknown>();
    // A Plugin never receives its effective node object because that object
    // also contains descendants. Re-pick fields from the owner's own schema.
    views.set(
      graph.root.id,
      // Built-in menu settings belong to the application, but Command Feature
      // consumes the root's generation view. Project only these reserved fields;
      // Host credentials and other instances never enter a Plugin ConfigView.
      Object.freeze({
        ...pickOwnFields(document.plugin, requireOwnSchema(ownSchemas, graph.root.id)),
        ...Object.fromEntries(ROOT_FEATURE_CONFIG_KEYS
          .filter(key => Object.hasOwn(document, key))
          .map(key => [key, deepFreeze(structuredClone(document[key]))])),
      }),
    );
    collectChildViews(graph.root, document, ownSchemas, views);
    return Object.freeze({
      effectiveSchema,
      document: Object.freeze(document),
      views,
      ownSchemas,
    });
  }
}

const FRAMEWORK_ROLE_SCHEMA: Readonly<Record<string, JsonSchema>> = Object.freeze({
  master: Object.freeze({
    type: ['string', 'number'] as unknown,
    description: 'Framework master user id (AI/tool privileges; not group owner/admin)',
  }),
  trusted: Object.freeze({
    type: 'array',
    items: Object.freeze({ type: ['string', 'number'] as unknown }),
    description: 'Framework trusted user id list (weaker than master)',
  }),
});

function hasArrayEndpoints(props: Record<string, JsonSchema>): boolean {
  const ep = props.endpoints;
  if (!ep || typeof ep !== 'object') return false;
  return (ep as Record<string, unknown>).type === 'array';
}

/** 顶层 + endpoints[].properties 注入 master/trusted（已声明则不覆盖） */
function injectFrameworkRoleSchema(properties: Record<string, JsonSchema>): void {
  for (const [key, schema] of Object.entries(FRAMEWORK_ROLE_SCHEMA)) {
    if (!Object.hasOwn(properties, key)) {
      properties[key] = schema;
    }
  }
  if (!hasArrayEndpoints(properties)) return;
  const ep = properties.endpoints as Record<string, unknown>;
  const items = ep.items;
  if (!items || typeof items !== 'object' || Array.isArray(items)) return;
  const itemsObj = items as Record<string, unknown>;
  const rawProps = itemsObj.properties;
  const itemProps: Record<string, JsonSchema> =
    rawProps && typeof rawProps === 'object' && !Array.isArray(rawProps)
      ? { ...(rawProps as Record<string, JsonSchema>) }
      : {};
  let changed = false;
  for (const [key, schema] of Object.entries(FRAMEWORK_ROLE_SCHEMA)) {
    if (!Object.hasOwn(itemProps, key)) {
      itemProps[key] = schema;
      changed = true;
    }
  }
  if (!changed) return;
  properties.endpoints = Object.freeze({
    ...ep,
    items: Object.freeze({
      ...itemsObj,
      properties: Object.freeze(itemProps),
    }),
  }) as JsonSchema;
}

async function composeNode(
  node: PluginGraphNode,
  ownSchemas: Map<PluginId, JsonSchema>,
  modules?: Pick<ModuleRuntime, 'load'>,
  validatedSchemas?: ReadonlyMap<PluginId, JsonSchema>,
): Promise<JsonSchema> {
  const own = await readOwnSchema(node, modules, validatedSchemas);
  ownSchemas.set(node.id, own);
  const properties = { ...schemaProperties(own) };

  // Adapter plugins (schemas declaring array-typed `endpoints`) get
  // framework-level `master` / `trusted` injected when not already declared
  // (top-level and endpoints[].properties).
  if (hasArrayEndpoints(properties)) {
    injectFrameworkRoleSchema(properties);
  }

  for (const child of node.children) {
    if (Object.hasOwn(properties, child.instanceKey)) {
      throw new ConfigSchemaCollisionError(node.id, child.instanceKey);
    }
    properties[child.instanceKey] = withDefault(await composeNode(child, ownSchemas, modules, validatedSchemas));
  }
  return Object.freeze({ ...own, properties });
}

async function readOwnSchema(node: PluginGraphNode, modules?: Pick<ModuleRuntime, 'load'>, validatedSchemas?: ReadonlyMap<PluginId, JsonSchema>): Promise<JsonSchema> {
  if (validatedSchemas) {
    const schema = validatedSchemas.get(node.id);
    if (!schema) throw new TypeError(`Missing committed configuration schema for ${node.id}`);
    return schema;
  }
  const file = `${node.package.name} config`;
  const value: unknown = await readPluginConfigSchema(node.package, modules)
    ?? { type: 'object', additionalProperties: false, properties: {} };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${file} must contain a JSON Schema object`);
  }
  const { $schema: _schema, $id: _id, ...schema } = value as Record<string, unknown>;
  if (schema.type !== undefined && schema.type !== 'object') {
    throw new TypeError(`${file} root schema type must be object`);
  }
  // A compositional root (anyOf/oneOf/allOf/$ref without properties) would
  // validate but pickOwnFields only copies top-level properties, silently
  // projecting an empty ConfigView. Reject it explicitly instead.
  if (
    schema.properties === undefined
    && (schema.anyOf !== undefined || schema.oneOf !== undefined
      || schema.allOf !== undefined || schema.$ref !== undefined)
  ) {
    throw new TypeError(
      `${file} root schema must declare properties; composition keywords (anyOf/oneOf/allOf/$ref) are not supported`,
    );
  }
  const properties = schemaProperties(schema);
  for (const key of [...COMMAND_CONFIG_KEYS, ...(!node.parent ? ROOT_FEATURE_CONFIG_KEYS : [])]) {
    if (Object.hasOwn(properties, key)) throw new ConfigSchemaCollisionError(node.id, key);
  }
  return deepFreeze({
    $id: `urn:zhin:plugin-config:${encodeURIComponent(String(node.id))}`,
    type: 'object',
    additionalProperties: false,
    ...schema,
    properties: {
      commandNamespace: {
        type: 'string',
        minLength: 1,
        pattern: '^\\S+(?: \\S+)*$',
        description: 'Explicit command namespace prepended after the Endpoint commandPrefix.',
        'x-descriptionZh': '显式指令命名空间；在 Endpoint commandPrefix 之后参与路由。',
      },
      disabledCommands: {
        type: 'array',
        uniqueItems: true,
        items: { type: 'string', minLength: 1, pattern: '^\\S+(?: \\S+)*$' },
        description: 'Commands of this Plugin instance to leave out of routing, by local path without commandNamespace or parameters (e.g. "fanyi", "netease login"). A parent path also disables its subcommands.',
        'x-descriptionZh': '不注册的指令：写插件内的指令路径（不含 commandNamespace 和参数，如 fanyi、netease login），写上级路径会连同子命令一起禁用。',
      },
      ...properties,
    },
  });
}

function schemaProperties(schema: JsonSchema): Record<string, JsonSchema> {
  const properties = schema.properties;
  if (properties === undefined) return {};
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    throw new TypeError('JSON Schema properties must be an object');
  }
  return { ...(properties as Record<string, JsonSchema>) };
}

function withDefault(schema: JsonSchema): JsonSchema {
  return Object.freeze({ ...schema, default: schema.default ?? {} });
}

function collectChildViews(
  parent: PluginGraphNode,
  value: unknown,
  ownSchemas: ReadonlyMap<PluginId, JsonSchema>,
  views: Map<PluginId, unknown>,
): void {
  const record = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  for (const child of parent.children) {
    const childConfig = record[child.instanceKey] ?? Object.freeze({});
    views.set(child.id, pickOwnFields(childConfig, requireOwnSchema(ownSchemas, child.id)));
    collectChildViews(child, childConfig, ownSchemas, views);
  }
}

function pickOwnFields(value: unknown, schema: JsonSchema): Readonly<Record<string, unknown>> {
  const record = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(schemaProperties(schema))) {
    if (Object.hasOwn(record, key)) result[key] = record[key];
  }
  return Object.freeze(result);
}

function requireOwnSchema(
  schemas: ReadonlyMap<PluginId, JsonSchema>,
  plugin: PluginId,
): JsonSchema {
  const schema = schemas.get(plugin);
  if (!schema) throw new Error(`Missing own config schema for ${plugin}`);
  return schema;
}

function formatErrors(errors: readonly ErrorObject[]): readonly string[] {
  return errors.map((error) => {
    const base = `${error.instancePath || '/'} ${error.message ?? error.keyword}`;
    // Ajv params pinpoint the offending key / allowed enum so users can find
    // the typo'd field instead of a bare "must NOT have additional properties".
    const params = error.params as Record<string, unknown> | undefined;
    if (typeof params?.additionalProperty === 'string') {
      return `${base} (additionalProperty: ${params.additionalProperty})`;
    }
    if (Array.isArray(params?.allowedValues)) {
      return `${base} (allowedValues: ${JSON.stringify(params.allowedValues)})`;
    }
    return base;
  });
}

/** Reuses Runtime validation/defaults without mutating the caller's configuration. */
export function parsePluginConfigSchema(schema: JsonSchema, input: unknown): Readonly<{
  value: unknown;
  errors: readonly ErrorObject[];
}> {
  const validate = configurationValidator().compile({
    type: 'object',
    ...(schema.$defs ? { $defs: schema.$defs } : {}),
    properties: { candidate: schema },
  });
  const candidate = { candidate: structuredClone(input === undefined ? schema.default ?? {} : input) };
  const valid = validate(candidate);
  return Object.freeze({ value: candidate.candidate, errors: valid ? [] : structuredClone(validate.errors ?? []) });
}

export function validatePluginConfigSchema(schema: JsonSchema, input: unknown): readonly ErrorObject[] {
  return parsePluginConfigSchema(schema, input).errors;
}

function configurationValidator(): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: true,
    useDefaults: true,
    strict: true,
    // 当前内置 schema 无需 union（log_level 的 ['string','number'] 是 type 数组，
    // 不触发 allowUnionTypes）；保留此项是面向未来插件 schema 可能出现的
    // anyOf/oneOf 标量 union，避免届时 Ajv strict 模式直接报错。
    allowUnionTypes: true,
  });
  ajv.addKeyword({ keyword: 'x-descriptionZh', schemaType: 'string' });
  ajv.addKeyword({ keyword: 'x-i18n', schemaType: 'object' });
  ajv.addKeyword({ keyword: 'x-keyPlaceholder', schemaType: 'string' });
  ajv.addKeyword({ keyword: 'x-zhin-config', schemaType: 'object' });
  return ajv;
}
