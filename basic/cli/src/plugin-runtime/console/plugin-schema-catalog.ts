import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HOST_CONFIG_KEYS } from '@zhin.js/runtime';
import { jsonSchemaToConsoleSchema } from './console-schema.js';
import { readPluginPackageMap } from './plugin-package-map.js';

const HOST_CONFIG_KEY_SET = new Set<string>(HOST_CONFIG_KEYS);

/** Resolves and converts schemas for one project without leaking filesystem rules to callers. */
export class PluginSchemaCatalog {
  readonly #projectRoot: string;

  constructor(projectRoot: string) {
    this.#projectRoot = projectRoot;
  }

  async read(pluginName?: string): Promise<unknown> {
    if (!pluginName) return null;
    const packageMap = await readPluginPackageMap(this.#projectRoot);
    return this.#read(pluginName, packageMap);
  }

  async readAll(keys: Iterable<string>): Promise<Record<string, unknown>> {
    const packageMap = await readPluginPackageMap(this.#projectRoot);
    const entries = await Promise.all([...keys].map(async (key) => [
      key,
      await this.#read(key, packageMap),
    ] as const));
    return Object.fromEntries(entries.filter((entry): entry is readonly [string, unknown] =>
      entry[1] != null));
  }

  async #read(
    pluginName: string,
    packageMap: ReadonlyMap<string, string>,
  ): Promise<unknown> {
    if (HOST_CONFIG_KEY_SET.has(pluginName)) {
      return jsonSchemaToConsoleSchema({ type: 'object', additionalProperties: true });
    }
    const raw = await this.#loadRawSchema(pluginName, packageMap);
    return raw == null ? null : jsonSchemaToConsoleSchema(raw);
  }

  async #loadRawSchema(
    pluginName: string,
    packageMap: ReadonlyMap<string, string>,
  ): Promise<unknown> {
    const packageName = packageMap.get(pluginName);
    const candidates = [pluginName, ...(packageName && packageName !== pluginName ? [packageName] : [])];
    for (const candidate of candidates) {
      try {
        const text = await readFile(
          join(this.#projectRoot, 'node_modules', candidate, 'schema.json'),
          'utf8',
        );
        return JSON.parse(text) as unknown;
      } catch {
        // Continue to the package-name candidate when an instance-key path is absent.
      }
    }
    return null;
  }
}
