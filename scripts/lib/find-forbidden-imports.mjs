import * as path from 'node:path';
import { parseImports } from './parse-imports.mjs';

/**
 * 找出 file 中解析后落入 forbiddenRoots 任一目录的相对 import
 *（含 type-only import 与 re-export）。
 * @param {{ file: string, content: string, forbiddenRoots: string[] }} options
 * @returns {{ file: string, import: string, root: string }[]}
 */
export function findForbiddenRelativeImports({ file, content, forbiddenRoots }) {
  const found = [];
  for (const spec of parseImports(content, { includeTypeOnly: true })) {
    if (!spec.startsWith('.')) continue;
    const target = path.resolve(path.dirname(file), spec);
    const root = forbiddenRoots.find(r => target === r || target.startsWith(`${r}${path.sep}`));
    if (root) found.push({ file, import: spec, root });
  }
  return found;
}
