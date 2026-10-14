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

const SIDE_EFFECT_IMPORT = /(?:^|\n)\s*import\s+['"]@zhin\.js\/workroom['"]/gu;
const STATIC_FROM = /(?:^|\n)\s*(import|export)(\s+type)?\b[^;]*?from\s+['"]@zhin\.js\/workroom['"]/gu;
const WORKROOM_DIR_STATIC = /(?:^|\n)\s*(?:(import|export)(\s+type)?\b[^;]*?from\s+|import\s+)['"](?:\.\.?\/)+(?:plugin-runtime\/)?workroom\/[^'"]+\.js['"]/gu;
const WORKROOM_DIR_DYNAMIC = /(?<!typeof\s)(?<!\w)import\(\s*['"](?:\.\.?\/)+(?:plugin-runtime\/)?workroom\/[^'"]+\.js['"]\s*\)/gu;
const WORKROOM_DIR_DYNAMIC_ALLOWED = new Set(['plugin-runtime/agent/workroom-loader.ts']);

describe('boundary regex self-test', () => {
  it('matches violations and ignores allowed forms', () => {
    expect([...`import '@zhin.js/workroom';`.matchAll(SIDE_EFFECT_IMPORT)]).toHaveLength(1);
    expect([...`import type { A } from '@zhin.js/workroom';`.matchAll(SIDE_EFFECT_IMPORT)]).toHaveLength(0);
    expect([...`export * from '@zhin.js/workroom';`.matchAll(STATIC_FROM)]).toHaveLength(1);
    expect([...`import { a } from '../workroom/module.js';`.matchAll(WORKROOM_DIR_STATIC)]).toHaveLength(1);
    expect([...`import type { A } from '../workroom/module.js';`.matchAll(WORKROOM_DIR_STATIC)]
      .filter(m => !m[2])).toHaveLength(0);
    expect([...`import '../workroom/x.js';`.matchAll(WORKROOM_DIR_STATIC)]).toHaveLength(1);
    expect([...`await import('../workroom/module.js')`.matchAll(WORKROOM_DIR_DYNAMIC)]).toHaveLength(1);
    expect([...`type M = typeof import('../workroom/module.js');`.matchAll(WORKROOM_DIR_DYNAMIC)]).toHaveLength(0);
  });
});

describe('optional Workroom loading boundary', () => {
  it('only imports @zhin.js/workroom as a value from the workroom directory', async () => {
    const staticViolations: string[] = [];
    const dynamicViolations: string[] = [];
    for (const file of await sources(srcRoot)) {
      if (file.startsWith(workroomDir)) continue;
      const rel = relative(srcRoot, file).split(sep).join('/');
      const source = await readFile(file, 'utf8');
      for (const match of source.matchAll(STATIC_FROM)) {
        if (!match[2]) staticViolations.push(rel);
      }
      for (const _ of source.matchAll(SIDE_EFFECT_IMPORT)) staticViolations.push(`${rel} (side-effect import)`);
      for (const match of source.matchAll(/(?<!\w)import\(\s*['"]@zhin\.js\/workroom['"]\s*\)(?!\.[A-Z])/gu)) {
        void match;
        if (!DYNAMIC_IMPORT_ALLOWED.has(rel)) dynamicViolations.push(rel);
      }
    }
    expect(staticViolations).toEqual([]);
    expect(dynamicViolations).toEqual([]);
  });

  it('only type-imports or dynamically imports workroom/*.js outside the workroom directory', async () => {
    const staticViolations: string[] = [];
    const dynamicViolations: string[] = [];
    for (const file of await sources(srcRoot)) {
      if (file.startsWith(workroomDir)) continue;
      const rel = relative(srcRoot, file).split(sep).join('/');
      const source = await readFile(file, 'utf8');
      for (const match of source.matchAll(WORKROOM_DIR_STATIC)) {
        if (!match[2]) staticViolations.push(rel);
      }
      for (const _ of source.matchAll(WORKROOM_DIR_DYNAMIC)) {
        if (!WORKROOM_DIR_DYNAMIC_ALLOWED.has(rel)) dynamicViolations.push(rel);
      }
    }
    expect(staticViolations).toEqual([]);
    expect(dynamicViolations).toEqual([]);
  });
});
