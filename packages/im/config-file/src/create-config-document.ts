import { extname } from 'node:path';
import type { ConfigDocumentPort } from '@zhin.js/plugin-runtime';
import { JsonConfigDocument } from './json-config-document.js';
import { YamlConfigDocument } from './yaml-config-document.js';

/** Selects the concrete document implementation once at the composition boundary. */
export function createConfigDocument(file: string): ConfigDocumentPort {
  const extension = extname(file).toLowerCase();
  if (extension === '.yml' || extension === '.yaml') return new YamlConfigDocument(file);
  if (extension === '.json') return new JsonConfigDocument(file);
  throw new Error(`Unsupported config file extension: ${extension || '<none>'}`);
}
