import { join } from 'node:path';
import { createConfigDocument } from '@zhin.js/config-file';
import { readApplicationPluginDeclaration } from '@zhin.js/runtime';
import { findConfigFile } from '../../utils/config-file.js';

/** Reads only the application's instance declaration authority. */
export async function readPluginPackageMap(projectRoot: string, currentDocument?: Readonly<Record<string, unknown>>): Promise<ReadonlyMap<string, string>> {
  let document = currentDocument;
  if (!document) {
    const file = findConfigFile(projectRoot);
    if (!file) throw new Error('Missing configVersion: 2 configuration; run zhin setup');
    document = (await createConfigDocument(join(projectRoot, file)).read()).document;
  }
  return new Map(readApplicationPluginDeclaration(document).instances.map(item => [item.instanceKey, item.package]));
}
