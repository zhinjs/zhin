import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
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
  let entryFile: string | undefined;
  if (modules && manifest.type === 'plugin' && manifest.runtime !== 'isolated' && manifest.entry !== undefined) {
    entryFile = resolve(pkg.root, manifest.entry);
    const module = await modules.load<{ default?: PluginDefinition }>(entryFile);
    declaration = module.default?.config;
  }
  const inlineSchema = declaration ? declaration.toJsonSchema() : undefined;
  if (inlineSchema !== undefined && fileSchema !== undefined) {
    if (!schemasMatch(inlineSchema, fileSchema)) {
      throw new PluginConfigSourceConflictError(pkg.name, entryFile ?? manifest.entry ?? pkg.root, file);
    }
  }
  const schema: unknown = inlineSchema ?? fileSchema;
  if (schema === undefined) return null;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new TypeError(`${pkg.name} configuration must contain a JSON Schema object`);
  }
  return immutableConfigSchema(schema as Readonly<Record<string, unknown>>);
}

function schemasMatch(inlineSchema: unknown, fileSchema: unknown): boolean {
  if (!inlineSchema || typeof inlineSchema !== 'object' || Array.isArray(inlineSchema)) return false;
  if (!fileSchema || typeof fileSchema !== 'object' || Array.isArray(fileSchema)) return false;
  const stripDialect = (value: Record<string, unknown>): Record<string, unknown> => {
    const { $schema: _ignored, ...rest } = value;
    return rest;
  };
  return isDeepStrictEqual(
    stripDialect(inlineSchema as Record<string, unknown>),
    stripDialect(fileSchema as Record<string, unknown>),
  );
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

/**
 * Thrown when a trusted plugin declares both `definePlugin({ config })` and a root `schema.json`.
 * Neither source wins: startup stops so the two schemas cannot silently drift apart.
 */
export class PluginConfigSourceConflictError extends TypeError {
  constructor(
    readonly packageName: string,
    readonly entryFile: string,
    readonly schemaFile: string,
  ) {
    super(
      `${packageName} declares both plugin config and schema.json; choose one configuration schema. `
        + `Inline config: definePlugin({ config }) in ${entryFile}. JSON Schema: ${schemaFile}. `
        + 'Zhin does not pick one for you. To keep the typed inline Schema, delete schema.json; '
        + 'to keep schema.json (required for isolated plugins, readable without running the plugin), '
        + 'remove config from definePlugin. '
        + 'See https://zhin.js.org/authoring/define-plugin#choose-a-config-source',
    );
    this.name = 'PluginConfigSourceConflictError';
  }
}
