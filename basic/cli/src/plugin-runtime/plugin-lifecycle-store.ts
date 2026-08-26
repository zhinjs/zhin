import {mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, join, resolve} from 'node:path';

export interface DeclaredPluginReference {
  readonly packageName: string;
  readonly instanceKey: string;
}

export interface PluginLifecycleState {
  readonly schemaVersion: 1;
  readonly disabled: readonly string[];
}

const emptyState: PluginLifecycleState = Object.freeze({schemaVersion: 1, disabled: Object.freeze([])});
const writeTails = new Map<string, Promise<unknown>>();

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
  const document = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')) as {
    readonly zhin?: {readonly plugins?: unknown};
  };
  if (!Array.isArray(document.zhin?.plugins)) return Object.freeze([]);
  const output: DeclaredPluginReference[] = [];
  const seen = new Set<string>();
  for (const item of document.zhin.plugins) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const packageName = typeof record.package === 'string' ? record.package : '';
    const instanceKey = typeof record.instanceKey === 'string' ? record.instanceKey : '';
    if (!packageName || !isInstanceKey(instanceKey) || seen.has(instanceKey)) continue;
    seen.add(instanceKey);
    output.push(Object.freeze({packageName, instanceKey}));
  }
  return Object.freeze(output);
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

export function setPluginEnabled(
  file: string,
  instanceKey: string,
  enabled: boolean,
  declared: readonly DeclaredPluginReference[],
): Promise<PluginLifecycleState> {
  if (!isInstanceKey(instanceKey) || !declared.some((item) => item.instanceKey === instanceKey)) {
    return Promise.reject(new Error(`Unknown plugin instance: ${instanceKey || '<empty>'}`));
  }
  const target = resolve(file);
  const previous = writeTails.get(target) ?? Promise.resolve();
  const run = previous.then(
    () => applyPluginEnabled(target, instanceKey, enabled),
    () => applyPluginEnabled(target, instanceKey, enabled),
  );
  writeTails.set(target, run.catch(() => undefined));
  return run;
}

async function applyPluginEnabled(
  file: string,
  instanceKey: string,
  enabled: boolean,
): Promise<PluginLifecycleState> {
  const current = await readPluginLifecycleState(file);
  const disabled = new Set(current.disabled);
  if (enabled) disabled.delete(instanceKey);
  else disabled.add(instanceKey);
  const state: PluginLifecycleState = Object.freeze({
    schemaVersion: 1,
    disabled: Object.freeze([...disabled].sort()),
  });
  await mkdir(dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return state;
}

function isInstanceKey(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/u.test(value);
}
