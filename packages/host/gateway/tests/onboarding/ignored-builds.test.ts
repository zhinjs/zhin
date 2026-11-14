import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addedPackageNames, dependenciesInPlace, ignoredBuildsHint, parseIgnoredBuilds } from '../../src/onboarding/ignored-builds.js';

describe('pnpm ignored builds (#1250)', () => {
  it('parses the packages pnpm 11 names, without versions', () => {
    expect(parseIgnoredBuilds(' ERR_PNPM_IGNORED_BUILDS  Ignored build scripts: esbuild@0.25.4, @zhin.js/native@1.0.0, node-pty.\n'))
      .toEqual(['esbuild', '@zhin.js/native', 'node-pty']);
    expect(parseIgnoredBuilds('│ Ignored build scripts: sharp. │\nERR_PNPM_IGNORED_BUILDS')).toEqual(['sharp']);
    expect(parseIgnoredBuilds('ERR_PNPM_IGNORED_BUILDS')).toEqual([]);
  });

  it('ignores output without the error code (pnpm 10 warning, other failures)', () => {
    expect(parseIgnoredBuilds('Ignored build scripts: esbuild.')).toBeUndefined();
    expect(parseIgnoredBuilds(' ERR_PNPM_FETCH_404  Not Found')).toBeUndefined();
  });

  it('reads the packages an add names', () => {
    expect(addedPackageNames(['add', '-w', '@zhin.js/plugin-reminder@^1.0.0', 'pg', 'npm:zod@3'])).toEqual(['@zhin.js/plugin-reminder', 'pg', 'zod']);
    expect(addedPackageNames(['install', '--frozen-lockfile'])).toEqual([]);
  });

  it('requires a linked node_modules and every added package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-ignored-builds-'));
    try {
      expect(await dependenciesInPlace(root, ['install'])).toBe(false);
      await mkdir(join(root, 'node_modules', '@zhin.js', 'plugin-reminder'), { recursive: true });
      await writeFile(join(root, 'node_modules', '.modules.yaml'), '');
      expect(await dependenciesInPlace(root, ['install'])).toBe(true);
      expect(await dependenciesInPlace(root, ['add', '@zhin.js/plugin-reminder'])).toBe(false);
      await writeFile(join(root, 'node_modules', '@zhin.js', 'plugin-reminder', 'package.json'), '{}');
      expect(await dependenciesInPlace(root, ['add', '@zhin.js/plugin-reminder@1.0.0'])).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('points to allowBuilds and pnpm rebuild', () => {
    const hint = ignoredBuildsHint(['esbuild']);
    expect(hint).toContain('allowBuilds');
    expect(hint).toContain('esbuild: true');
    expect(hint).toContain('pnpm rebuild esbuild');
  });
});
