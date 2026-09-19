import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HOST_CONFIG_KEYS } from '@zhin.js/runtime';

const HOST_CONFIG_KEY_SET = new Set<string>(HOST_CONFIG_KEYS);

/**
 * 读取插件 schema.json，并转换为 Console 表单使用的 `@zhin.js/schema` toJSON 形态。
 * `pluginName` 支持 instanceKey（`icqq`）或包名（`@zhin.js/adapter-icqq`）。
 */
export async function readPluginSchema(
  projectRoot: string,
  pluginName?: string,
): Promise<unknown> {
  if (!pluginName) return null;
  if (HOST_CONFIG_KEY_SET.has(pluginName)) {
    // Host 键无插件 schema.json；返回宽松 object，避免表单空白
    return jsonSchemaToConsoleSchema({ type: 'object', additionalProperties: true });
  }
  const raw = await loadRawPluginSchemaJson(projectRoot, pluginName);
  if (raw == null) return null;
  return jsonSchemaToConsoleSchema(raw);
}

async function loadRawPluginSchemaJson(
  projectRoot: string,
  pluginName: string,
): Promise<unknown> {
  const candidates: string[] = [
    join(projectRoot, 'node_modules', pluginName, 'schema.json'),
  ];
  const packageName = (await readPluginPackageMap(projectRoot)).get(pluginName);
  if (packageName && packageName !== pluginName) {
    candidates.push(join(projectRoot, 'node_modules', packageName, 'schema.json'));
  }
  // 本地 workspace 插件（package.json 里没映射时，按常见 plugins/* 路径尝试无意义；仅 node_modules）
  for (const file of candidates) {
    try {
      const text = await readFile(file, 'utf8');
      return JSON.parse(text) as unknown;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * JSON Schema (draft-2020 / 插件 schema.json) → Console Schema JSON
 * （`@zhin.js/schema` `toJSON()`：`{ type, object?, list?, inner?, key?, description?, ... }`）。
 *
 * Remote Console 表单按该形态渲染；直接返回 JSON Schema 会导致字段无法展开。
 */
export function jsonSchemaToConsoleSchema(
  input: unknown,
  key?: string,
): Record<string, unknown> | null {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) return null;
  const schema = input as Record<string, unknown>;

  // 已是 Console Schema 形态则透传；勿把 JSON Schema 的 enum/integer/properties 误判为已转换
  if (isConsoleSchemaJson(schema)) {
    return key && schema.key == null ? { ...schema, key } : { ...schema };
  }

  const typeField = schema.type;
  const description = typeof schema.description === 'string' ? schema.description : undefined;
  const defaultValue = schema.default;
  const requiredFlag = schema.required === true ? true : undefined;

  // type: ["string","number"] → union of scalars
  if (Array.isArray(typeField)) {
    const list = typeField
      .filter((t): t is string => typeof t === 'string')
      .map((t) => jsonSchemaToConsoleSchema({ type: t }, undefined))
      .filter((s): s is Record<string, unknown> => s != null);
    return compactMeta({
      type: 'union',
      key,
      description,
      default: defaultValue,
      list,
    });
  }

  const type = typeof typeField === 'string' ? typeField : inferJsonSchemaType(schema);

  if (type === 'object' || schema.properties != null) {
    const properties = (schema.properties && typeof schema.properties === 'object'
      && !Array.isArray(schema.properties))
      ? schema.properties as Record<string, unknown>
      : {};
    const requiredList = Array.isArray(schema.required)
      ? new Set(schema.required.map(String))
      : new Set<string>();
    const object: Record<string, unknown> = {};
    for (const [propKey, propSchema] of Object.entries(properties)) {
      const converted = jsonSchemaToConsoleSchema(propSchema, propKey);
      if (!converted) continue;
      if (requiredList.has(propKey)) converted.required = true;
      object[propKey] = converted;
    }
    // additionalProperties: Schema → dict
    if (
      Object.keys(object).length === 0
      && schema.additionalProperties
      && typeof schema.additionalProperties === 'object'
    ) {
      const inner = jsonSchemaToConsoleSchema(schema.additionalProperties);
      return compactMeta({
        type: 'dict',
        key,
        description,
        default: defaultValue,
        inner: inner ?? { type: 'any' },
      });
    }
    return compactMeta({
      type: 'object',
      key,
      description,
      default: defaultValue,
      required: requiredFlag,
      object,
    });
  }

  if (type === 'array') {
    const items = schema.items;
    const inner = Array.isArray(items)
      ? { type: 'any' as const }
      : (jsonSchemaToConsoleSchema(items) ?? { type: 'any' });
    return compactMeta({
      type: 'list',
      key,
      description,
      default: defaultValue,
      required: requiredFlag,
      inner,
      ...(Array.isArray(schema.enum)
        ? { options: schema.enum.map((value) => ({ label: String(value), value })) }
        : {}),
    });
  }

  // enum on scalar → options
  const options = Array.isArray(schema.enum)
    ? schema.enum.map((value) => ({ label: String(value), value }))
    : undefined;

  const mappedType = type === 'integer' ? 'number' : (type ?? 'any');
  return compactMeta({
    type: mappedType,
    key,
    description,
    default: defaultValue,
    required: requiredFlag,
    min: typeof schema.minimum === 'number' ? schema.minimum : undefined,
    max: typeof schema.maximum === 'number' ? schema.maximum : undefined,
    options,
  });
}

/** Console Schema JSON（@zhin.js/schema toJSON）vs 插件 schema.json（JSON Schema）。 */
function isConsoleSchemaJson(schema: Record<string, unknown>): boolean {
  if (schema.object != null || schema.list != null || schema.inner != null) return true;
  // Console-only types
  if (typeof schema.type === 'string'
    && ['dict', 'union', 'tuple', 'intersect', 'const', 'any', 'date', 'regexp'].includes(schema.type)) {
    return true;
  }
  // JSON Schema markers → not Console Schema
  if (
    schema.properties != null
    || schema.items != null
    || schema.$schema != null
    || schema.additionalProperties != null
    || schema.anyOf != null
    || schema.oneOf != null
    || schema.allOf != null
    || schema.enum != null
    || schema.minimum != null
    || schema.maximum != null
    || schema.type === 'integer'
    || Array.isArray(schema.type)
  ) {
    return false;
  }
  // Bare Console scalar e.g. { type: 'string', key: 'name', description: '…' }
  return typeof schema.type === 'string';
}

function inferJsonSchemaType(schema: Record<string, unknown>): string | undefined {
  if (schema.properties != null) return 'object';
  if (schema.items != null) return 'array';
  if (schema.enum != null) return typeof schema.enum === 'object'
    && Array.isArray(schema.enum)
    && schema.enum.length > 0
    ? typeof schema.enum[0]
    : 'string';
  return undefined;
}

function compactMeta(meta: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(meta).filter(([, value]) => value !== undefined),
  );
}

/** instanceKey → package 映射（来自项目 package.json 的 `zhin.plugins`）。 */
export async function readPluginPackageMap(
  projectRoot: string,
): Promise<ReadonlyMap<string, string>> {
  const map = new Map<string, string>();
  try {
    const pkg = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')) as {
      readonly zhin?: { readonly plugins?: unknown };
    };
    const list = pkg.zhin?.plugins;
    if (Array.isArray(list)) {
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const entry = item as { readonly package?: unknown; readonly instanceKey?: unknown };
        if (typeof entry.package !== 'string') continue;
        map.set(String(entry.instanceKey ?? entry.package), entry.package);
      }
    }
  } catch {
    // 无 package.json 或格式不符 — 返回空映射
  }
  return map;
}

export async function readPluginSchemas(
  projectRoot: string,
  keys: Iterable<string>,
): Promise<Record<string, unknown>> {
  const schemas: Record<string, unknown> = {};
  for (const key of keys) {
    const schema = await readPluginSchema(projectRoot, key);
    if (schema != null) schemas[key] = schema;
  }
  return schemas;
}
