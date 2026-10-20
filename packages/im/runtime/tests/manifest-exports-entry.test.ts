import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { ManifestValidationError, NodePackageResolver, parsePackageJson, zhinExportTarget } from '../src/index.js';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const plugin = { protocol: 1, type: 'plugin' } as const;

describe('exports["./zhin"] as the runtime entry', () => {
  it('selects zhin, then import, then default, ignoring other conditions', () => {
    expect(zhinExportTarget({ './zhin': './plugin.js' })).toBe('./plugin.js');
    expect(zhinExportTarget({ './zhin': { types: './plugin.d.ts', require: './plugin.cjs', import: './plugin.js' } })).toBe('./plugin.js');
    expect(zhinExportTarget({ './zhin': { default: './d.js', import: './i.js', zhin: './z.js' } })).toBe('./z.js');
    expect(zhinExportTarget({ './zhin': { default: './d.js' } })).toBe('./d.js');
    expect(zhinExportTarget({ './zhin': { zhin: { import: './nested.js' } } })).toBe('./nested.js');
    expect(zhinExportTarget({ './zhin': [{ types: './x.d.ts' }, './fallback.js'] })).toBe('./fallback.js');
    expect(zhinExportTarget({ './zhin': { types: './plugin.d.ts', require: './plugin.cjs' } })).toBeUndefined();
    expect(zhinExportTarget({ '.': './lib/index.js' })).toBeUndefined();
    expect(zhinExportTarget('./lib/index.js')).toBeUndefined();
    expect(zhinExportTarget(undefined)).toBeUndefined();
  });

  it('fills zhin.entry from exports when zhin.entry is absent', () => {
    const parsed = parsePackageJson({
      name: 'zhin-plugin-x',
      exports: { '.': './lib/index.js', './zhin': { types: './plugin.d.ts', zhin: './plugin.js' } },
      zhin: plugin,
    }, 'package.json');
    expect(parsed.zhin.entry).toBe('./plugin.js');
  });

  it('keeps zhin.entry when both are declared', () => {
    const parsed = parsePackageJson({
      name: 'zhin-plugin-x',
      exports: { './zhin': './other.js' },
      zhin: { ...plugin, entry: './plugin.js' },
    }, 'package.json');
    expect(parsed.zhin.entry).toBe('./plugin.js');
  });

  it('validates the exported target like zhin.entry and names both fields when neither is set', () => {
    expect(() => parsePackageJson({ name: 'x', exports: { './zhin': './../escape.js' }, zhin: plugin }, 'package.json'))
      .toThrow('package.json#exports["./zhin"] must not escape the package root');
    expect(() => parsePackageJson({ name: 'x', exports: { './zhin': 'plugin.js' }, zhin: plugin }, 'package.json'))
      .toThrow('package.json#exports["./zhin"] must be a package-relative path starting with ./');
    let error: unknown;
    try {
      parsePackageJson({ name: 'x', zhin: plugin }, 'package.json');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ManifestValidationError);
    expect((error as ManifestValidationError).issues).toContain(
      'package.json#zhin.entry or package.json#exports["./zhin"] must declare a package-relative path starting with ./',
    );
  });

  it('resolves the runtime entry with the usual source/JavaScript preference', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-exports-entry-'));
    temporary.push(root);
    const dependency = join(root, 'node_modules', 'zhin-plugin-x');
    await mkdir(dependency, { recursive: true });
    await writeFile(join(dependency, 'package.json'), JSON.stringify({
      name: 'zhin-plugin-x',
      exports: { './zhin': { types: './plugin.d.ts', import: './plugin.js' } },
      zhin: plugin,
    }));
    await writeFile(join(dependency, 'plugin.js'), 'export default {};');
    await writeFile(join(dependency, 'plugin.ts'), 'export default {};');
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: '@test/root',
      dependencies: { 'zhin-plugin-x': '1.0.0' },
      zhin: { ...plugin, entry: './plugin.ts' },
    }));
    await writeFile(join(root, 'plugin.ts'), 'export default {};');

    const resolver = await NodePackageResolver.create(root);
    const rootPackage = await resolver.root(root);
    const resolved = await resolver.resolve('zhin-plugin-x', rootPackage);
    expect(resolved.source).toBe('node_modules');
    expect(resolved.packageJson.zhin.entry).toBe('./plugin.js');
  });
});
