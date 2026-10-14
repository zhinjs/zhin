import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = fileURLToPath(new URL('../../../src/', import.meta.url));
const workroomDir = join(srcRoot, 'plugin-runtime', 'workroom') + sep;
const DYNAMIC_IMPORT_ALLOWED = new Set([
  'utils/optional-workroom.ts',
  'plugin-runtime/console/agent-console.ts',
  'plugin-runtime/console/workroom-catalog-rpc.ts',
  'plugin-runtime/console/workroom-run-control-route.ts',
]);

async function sources(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await sources(path));
    else if (/\.tsx?$/u.test(entry.name)) out.push(path);
  }
  return out;
}

describe('optional Workroom loading boundary', () => {
  it('only imports @zhin.js/workroom as a value from the workroom directory', async () => {
    const staticViolations: string[] = [];
    const dynamicViolations: string[] = [];
    for (const file of await sources(srcRoot)) {
      if (file.startsWith(workroomDir)) continue;
      const rel = relative(srcRoot, file).split(sep).join('/');
      const source = await readFile(file, 'utf8');
      for (const match of source.matchAll(/(?:^|\n)\s*(import|export)(\s+type)?\b[^;]*?from\s+['"]@zhin\.js\/workroom['"]/gu)) {
        if (!match[2]) staticViolations.push(rel);
      }
      for (const match of source.matchAll(/(?<!\w)import\(\s*['"]@zhin\.js\/workroom['"]\s*\)(?!\.[A-Z])/gu)) {
        void match;
        if (!DYNAMIC_IMPORT_ALLOWED.has(rel)) dynamicViolations.push(rel);
      }
    }
    expect(staticViolations).toEqual([]);
    expect(dynamicViolations).toEqual([]);
  });
});
