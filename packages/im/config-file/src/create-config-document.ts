import { extname } from 'node:path';
import { JsonConfigDocument } from './json-config-document.js';
import { YamlConfigDocument } from './yaml-config-document.js';
import type { ConfigFileDocument } from './config-file-document.js';

/** Selects the concrete document implementation once at the composition boundary. */
export function createConfigDocument(file: string): ConfigFileDocument {
  const extension = extname(file).toLowerCase();
  if (extension === '.yml' || extension === '.yaml') return new YamlConfigDocument(file);
  if (extension === '.json') return new JsonConfigDocument(file);
  throw new Error(`Unsupported config file extension: ${extension || '<none>'}`);
}
