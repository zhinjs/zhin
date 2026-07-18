import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js';
import type { PluginId } from '@zhin.js/plugin-runtime';
import type { PluginGraphNode, ProjectGraph } from './project-graph.js';

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
    // Host-level keys (`http`, `database`, `ai`, `speech`, `assistant`,
    // `collaboration`, `log_level`) are consumed by CLI Root installers /
    // start-command, not Plugin ConfigViews.
    const effectiveSchema: JsonSchema = Object.freeze({
      type: 'object',
      additionalProperties: false,
      properties: {
        plugin: withDefault(rootOwn),
        plugins: {
          type: 'object',
          additionalProperties: false,
          default: {},
          properties: Object.fromEntries(
            childSchemas.map(([key, schema]) => [key, withDefault(schema)]),
          ),
        },
        http: Object.freeze({
          type: 'object',
          additionalProperties: true,
        }),
        database: Object.freeze({
          type: 'object',
          additionalProperties: true,
        }),
        ai: Object.freeze({
          type: 'object',
          additionalProperties: true,
        }),
        speech: Object.freeze({
          type: 'object',
          additionalProperties: true,
        }),
        assistant: Object.freeze({
          type: 'object',
          additionalProperties: true,
        }),
        collaboration: Object.freeze({
          type: 'object',
          additionalProperties: true,
        }),
        log_level: Object.freeze({
          type: ['string', 'number'],
        }),
      },
    });

    const document = structuredClone(input) as Record<string, unknown>;
    const validate = new Ajv2020({
      allErrors: true,
      useDefaults: true,
      strict: true,
      // 当前内置 schema 无需 union（log_level 的 ['string','number'] 是 type 数组，
      // 不触发 allowUnionTypes）；保留此项是面向未来插件 schema 可能出现的
      // anyOf/oneOf 标量 union，避免届时 Ajv strict 模式直接报错。
      allowUnionTypes: true,
    }).compile(effectiveSchema);
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

async function composeNode(
  node: PluginGraphNode,
  ownSchemas: Map<PluginId, JsonSchema>,
): Promise<JsonSchema> {
  const own = await readOwnSchema(node);
  ownSchemas.set(node.id, own);
  const properties = { ...schemaProperties(own) };
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
  return Object.freeze({
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
