import {readFile} from 'node:fs/promises';
import {isAbsolute, join, resolve} from 'node:path';
import {createConfigDocument} from '@zhin.js/config-file';
import {readApplicationPluginDeclaration} from '@zhin.js/runtime';
import {findConfigFile} from '../utils/config-file.js';

export interface DeclaredPluginReference {
  readonly packageName: string;
  readonly instanceKey: string;
}

export interface PluginLifecycleState {
  readonly schemaVersion: 1;
  readonly disabled: readonly string[];
}

const emptyState: PluginLifecycleState = Object.freeze({schemaVersion: 1, disabled: Object.freeze([])});

export interface PluginLifecycleStore {
  setPluginEnabled(
    file: string,
    instanceKey: string,
    enabled: boolean,
    declared: readonly DeclaredPluginReference[],
  ): Promise<PluginLifecycleState>;
  dispose(): void;
}

export function createPluginLifecycleStore(projectRoot: string): PluginLifecycleStore {
  let tail: Promise<unknown> = Promise.resolve();
  return Object.freeze({
    setPluginEnabled(_file: string, instanceKey: string, enabled: boolean, declared: readonly DeclaredPluginReference[]): Promise<PluginLifecycleState> {
      if (!declared.some(item => item.instanceKey === instanceKey)) return Promise.reject(new Error(`Unknown plugin instance: ${instanceKey}`));
      const run = tail.then(() => setProjectPluginEnabled(projectRoot, instanceKey, enabled));
      tail = run.catch(() => undefined);
      return run;
    },
    dispose(): void {},
  });
}

export function resolvePluginLifecycleFile(
  projectRoot: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const configured = environment.ZHIN_PLUGIN_LIFECYCLE_FILE?.trim();
  if (!configured) return resolve(projectRoot, '.zhin/plugin-lifecycle.json');
  if (!isAbsolute(configured)) throw new Error('ZHIN_PLUGIN_LIFECYCLE_FILE must be absolute');
  return resolve(configured);
}

export async function readDeclaredPlugins(projectRoot: string): Promise<readonly DeclaredPluginReference[]> {
  const configFile = findConfigFile(projectRoot);
  if (!configFile) throw new Error('Missing configVersion: 2 configuration; run zhin setup');
  const config = await createConfigDocument(join(projectRoot, configFile)).read();
  const declaration = readApplicationPluginDeclaration(config.document, join(projectRoot, configFile), config.pluginOrder);
  return Object.freeze(declaration.instances.map(item => Object.freeze({packageName: item.package, instanceKey: item.instanceKey})));
}

export async function readPluginLifecycleState(file: string): Promise<PluginLifecycleState> {
  let source: string;
  try {
    source = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(
      `Invalid plugin lifecycle JSON: ${error instanceof Error ? error.message : String(error)}`,
      {cause: error},
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid plugin lifecycle document');
  }
  const document = value as Record<string, unknown>;
  if (document.schemaVersion !== 1 || !Array.isArray(document.disabled)
    || document.disabled.some((item) => typeof item !== 'string' || !isInstanceKey(item))) {
    throw new Error('Invalid plugin lifecycle document');
  }
  return Object.freeze({
    schemaVersion: 1,
    disabled: Object.freeze([...new Set(document.disabled as string[])].sort()),
  });
}

/** Protocol-aware lifecycle reads; v2 never treats package declarations as configuration. */
export async function readProjectPluginLifecycleState(projectRoot: string, legacyFile: string): Promise<PluginLifecycleState> {
  const file = findConfigFile(projectRoot);
  if (!file) throw new Error('Missing configVersion: 2 configuration; run zhin setup');
  const {document} = await createConfigDocument(join(projectRoot, file)).read();
  const declaration = readApplicationPluginDeclaration(document);
  if ((await readPluginLifecycleState(legacyFile)).disabled.length) throw new Error('Legacy plugin lifecycle state detected; run zhin migrate instances');
  return Object.freeze({schemaVersion: 1, disabled: declaration.disabled});
}

export async function setProjectPluginEnabled(projectRoot: string, instanceKey: string, enabled: boolean): Promise<PluginLifecycleState> {
  const file = findConfigFile(projectRoot);
  if (!file) throw new Error('Missing configVersion: 2 configuration; run zhin setup');
  const document = createConfigDocument(join(projectRoot, file));
  const current = await document.read();
  const declaration = readApplicationPluginDeclaration(current.document);
  if (!declaration.instances.some(item => item.instanceKey === instanceKey)) throw new Error(`Unknown plugin instance: ${instanceKey}`);
  const disabled = enabled ? declaration.disabled.filter(key => key !== instanceKey) : [...new Set([...declaration.disabled, instanceKey])];
  await (await document.prepare(current, [{op: 'set', path: ['disable_plugins'], value: disabled}])).commit();
  return Object.freeze({schemaVersion: 1, disabled: Object.freeze(disabled)});
}

function isInstanceKey(value: string): boolean { return /^[a-z0-9][a-z0-9-]*$/u.test(value); }
