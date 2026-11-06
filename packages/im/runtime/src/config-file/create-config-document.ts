import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { ROOT_CONFIG_FILE_NAMES, selectRootConfigFile } from '@zhin.js/plugin-runtime';
import { JsonConfigDocument } from './json-config-document.js';
import { YamlConfigDocument } from './yaml-config-document.js';
import type { ConfigFileDocument } from './config-file-document.js';

export function findConfigFile(cwd: string): string | null {
  const existing = ROOT_CONFIG_FILE_NAMES
    .filter((name) => existsSync(join(cwd, name)));
  const selected = selectRootConfigFile(existing);
  return selected ?? null;
}

/** Selects the concrete document implementation once at the composition boundary. */
export function createConfigDocument(file: string): ConfigFileDocument {
  const extension = extname(file).toLowerCase();
  if (extension === '.yml' || extension === '.yaml') return new YamlConfigDocument(file);
  if (extension === '.json') return new JsonConfigDocument(file);
  throw new Error(`Unsupported config file extension: ${extension || '<none>'}`);
}
