import fs from 'fs-extra';
import path from 'path';
import { ConfigDocumentConflictError, createConfigDocument } from '@zhin.js/config-file';
import { isDeepStrictEqual } from 'node:util';
import { readApplicationPluginDeclaration } from '@zhin.js/runtime';
import {
  ROOT_CONFIG_FILE_NAMES,
  selectRootConfigFile,
  type ConfigDocumentSnapshot,
  type PreparedConfigDocument,
} from '@zhin.js/plugin-runtime';

const loadedConfigSource = Symbol('zhin.cli.loaded-config-source');
type EditableConfig = Record<string, unknown> & {
  readonly [loadedConfigSource]?: { readonly file: string; readonly snapshot: ConfigDocumentSnapshot };
};

function rememberSource(config: Record<string, unknown>, file: string, snapshot: ConfigDocumentSnapshot): void {
  Object.defineProperty(config, loadedConfigSource, {
    value: { file: path.resolve(file), snapshot }, configurable: true, enumerable: false,
  });
}

export function findConfigFile(cwd: string): string | null {
  const existing = ROOT_CONFIG_FILE_NAMES
    .filter((name) => fs.existsSync(path.join(cwd, name)));
  const selected = selectRootConfigFile(existing);
  return selected ?? null;
}

export async function readConfig(filePath: string): Promise<Record<string, unknown>> {
  const snapshot = await createConfigDocument(filePath).read();
  readApplicationPluginDeclaration(snapshot.document);
  const config = structuredClone(snapshot.document) as Record<string, unknown>;
  rememberSource(config, filePath, snapshot);
  return config;
}

/** Validates an editable candidate and prepares a write against its original source. */
export async function prepareConfigSave(
  filePath: string,
  config: Record<string, unknown>,
  baseConfig: Record<string, unknown> = config,
): Promise<PreparedConfigDocument | undefined> {
  readApplicationPluginDeclaration(config);
  const document = createConfigDocument(filePath);
  const source = (baseConfig as EditableConfig)[loadedConfigSource];
  if (source && source.file !== path.resolve(filePath)) throw new Error('Loaded configuration belongs to a different file');
  const current = source?.snapshot ?? await document.read();
  // Validate even a no-op before a caller writes related dependencies or env.
  if (source && (await document.read()).revision !== current.revision) throw new ConfigDocumentConflictError(filePath);
  const patches: import('@zhin.js/plugin-runtime').ConfigPatch[] = [];
  for (const key of new Set([...Object.keys(current.document), ...Object.keys(config)])) {
    if (isDeepStrictEqual(current.document[key], config[key])) continue;
    if (key === 'plugins' && current.document.plugins && config.plugins) {
      const previous = current.document.plugins as Record<string, unknown>;
      const next = config.plugins as Record<string, unknown>;
      for (const alias of new Set([...Object.keys(previous), ...Object.keys(next)])) {
        if (isDeepStrictEqual(previous[alias], next[alias])) continue;
        patches.push(Object.hasOwn(next, alias) ? {op: 'set', path: ['plugins', alias], value: next[alias]} : {op: 'remove', path: ['plugins', alias]});
      }
    } else patches.push(Object.hasOwn(config, key) ? {op: 'set', path: [key], value: config[key]} : {op: 'remove', path: [key]});
  }
  return patches.length ? document.prepare(current, patches) : undefined;
}

export async function saveConfig(
  filePath: string,
  config: Record<string, unknown>,
  baseConfig: Record<string, unknown> = config,
): Promise<void> {
  const prepared = await prepareConfigSave(filePath, config, baseConfig);
  if (prepared) rememberSource(config, filePath, await prepared.commit());
}
