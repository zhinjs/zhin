import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  exportTargets,
  hasSourceConditions,
  publishablePackageFiles,
  stripSourceConditions,
  withPublishExports,
} from './sync-publish-exports.mjs';

const repo = path.resolve(import.meta.dirname, '..');

function coveredByFiles(target: string, files: readonly string[]): boolean {
  const rel = target.replace(/^\.\//u, '');
  if (rel === 'package.json') return true;
  return files.some((entry) => {
    const prefix = entry.replace(/^\.\//u, '').replace(/\/$/u, '');
    return rel === prefix || rel.startsWith(`${prefix}/`);
  });
}

describe('stripSourceConditions', () => {
  it('drops nested development conditions and keeps everything else in order', () => {
    const exports = {
      '.': { types: './lib/index.d.ts', development: './src/index.ts', import: './lib/index.js' },
      './feature': {
        node: { development: './src/node.ts', default: './lib/node.js' },
        default: './lib/feature.js',
      },
      './package.json': './package.json',
    };
    expect(stripSourceConditions(exports)).toEqual({
      '.': { types: './lib/index.d.ts', import: './lib/index.js' },
      './feature': { node: { default: './lib/node.js' }, default: './lib/feature.js' },
      './package.json': './package.json',
    });
    expect(Object.keys((stripSourceConditions(exports) as Record<string, object>)['.'])).toEqual(['types', 'import']);
  });
});

describe('withPublishExports', () => {
  it('adds publishConfig.exports for packages with a development condition', () => {
    const manifest = {
      name: 'x',
      exports: { '.': { development: './src/index.ts', import: './lib/index.js' } },
      publishConfig: { access: 'public' },
    };
    expect(withPublishExports(manifest).publishConfig).toEqual({
      access: 'public',
      exports: { '.': { import: './lib/index.js' } },
    });
  });

  it('removes stale publishConfig.exports once the development condition is gone', () => {
    const manifest = {
      name: 'x',
      exports: { '.': './lib/index.js' },
      publishConfig: { access: 'public', exports: { '.': './lib/old.js' } },
    };
    expect(withPublishExports(manifest).publishConfig).toEqual({ access: 'public' });
  });

  it('leaves private packages alone', () => {
    const manifest = { name: 'x', private: true, exports: { '.': { development: './src/a.ts' } } };
    expect(withPublishExports(manifest)).toBe(manifest);
  });
});

describe('workspace publish manifests', () => {
  const manifests = publishablePackageFiles().map((file: string) => ({
    file: path.relative(repo, file),
    manifest: JSON.parse(readFileSync(file, 'utf8')),
  }));

  it('keeps publishConfig.exports in sync (run node scripts/sync-publish-exports.mjs)', () => {
    const drift = manifests
      .filter(({ manifest }) => withPublishExports(manifest) !== manifest)
      .map(({ file }) => file);
    expect(drift).toEqual([]);
  });

  it('never publishes a development condition or an export target outside files', () => {
    const problems: string[] = [];
    for (const { file, manifest } of manifests) {
      const published = manifest.publishConfig?.exports ?? manifest.exports;
      if (!published) continue;
      if (hasSourceConditions(published)) problems.push(`${file}: development condition`);
      if (!Array.isArray(manifest.files)) continue;
      for (const target of exportTargets(published)) {
        if (!coveredByFiles(target, manifest.files)) problems.push(`${file}: ${target} not in files`);
      }
    }
    expect(problems).toEqual([]);
  });
});
