import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  HOST_CONFIG_KEYS,
  HOST_CONFIG_SCHEMA,
  NodePackageResolver,
  PackageResolutionError,
  mergeChildPluginReferences,
  type ChildPluginReference,
  type ResolvedPackage,
} from '@zhin.js/runtime';
import { jsonSchemaToConsoleSchema } from './console-schema.js';

const HOST_CONFIG_KEY_SET = new Set<string>(HOST_CONFIG_KEYS);

/** Resolves schemas using the same package roots and declarations as Runtime. */
export class PluginSchemaCatalog {
  readonly #projectRoot: string;

  constructor(projectRoot: string) {
    this.#projectRoot = projectRoot;
  }

  async read(pluginName?: string): Promise<unknown> {
    if (!pluginName) return null;
    return this.#read(pluginName, () => NodePackageResolver.create(this.#projectRoot));
  }

  async readAll(keys: Iterable<string>): Promise<Record<string, unknown>> {
    let resolver: Promise<NodePackageResolver> | undefined;
    const entries = await Promise.all([...keys].map(async (key) => [
      key,
      await this.#read(key, () => resolver ??= NodePackageResolver.create(this.#projectRoot)),
    ] as const));
    return Object.fromEntries(entries.filter((entry): entry is readonly [string, unknown] =>
      entry[1] != null));
  }

  async #read(
    pluginName: string,
    resolver: () => Promise<NodePackageResolver>,
  ): Promise<unknown> {
    if (HOST_CONFIG_KEY_SET.has(pluginName)) {
      const raw = pluginName === 'plugin'
        ? await readOwnSchema(this.#projectRoot, 'plugin')
        : HOST_CONFIG_SCHEMA.properties[pluginName as keyof typeof HOST_CONFIG_SCHEMA.properties];
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
      target = await resolvePlugin(packages, root, pluginName);
    } catch (error) {
      throw new Error(`Cannot resolve schema for ${pluginName}: invalid or unavailable Plugin manifest`, { cause: error });
    }
    return target ? jsonSchemaToConsoleSchema(await readOwnSchema(target.root, pluginName)) : null;
  }
}

/** References resolve relative to their declaring package, never the instance name. */
async function resolvePlugin(
  resolver: NodePackageResolver,
  root: ResolvedPackage,
  name: string,
): Promise<ResolvedPackage | undefined> {
  // Match declared package aliases before splitting paths: scoped names contain '/'.
  const references = await childReferences(resolver, root, true);
  const direct = references.find(({ reference }) => reference.instanceKey === name)
    ?? references.find(({ reference }) => reference.package === name);
  if (direct) return resolveReference(resolver, direct.owner, direct.reference);
  // A legal child instance named root takes precedence over the root alias.
  if (name === 'root') return root;
  const keys = name.startsWith('root/') ? name.slice(5).split('/') : name.split('/');
  if (!keys.every((key) => /^[a-z0-9][a-z0-9-]*$/u.test(key))) return undefined;
  let current = root;
  for (const [index, key] of keys.entries()) {
    const reference = (await childReferences(resolver, current, index === 0)).find(
      (item) => item.reference.instanceKey === key,
    );
    if (!reference) return undefined;
    const resolved = await resolveReference(resolver, reference.owner, reference.reference);
    if (!resolved) return undefined;
    current = resolved;
  }
  return current;
}

async function childReferences(
  resolver: NodePackageResolver,
  pkg: ResolvedPackage,
  root = false,
): Promise<readonly { readonly reference: ChildPluginReference; readonly owner: ResolvedPackage }[]> {
  if (pkg.packageJson.zhin.type !== 'plugin') return [];
  const declared = pkg.packageJson.zhin.plugins;
  let inherited: readonly ChildPluginReference[] = [];
  let hasCarrier = false;
  if (root && pkg.packageJson.zhin.platformFeatures !== false
    && (pkg.packageJson.dependencies?.['@zhin.js/core']
    || pkg.packageJson.optionalDependencies?.['@zhin.js/core'])) {
    try {
      await resolver.resolve('@zhin.js/core', pkg);
      hasCarrier = true;
    } catch (error) {
      if (!(error instanceof PackageResolutionError)) throw error;
    }
  }
  let facade: ResolvedPackage | undefined;
  if (root && pkg.packageJson.zhin.platformFeatures !== false
    && (pkg.packageJson.dependencies?.['zhin.js'] || pkg.packageJson.optionalDependencies?.['zhin.js'])) {
    try {
      facade = await resolver.resolve('zhin.js', pkg);
      if (!hasCarrier) await resolver.resolve('@zhin.js/core', facade);
      if (facade.packageJson.zhin.type === 'plugin') inherited = facade.packageJson.zhin.plugins;
    } catch (error) {
      if (!(error instanceof PackageResolutionError)) throw error;
    }
  }
  const ownKeys = new Set(declared.map((item) => item.instanceKey));
  if (ownKeys.size !== declared.length) {
    throw new Error(`Duplicate child instanceKey in ${pkg.name}`);
  }
  return mergeChildPluginReferences(declared, inherited).map((reference) => ({
    reference,
    owner: ownKeys.has(reference.instanceKey) ? pkg : facade!,
  }));
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
async function readOwnSchema(root: string, name: string): Promise<Record<string, unknown> | null> {
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
  if (schema.properties === undefined
    && (schema.anyOf !== undefined || schema.oneOf !== undefined
      || schema.allOf !== undefined || schema.$ref !== undefined)) {
    throw new Error(`schema.json for ${name} root schema must declare properties`);
  }
  assertSchemaStructure(schema, `schema.json for ${name}`);
  return schema;
}

/** Reject malformed child definitions before the form converter can silently omit them. */
function assertSchemaStructure(value: unknown, location: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${location} must contain a supported schema object`);
  }
  const schema = value as Record<string, unknown>;
  for (const key of ['properties', 'patternProperties', '$defs', 'definitions', 'object']) {
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
      child.forEach((item, index) => assertSchemaStructure(item, `${location}.${key}[${index}]`));
    } else {
      assertSchemaStructure(child, `${location}.${key}`);
    }
  }
  for (const key of ['anyOf', 'oneOf', 'allOf', 'prefixItems', 'list']) {
    const children = schema[key];
    if (children === undefined) continue;
    if (!Array.isArray(children)) throw new Error(`${location}.${key} must be an array`);
    children.forEach((child, index) => assertSchemaStructure(child, `${location}.${key}[${index}]`));
  }
}
