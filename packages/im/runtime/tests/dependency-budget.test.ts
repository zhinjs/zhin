import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('@zhin.js/runtime dependency budget', () => {
  it('keeps frontend build tooling out of the package contract', async () => {
    const file = fileURLToPath(new URL('../package.json', import.meta.url));
    const manifest = JSON.parse(await readFile(file, 'utf8')) as {
      readonly exports?: unknown;
      readonly dependencies?: Readonly<Record<string, string>>;
      readonly devDependencies?: Readonly<Record<string, string>>;
      readonly optionalDependencies?: Readonly<Record<string, string>>;
      readonly peerDependencies?: Readonly<Record<string, string>>;
    };
    const dependencyNames = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    });

    expect(
      dependencyNames.filter((name) => /^(?:vite(?:-|$)|@vitejs\/|lightningcss(?:-|$))/u.test(name)),
    ).toEqual([]);
    expect(JSON.stringify(manifest.exports)).not.toMatch(/(?:vite|lightningcss)/iu);
  });
});
