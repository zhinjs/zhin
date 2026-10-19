import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import {
  HOST_CONFIG_KEYS,
  readApplicationPluginDeclaration,
  HOST_CONFIG_SCHEMA,
  NodePackageResolver,
  PackageResolutionError,
  type ChildPluginReference,
  type ResolvedPackage,
} from '@zhin.js/runtime';
import type { RuntimeConfigDocument } from '@zhin.js/plugin-runtime';
import { createConfigDocument } from '@zhin.js/config-file';
import { findConfigFile } from '../../utils/config-file.js';
import { isConsoleSchemaJson, jsonSchemaToConsoleSchema } from './console-schema.js';

const HOST_CONFIG_KEY_SET = new Set<string>(HOST_CONFIG_KEYS);

/** Resolves schemas using the same package roots and declarations as Runtime. */
export class PluginSchemaCatalog {
  readonly #projectRoot: string;
  readonly #declarations?: () => ReadonlyMap<string, Readonly<Record<string, unknown>>> | Promise<ReadonlyMap<string, Readonly<Record<string, unknown>>>>;

  constructor(projectRoot: string, declarations?: () => ReadonlyMap<string, Readonly<Record<string, unknown>>> | Promise<ReadonlyMap<string, Readonly<Record<string, unknown>>>>) {
    this.#projectRoot = projectRoot;
    this.#declarations = declarations;
  }

  async read(pluginName?: string, document?: RuntimeConfigDocument): Promise<unknown> {
    if (!pluginName) return null;
    return this.#read(pluginName, () => NodePackageResolver.create(this.#projectRoot), await this.#declarations?.(), false, document);
  }

  async readJson(pluginName: string, document?: RuntimeConfigDocument): Promise<Readonly<Record<string, unknown>> | null> {
    return (await this.#read(pluginName, () => NodePackageResolver.create(this.#projectRoot), await this.#declarations?.(), true, document)) as Readonly<Record<string, unknown>> | null;
  }

  async readAll(keys: Iterable<string>, document?: RuntimeConfigDocument): Promise<Record<string, unknown>> {
    let resolver: Promise<NodePackageResolver> | undefined;
    const declarations = await this.#declarations?.();
    if (!document) {
      const file = findConfigFile(this.#projectRoot);
      if (file) document = (await createConfigDocument(join(this.#projectRoot, file)).read()).document;
    }
    const entries = await Promise.all([...keys].map(async (key) => [
      key,
      await this.#read(key, () => resolver ??= NodePackageResolver.create(this.#projectRoot), declarations, false, document),
    ] as const));
    return Object.fromEntries(entries.filter((entry): entry is readonly [string, unknown] =>
      entry[1] != null));
  }

  async #read(
    pluginName: string,
    resolver: () => Promise<NodePackageResolver>,
    declarations?: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
    rawSchema = false,
    currentDocument?: RuntimeConfigDocument,
  ): Promise<unknown> {
    if (HOST_CONFIG_KEY_SET.has(pluginName)) {
      // These allowlisted sections belong to the versioned Runtime contract, not
      // third-party schema files. Preserve their existing form projection: it is
      // not a complete JSON Schema editor; Runtime remains the config validator.
      const raw = pluginName === 'plugin'
        ? declarations?.get(await realpath(this.#projectRoot)) ?? await readOwnSchema(this.#projectRoot, 'plugin', !rawSchema)
        : HOST_CONFIG_SCHEMA.properties[pluginName as keyof typeof HOST_CONFIG_SCHEMA.properties];
      if (rawSchema) return raw && pluginName !== 'plugin'
        ? { ...raw, $defs: HOST_CONFIG_SCHEMA.$defs } : raw ?? null;
      if (raw && pluginName === 'plugin') assertSchemaStructure(raw, 'config declaration for plugin');
      return jsonSchemaToConsoleSchema(raw);
    }
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/u.test(pluginName)
      && !pluginName.split('/').every((key) => /^[a-z0-9][a-z0-9-]*$/u.test(key))) {
      return null;
    }
    let target: ResolvedPackage | undefined;
    try {
      const packages = await resolver();
      const root = await packages.root(this.#projectRoot);
      const file = findConfigFile(this.#projectRoot);
      const document = currentDocument ?? (file ? (await createConfigDocument(join(this.#projectRoot, file)).read()).document : {});
      const declaration = readApplicationPluginDeclaration(document);
      if (declaration.version === 2) {
        const name = pluginName.startsWith('root/') ? pluginName.slice(5) : pluginName;
        const exact = declaration.instances.find(item => item.instanceKey === name);
        const matches = exact ? [exact] : declaration.instances.filter(item => item.package === pluginName);
        if (matches.length > 1) throw new Error('此包存在多个插件实例，请使用精确 instanceKey');
        if (matches[0]) target = await resolveReference(packages, root, matches[0]);
        else if (pluginName === 'root') target = root;
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('多个插件实例')) throw error;
      throw new Error(`Cannot resolve schema for ${pluginName}: invalid or unavailable Plugin manifest`, { cause: error });
    }
    if (!target) return null;
    const schema = declarations?.get(target.root) ?? await readOwnSchema(target.root, pluginName, !rawSchema);
    if (rawSchema) return schema;
    if (schema) assertSchemaStructure(schema, `config declaration for ${pluginName}`);
    return jsonSchemaToConsoleSchema(schema);
  }
}

async function resolveReference(
  resolver: NodePackageResolver,
  owner: ResolvedPackage,
  reference: ChildPluginReference,
): Promise<ResolvedPackage | undefined> {
  try {
    const pkg = await resolver.resolve(reference.package, owner);
    return pkg.packageJson.zhin.type === 'plugin' ? pkg : undefined;
  } catch (error) {
    if (error instanceof PackageResolutionError) return undefined;
    throw error;
  }
}

/** Missing schemas have no form; malformed schemas must not masquerade as missing. */
async function readOwnSchema(root: string, name: string, forForm = true): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await readFile(join(root, 'schema.json'), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw new Error(`Cannot read schema.json for ${name}`, { cause: error });
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Invalid JSON in schema.json for ${name}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`schema.json for ${name} must contain a JSON Schema object`);
  }
  const schema = value as Record<string, unknown>;
  if (schema.type !== undefined && schema.type !== 'object') {
    throw new Error(`schema.json for ${name} root schema type must be object`);
  }
  if (schema.properties !== undefined
    && (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties))) {
    throw new Error(`schema.json for ${name} properties must be an object`);
  }
  if (forForm) assertSchemaStructure(schema, `schema.json for ${name}`);
  return schema;
}

/** Reject malformed child definitions before the form converter can silently omit them. */
function assertSchemaStructure(value: unknown, location: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${location} must contain a supported schema object`);
  }
  const schema = value as Record<string, unknown>;
  // The form converter does not resolve references or compose JSON Schemas.
  // Reject these even beside supported properties, instead of displaying a partial form.
  for (const key of ['$ref', 'anyOf', 'oneOf', 'allOf', 'prefixItems', 'patternProperties']) {
    if (schema[key] !== undefined) {
      throw new Error(`${location}.${key} is not supported by Console forms`);
    }
  }
  if (schema.required !== undefined) {
    const nativeFlag = typeof schema.required === 'boolean' && isConsoleSchemaJson(schema);
    if (!nativeFlag && (!Array.isArray(schema.required)
      || !schema.required.every((key) => typeof key === 'string')
      || new Set(schema.required).size !== schema.required.length)) {
      throw new Error(`${location}.required must be a unique string array or a native Schema boolean`);
    }
  }
  for (const key of ['properties', '$defs', 'definitions', 'object']) {
    const children = schema[key];
    if (children === undefined) continue;
    if (!children || typeof children !== 'object' || Array.isArray(children)) {
      throw new Error(`${location}.${key} must be an object`);
    }
    for (const [name, child] of Object.entries(children)) {
      assertSchemaStructure(child, `${location}.${key}.${name}`);
    }
  }
  for (const key of ['items', 'inner', 'additionalProperties']) {
    const child = schema[key];
    if (child === undefined || (key === 'additionalProperties' && typeof child === 'boolean')) continue;
    if (key === 'items' && Array.isArray(child)) {
      throw new Error(`${location}.items tuple schemas are not supported by Console forms`);
    }
    assertSchemaStructure(child, `${location}.${key}`);
  }
  for (const key of ['list']) {
    const children = schema[key];
    if (children === undefined) continue;
    if (!Array.isArray(children)) throw new Error(`${location}.${key} must be an array`);
    children.forEach((child, index) => assertSchemaStructure(child, `${location}.${key}[${index}]`));
  }
}
