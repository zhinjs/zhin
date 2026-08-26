import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js';
import type { PluginId } from '@zhin.js/plugin-runtime';
import type { PluginGraphNode, ProjectGraph } from './project-graph.js';
import hostConfigSchema from './host-config-schema.json' with { type: 'json' };

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

const HOST_CONFIG_SCHEMA = deepFreeze(hostConfigSchema);

/** Host configuration keys consumed by Runtime composition and Host installers. */
export const HOST_CONFIG_KEYS = Object.freeze(Object.keys(HOST_CONFIG_SCHEMA.properties));

export type JsonSchema = Readonly<Record<string, unknown>>;
export type RuntimeConfigDocument = Readonly<Record<string, unknown>>;

export interface ComposedConfig {
  readonly effectiveSchema: JsonSchema;
  readonly document: RuntimeConfigDocument;
  readonly views: ReadonlyMap<PluginId, unknown>;
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
  constructor(private readonly inactivePluginInstanceKeys: readonly string[] = []) {}

  async compose(
    graph: ProjectGraph,
    input: RuntimeConfigDocument = {},
    /** Source config file name, annotated on ConfigValidationError. */
    source?: string,
  ): Promise<ComposedConfig> {
    // Effective schemas include child namespaces for whole-tree validation;
    // ownSchemas retain each package's private configuration contract.
    const ownSchemas = new Map<PluginId, JsonSchema>();
    const rootOwn = await readOwnSchema(graph.root);
    ownSchemas.set(graph.root.id, rootOwn);
    const childSchemas = await Promise.all(
      graph.root.children.map(async (child) => [
        child.instanceKey,
        await composeNode(child, ownSchemas),
      ] as const),
    );
    // Host-level keys (`http`, `database`, `ai`, `mcp`, `a2a`, `speech`,
    // `htmlRenderer`, `assistant`, `log_level`) are consumed by CLI Root installers /
    // start-command, not Plugin ConfigViews.
    const effectiveSchema: JsonSchema = Object.freeze({
      type: 'object',
      additionalProperties: false,
      properties: {
        ...HOST_CONFIG_SCHEMA.properties,
        plugin: withDefault(rootOwn),
        plugins: {
          type: 'object',
          additionalProperties: false,
          default: {},
          properties: Object.fromEntries(
            [
              ...this.inactivePluginInstanceKeys.map((key) => [key, {}] as const),
              ...childSchemas.map(([key, schema]) => [key, withDefault(schema)] as const),
            ],
          ),
        },
      },
    });

    const document = structuredClone(input) as Record<string, unknown>;
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
    ajv.addKeyword({ keyword: 'x-keyPlaceholder', schemaType: 'string' });
    const validate = ajv.compile(effectiveSchema);
    if (!validate(document)) {
      throw new ConfigValidationError(formatErrors(validate.errors ?? []), source);
    }

    const views = new Map<PluginId, unknown>();
    // A Plugin never receives its effective node object because that object
    // also contains descendants. Re-pick fields from the owner's own schema.
    views.set(
      graph.root.id,
      pickOwnFields(document.plugin, requireOwnSchema(ownSchemas, graph.root.id)),
    );
    collectChildViews(graph.root, document.plugins, ownSchemas, views);
    return Object.freeze({
      effectiveSchema,
      document: Object.freeze(document),
      views,
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
): Promise<JsonSchema> {
  const own = await readOwnSchema(node);
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
    properties[child.instanceKey] = withDefault(await composeNode(child, ownSchemas));
  }
  return Object.freeze({ ...own, properties });
}

async function readOwnSchema(node: PluginGraphNode): Promise<JsonSchema> {
  const file = join(node.package.root, 'schema.json');
  let value: unknown;
  try {
    value = JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      value = { type: 'object', additionalProperties: false, properties: {} };
    } else {
      throw error;
    }
  }
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
  return Object.freeze({
    $id: `urn:zhin:plugin-config:${encodeURIComponent(String(node.id))}`,
    type: 'object',
    additionalProperties: false,
    ...schema,
    properties: schemaProperties(schema),
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
