// Guards the temporary A4a compat layer. Deleted together with the stubs in A4b.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const agentSrc = path.resolve(here, '../src');
const workroomSrc = path.resolve(here, '../../workroom/src');
const dirs = ['workroom', 'portfolio', 'data-governance'];
const MARKER = '// Temporary A4a compat layer, removed in A4b.';

function listTs(dir: string): string[] {
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .map(f => f.split(path.sep).join('/'))
    .filter(f => f.endsWith('.ts'))
    .sort();
}

const stubs = dirs.flatMap(dir => listTs(path.join(agentSrc, dir)).map(rel => ({ dir, rel })));

describe('agent workroom compat layer', () => {
  it('has stubs', () => {
    expect(stubs.length).toBeGreaterThan(0);
  });

  it.each(stubs.map(s => [`${s.dir}/${s.rel}`, s] as const))('%s mirrors the workroom package module', (_n, { dir, rel }) => {
    const lines = fs.readFileSync(path.join(agentSrc, dir, rel), 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
    const body = lines[0] === MARKER ? lines.slice(1) : lines;
    const target = `${dir}/${rel.replace(/\.ts$/, '.js')}`;
    expect(body).toEqual([`export * from '@zhin.js/workroom/${target}';`]);
    expect(fs.existsSync(path.join(workroomSrc, dir, rel))).toBe(true);
  });

  it('workroom/file-effect-ledger exposes the same export keys as the package', async () => {
    const viaAgent = await import('../src/workroom/file-effect-ledger.js');
    const viaPackage = await import('@zhin.js/workroom/workroom/file-effect-ledger.js');
    expect(Object.keys(viaAgent).sort()).toEqual(Object.keys(viaPackage).sort());
    expect(Object.keys(viaAgent).length).toBeGreaterThan(0);
  });
});
