import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const packagesIm = join(here, '..', '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' || name === 'lib' ? [] : sourceFiles(full);
    return name.endsWith('.ts') ? [full] : [];
  });
}

/** Text of each `createTurnIngress({ ... })` argument, found by brace matching. */
function turnIngressArguments(source: string): string[] {
  const found: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf('createTurnIngress({', from);
    if (start < 0) return found;
    let depth = 0;
    let end = start + 'createTurnIngress('.length;
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1;
      if (source[end] === '}' && (depth -= 1) === 0) break;
    }
    found.push(source.slice(start, end + 1));
    from = end;
  }
}

describe('host-protected paths reach every production Turn (#1030 P0)', () => {
  const production = [
    ...sourceFiles(join(packagesIm, 'agent', 'src')),
    ...sourceFiles(join(packagesIm, 'workroom', 'src')),
  ].filter((file) => !file.endsWith('turn-ingress.ts'));

  it('passes hostProtectedPaths at every createTurnIngress call site (or the call carries it via a spread)', () => {
    const sites = production.flatMap((file) =>
      turnIngressArguments(readFileSync(file, 'utf8')).map((body) => ({ file: file.slice(packagesIm.length), body })));
    expect(sites.length).toBeGreaterThanOrEqual(3);
    const missing = sites.filter(({ body }) => !body.includes('hostProtectedPaths')).map(({ file }) => file);
    expect(missing).toEqual([]);
  });

  it('keeps the registry out: no module-level install/current API', () => {
    const offenders = production.filter((file) => /installHostProtectedPaths|currentHostProtectedPaths/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
