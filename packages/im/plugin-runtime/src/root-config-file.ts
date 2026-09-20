export const ROOT_CONFIG_FILE_NAMES = Object.freeze([
  'config.yml',
  'config.yaml',
  'config.json',
  'zhin.config.yml',
  'zhin.config.yaml',
  'zhin.config.json',
] as const);

export type RootConfigFileName = typeof ROOT_CONFIG_FILE_NAMES[number];
export type RootConfigFormat = 'yaml' | 'json';

/** File materialized when a project has no Root configuration yet. */
export const DEFAULT_ROOT_CONFIG_FILE_NAME: RootConfigFileName = 'zhin.config.yml';

/** Returns the only configuration formats accepted by Root Runtime. */
export function rootConfigFormat(filePath: string): RootConfigFormat | undefined {
  const fileName = filePath.split(/[\\/]/u).pop();
  if (!fileName || !ROOT_CONFIG_FILE_NAMES.includes(fileName as RootConfigFileName)) return undefined;
  const extension = /\.[^.]+$/u.exec(fileName)?.[0];
  if (extension === '.yml' || extension === '.yaml') return 'yaml';
  if (extension === '.json') return 'json';
  return undefined;
}

/** Enforces a single Root configuration authority for one project. */
export function selectRootConfigFile(
  existingFiles: readonly string[],
): string | undefined {
  if (existingFiles.length > 1) {
    throw new Error(`Multiple Root config files found: ${existingFiles.join(', ')}`);
  }
  return existingFiles[0];
}
