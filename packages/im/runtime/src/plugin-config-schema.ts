import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PluginDefinition } from '@zhin.js/plugin-runtime';
import type { ModuleRuntime } from './module-runtime.js';
import type { ResolvedPackage } from './package-resolver.js';

/** One source of truth per package: executable declaration or JSON Schema. */
export async function readPluginConfigSchema(
  pkg: ResolvedPackage,
  modules?: Pick<ModuleRuntime, 'load'>,
): Promise<Readonly<Record<string, unknown>> | null> {
  const file = resolve(pkg.root, 'schema.json');
  let fileSchema: unknown;
  try {
    fileSchema = JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  // Isolated plugin code never executes in the composition process.
  const manifest = pkg.packageJson.zhin;
  let declaration: PluginDefinition['config'];
  if (modules && manifest.type === 'plugin' && manifest.runtime !== 'isolated') {
    const module = await modules.load<{ default?: PluginDefinition }>(resolve(pkg.root, manifest.entry));
    declaration = module.default?.config;
  }
  if (declaration && fileSchema !== undefined) {
    throw new TypeError(`${pkg.name} declares both plugin config and schema.json; choose one configuration schema`);
  }
  const schema: unknown = declaration ? declaration.toJsonSchema() : fileSchema;
  if (schema === undefined) return null;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new TypeError(`${pkg.name} configuration must contain a JSON Schema object`);
  }
  return immutableConfigSchema(schema as Readonly<Record<string, unknown>>);
}

/** Detached declaration metadata for preflight and custom-resolver startup views. */
export function immutableConfigSchema(schema: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const copy = structuredClone(schema);
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  freeze(copy);
  return copy;
}
