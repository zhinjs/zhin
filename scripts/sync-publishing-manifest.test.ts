import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script
import { collectPublicPackages, renderManifest, syncManifest } from './sync-publishing-manifest.mjs';

const repoRoot = resolve(import.meta.dirname, '..');

describe('sync-publishing-manifest', () => {
  it('lists every non-private workspace package exactly once', () => {
    const packages = collectPublicPackages() as { name: string; dir: string; group: string }[];
    const names = packages.map((pkg) => pkg.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('@zhin.js/adapter-onebot-events');
    expect(names).toContain('@zhin.js/adapter-juejin');
    expect(names).toContain('@zhin.js/adapter-douyin-live');
  });

  it('keeps docs/contributing/publishing.md in sync with the workspace', () => {
    const doc = readFileSync(resolve(repoRoot, 'docs/contributing/publishing.md'), 'utf8');
    expect(syncManifest(doc, collectPublicPackages())).toBe(doc);
  });

  it('rewrites only the manifest section with group counts', () => {
    const packages = [
      { name: '@x/a', dir: 'basic/a', group: 'basic/' },
      { name: '@x/b', dir: 'packages/game-kit', group: 'packages/game-kit' },
    ];
    expect(renderManifest(packages)).toContain('### `basic/`（1）\n\n- [ ] `@x/a` — `basic/a`');
    const doc = '# T\n\n## 包清单\n\nstale\n\n## 之后\n\nkeep\n';
    const next = syncManifest(doc, packages);
    expect(next.startsWith('# T\n\n## 包清单\n\n以下 2 个')).toBe(true);
    expect(next).toContain('### `packages/game-kit`（1）');
    expect(next.endsWith('\n\n## 之后\n\nkeep\n')).toBe(true);
    expect(next).not.toContain('stale');
  });

  it('first-publish hint uses pnpm publish so workspace: ranges are rewritten', () => {
    const source = readFileSync(resolve(repoRoot, 'scripts/check-unpublished-packages.mjs'), 'utf8');
    expect(source).toContain('pnpm publish --access public --no-git-checks');
    expect(source).not.toMatch(/&& npm publish/);
  });
});
