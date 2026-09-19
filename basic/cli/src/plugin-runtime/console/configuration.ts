import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { getLogger } from '@zhin.js/logger';
import { readPluginConfigurationMap } from '@zhin.js/plugin-runtime';
import { HOST_CONFIG_KEYS, type RuntimeConfigDocument } from '@zhin.js/runtime';

export async function readProjectConfigYaml(projectRoot: string): Promise<string> {
  const file = await findConfigFile(projectRoot);
  if (!file) return '';
  return readFile(file, 'utf8');
}

export async function readProjectConfigDocument(projectRoot: string): Promise<Record<string, unknown>> {
  const file = await findConfigFile(projectRoot);
  if (!file) return {};
  const text = await readFile(file, 'utf8');
  if (file.endsWith('.json')) {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }
  const value = parseYaml(text) as unknown;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Host 级配置键（与 ConfigComposer 对齐）。
 * 这些键在文档顶层；插件配置在 `plugins.<instanceKey>`。
 */
const HOST_CONFIG_KEY_SET = new Set<string>(HOST_CONFIG_KEYS);

const consoleApiLogger = getLogger('ConsoleApi');

/**
 * 禁止作为配置键的名称：写入 `__proto__`/`constructor`/`prototype`
 * 会污染对象原型，且 `__proto__` 经 YAML/JSON 序列化后丢失。
 */
const FORBIDDEN_CONFIG_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Owns one project's Console configuration I/O and write serialization. */
export class ConsoleConfigurationStore {
  readonly #projectRoot: string;
  #writeTail: Promise<unknown> = Promise.resolve();

  constructor(projectRoot: string) {
    this.#projectRoot = projectRoot;
  }

  readYaml(): Promise<string> {
    return readProjectConfigYaml(this.#projectRoot);
  }

  async readDocument(): Promise<Record<string, unknown>> {
    return flattenConfigDocument(await readProjectConfigDocument(this.#projectRoot));
  }

  writeYaml(yaml: string): Promise<void> {
    return writeProjectConfigYaml(this.#projectRoot, yaml);
  }

  setKey(pluginName: string, data: unknown): Promise<{ restartRequired: boolean }> {
    const run = this.#writeTail.then(
      () => applyProjectConfigKey(this.#projectRoot, pluginName, data),
      () => applyProjectConfigKey(this.#projectRoot, pluginName, data),
    );
    this.#writeTail = run.catch(() => undefined);
    return run;
  }

  readEnvironmentFile(filename: string): Promise<string> {
    return readEnvFile(this.#projectRoot, filename);
  }

  writeEnvironmentFile(filename: string, content: string): Promise<void> {
    return writeEnvFile(this.#projectRoot, filename, content);
  }

  readSchema(pluginName?: string): Promise<unknown> {
    return readPluginSchema(this.#projectRoot, pluginName);
  }

  readAllSchemas(): Promise<Record<string, unknown>> {
    return readAllPluginSchemas(this.#projectRoot);
  }

  listKeys(primaryConfigDocument?: RuntimeConfigDocument): Promise<string[]> {
    return listConsoleConfigKeys(this.#projectRoot, primaryConfigDocument);
  }
}

function isForbiddenConfigKey(key: string): boolean {
  return FORBIDDEN_CONFIG_KEYS.has(key);
}

/** 安全写 own property（`__proto__` 等键走 defineProperty，避免触发原型 setter）。 */
function setOwnKey(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * Console 视角的扁平配置：
 * - 顶层 host 键（http / database / …）原样
 * - `plugins.<key>` 展开为顶层 `key`（与 legacy `config:get(pluginName)` 契约一致）
 */
export async function readConsoleConfigDocument(
  projectRoot: string,
): Promise<Record<string, unknown>> {
  return flattenConfigDocument(await readProjectConfigDocument(projectRoot));
}

export function flattenConfigDocument(
  document: Record<string, unknown>,
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document)) {
    if (key === 'plugins' || isForbiddenConfigKey(key)) continue;
    setOwnKey(flat, key, value);
  }
  for (const [key, value] of Object.entries(readPluginConfigurationMap(document))) {
    if (isForbiddenConfigKey(key)) continue;
    // Host 键优先：plugins.<key> 与顶层键同名（如 instanceKey 叫 ai/http）时跳过，
    // 否则读写路径互相覆写（读 flat 拿到插件值、写 writeConfigKey 落到顶层 host 键）。
    if (Object.prototype.hasOwnProperty.call(flat, key)) {
      consoleApiLogger.warn(
        `plugins.${key} 与顶层 host 配置键同名，Console 扁平视图以 host 键为准，plugins.${key} 被跳过`,
      );
      continue;
    }
    setOwnKey(flat, key, value);
  }
  return flat;
}

/** 配置 Tab 列表：host 键（有值）+ plugins 键 + package.json zhin.plugins。 */
export async function listConsoleConfigKeys(
  projectRoot: string,
  primaryConfigDocument?: RuntimeConfigDocument,
): Promise<string[]> {
  const document = primaryConfigDocument ?? await readProjectConfigDocument(projectRoot);
  const keys = new Set<string>();
  for (const key of HOST_CONFIG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(document, key)) keys.add(key);
  }
  for (const key of Object.keys(readPluginConfigurationMap(document))) keys.add(key);
  for (const key of (await readPluginPackageMap(projectRoot)).keys()) keys.add(key);
  return [...keys].sort((a, b) => a.localeCompare(b));
}

async function findConfigFile(projectRoot: string): Promise<string | undefined> {
  for (const candidate of [
    'config.yml', 'config.yaml', 'config.json', 'zhin.config.yml', 'zhin.config.yaml',
  ]) {
    const file = join(projectRoot, candidate);
    try {
      await access(file);
      return file;
    } catch {
      /* try next */
    }
  }
  return undefined;
}

async function ensureConfigFile(projectRoot: string): Promise<string> {
  const existing = await findConfigFile(projectRoot);
  if (existing) return existing;
  return join(projectRoot, 'zhin.config.yml');
}

export async function writeProjectConfigYaml(projectRoot: string, yaml: string): Promise<void> {
  // 写入前试解析：损坏的 YAML 一旦落盘，下次启动 runtime 将无法加载配置。
  // 解析失败抛错，RPC 层（/console/request）映射为 HTTP 400。
  try {
    parseYaml(yaml);
  } catch (error) {
    throw new Error(
      `Invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const file = await ensureConfigFile(projectRoot);
  await writeFile(file, yaml, 'utf8');
}

async function applyProjectConfigKey(
  projectRoot: string,
  pluginName: string,
  data: unknown,
): Promise<{ restartRequired: boolean }> {
  const file = await ensureConfigFile(projectRoot);
  const document = await readProjectConfigDocument(projectRoot);
  writeConfigKey(document, pluginName, data);
  if (file.endsWith('.json')) {
    await writeFile(file, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  } else {
    await writeFile(file, stringifyYaml(document), 'utf8');
  }
  return { restartRequired: true };
}

export function writeConfigKey(
  document: Record<string, unknown>,
  key: string,
  data: unknown,
): void {
  // `__proto__` 等键：`key in document` 恒为 true 会写原型，且序列化后丢失，直接拒绝。
  if (isForbiddenConfigKey(key)) {
    throw new Error(`Invalid config key: ${key}`);
  }
  const plugins = readPluginConfigurationMap(document);
  const inPlugins = Object.prototype.hasOwnProperty.call(plugins, key);

  // Host 键或非 plugins 命名空间的顶层键写顶层；其余写 plugins.<key>
  if (HOST_CONFIG_KEY_SET.has(key)
    || (Object.prototype.hasOwnProperty.call(document, key) && key !== 'plugins' && !inPlugins)) {
    setOwnKey(document, key, data);
    return;
  }
  const bucket = document.plugins === undefined
    ? {}
    : plugins as Record<string, unknown>;
  setOwnKey(bucket, key, data);
  document.plugins = bucket;
}

const ENV_FILES = new Set(['.env', '.env.development', '.env.production']);

export async function readEnvFile(projectRoot: string, filename: string): Promise<string> {
  if (!ENV_FILES.has(filename)) throw new Error(`Invalid env file: ${filename}`);
  const file = join(projectRoot, filename);
  try {
    return await readFile(file, 'utf8');
  } catch {
    return '';
  }
}

export async function writeEnvFile(projectRoot: string, filename: string, content: string): Promise<void> {
  if (!ENV_FILES.has(filename)) throw new Error(`Invalid env file: ${filename}`);
  await writeFile(join(projectRoot, filename), content, 'utf8');
}

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
    // Dual-emit: @zhin.js/schema toJSON uses `object`; PluginConfigForm nested
    // renderers historically read `dict` / `properties`. Emit all three so list
    // item forms (endpoints[]) can expand fields and support add/remove.
    return compactMeta({
      type: 'object',
      key,
      description,
      default: defaultValue,
      required: requiredFlag,
      object,
      properties: object,
      dict: object,
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

export async function readAllPluginSchemas(
  projectRoot: string,
): Promise<Record<string, unknown>> {
  const keys = await listConsoleConfigKeys(projectRoot);
  const schemas: Record<string, unknown> = {};
  for (const key of keys) {
    const schema = await readPluginSchema(projectRoot, key);
    if (schema != null) schemas[key] = schema;
  }
  return schemas;
}
