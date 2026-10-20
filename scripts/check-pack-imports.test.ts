import { describe, expect, it } from 'vitest';
import {
  entryTargets,
  findBrokenPackImports,
  findPackLayoutProblems,
  publishedManifest,
  relativeSpecifiers,
} from './check-pack-imports.mjs';

function check(files: Record<string, string>, manifest: Record<string, unknown> = { type: 'module' }) {
  return findBrokenPackImports({
    files: Object.keys(files),
    manifest,
    readFile: async (file: string) => files[file] ?? '',
  });
}

describe('check-pack-imports', () => {
  it('collects relative static, re-export, dynamic and require specifiers only', () => {
    const source = [
      "import { a } from './a.js';",
      "import 'zhin.js/command';",
      "export * from '../b.js';",
      "export { c } from './c.js';",
      "const d = await import('./d.js');",
      "const e = require('./e.cjs');",
      "import { a as again } from './a.js';",
    ].join('\n');
    expect(relativeSpecifiers(source)).toEqual(['./a.js', '../b.js', './c.js', './d.js', './e.cjs']);
  });

  it('reports the group-suite 1.1.8 regression: runtime entry imports an unbuilt lib module', async () => {
    const result = await check({
      'package.json': '{}',
      'lib/keyword-store.js': 'export const keywordStore = 1;',
      'commands/keyword-add/[keyword]/index.js': "import { keywordsForCommand } from '../../../lib/keywords.js';",
      'middlewares/keyword-reply/index.js': "import { matchKeyword } from '../../lib/keyword-store.js';\nimport { keywords } from '../../lib/keywords.js';",
    });
    expect(result.errors).toEqual([
      "commands/keyword-add/[keyword]/index.js: '../../../lib/keywords.js' -> lib/keywords.js is not in the tarball",
      "middlewares/keyword-reply/index.js: '../../lib/keywords.js' -> lib/keywords.js is not in the tarball",
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('passes when every import resolves inside the tarball', async () => {
    const result = await check({
      'lib/index.js': "export * from './keywords.js';\nexport const load = () => import('./lazy.js');",
      'lib/keywords.js': 'export const keywords = 1;',
      'lib/lazy.js': 'export default 1;',
    }, { type: 'module', main: './lib/index.js', exports: { '.': { import: './lib/index.js' } } });
    expect(result).toEqual({ errors: [], warnings: [] });
  });

  it('rejects imports that escape the package root', async () => {
    const result = await check({ 'lib/index.js': "import '../../outside/x.js';" });
    expect(result.errors).toEqual(["lib/index.js: '../../outside/x.js' escapes the package root"]);
  });

  it('applies CommonJS resolution only to CommonJS files', async () => {
    const commonJs = await check({
      'lib/index.cjs': "const helper = require('./helper');\nconst dir = require('./dir');",
      'lib/helper.js': 'module.exports = 1;',
      'lib/dir/index.js': 'module.exports = 2;',
    });
    expect(commonJs.errors).toEqual([]);

    const esm = await check({
      'lib/index.js': "import './missing';",
    });
    expect(esm.errors).toEqual(["lib/index.js: './missing' -> lib/missing is not in the tarball"]);
  });

  it('downgrades extensionless imports that only a bundler can resolve to warnings', async () => {
    const result = await check({
      'dist/index.js': "export * from './types';",
      'dist/types.js': 'export {};',
      'pages/index/index.js': "import Chat from './SandboxChat';",
      'pages/index/SandboxChat.tsx': 'export default 1;',
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      "dist/index.js: './types' is extensionless; only a bundler can resolve it",
      "pages/index/index.js: './SandboxChat' is extensionless; only a bundler can resolve it",
    ]);
  });

  it('requires main, bin and exports targets to be packed, skipping wildcard targets', async () => {
    const manifest = {
      type: 'module',
      main: './lib/index.js',
      bin: { tool: './bin/tool.js' },
      exports: {
        '.': { types: './lib/index.d.ts', import: './lib/index.js' },
        './helper': { import: './lib/helper.js' },
        './features/*': './lib/features/*.js',
      },
    };
    expect(entryTargets(manifest).map(([field]) => field)).toEqual([
      'main',
      'bin.tool',
      'exports["."]["types"]',
      'exports["."]["import"]',
      'exports["./helper"]["import"]',
    ]);
    const result = await check({ 'lib/index.js': '', 'bin/tool.js': '' }, manifest);
    expect(result.errors).toEqual([
      'exports["."]["types"] -> ./lib/index.d.ts is not in the tarball',
      'exports["./helper"]["import"] -> ./lib/helper.js is not in the tarball',
    ]);
  });

  it('checks the published manifest: publishConfig.exports wins, a leaked development condition fails', async () => {
    const exports = { '.': { development: './src/index.ts', import: './lib/index.js' } };
    expect(publishedManifest({ exports, publishConfig: { access: 'public' } }).exports).toBe(exports);

    const stripped = await check({ 'lib/index.js': '' }, {
      type: 'module',
      exports,
      publishConfig: { access: 'public', exports: { '.': { import: './lib/index.js' } } },
    });
    expect(stripped.errors).toEqual([]);

    const leaked = await check({ 'lib/index.js': '' }, { type: 'module', exports });
    expect(leaked.errors).toEqual([
      'exports["."]["development"] -> ./src/index.ts is not in the tarball',
    ]);
  });

  it('ignores non-JavaScript files when scanning imports', async () => {
    const result = await check({
      'src/index.ts': "import './not-built.js';",
      'lib/index.d.ts': "export * from './gone.js';",
    });
    expect(result).toEqual({ errors: [], warnings: [] });
  });
});

function layout(files: Record<string, string>, manifest: Record<string, unknown> = { type: 'module' }) {
  return findPackLayoutProblems({
    files: Object.keys(files),
    manifest,
    readFile: async (file: string) => files[file] ?? '',
  });
}

describe('check-pack-imports layout', () => {
  it('accepts the standard layout', async () => {
    const result = await layout({
      'package.json': '{}',
      'plugin.js': 'export default {};',
      'commands/hello/index.js': 'export default {};',
      'lib/index.js': 'export {};\n//# sourceMappingURL=index.js.map',
      'lib/index.js.map': JSON.stringify({ version: 3, sources: ['../src/index.ts'], sourcesContent: ['export {};'] }),
      'lib/index.d.ts': 'export {};',
      'schema.json': '{}',
      'README.md': '',
    }, { type: 'module', zhin: { protocol: 1, type: 'plugin', entry: './plugin.js' } });
    expect(result).toEqual({ errors: [], warnings: [] });
  });

  it('requires zhin.entry to be packed JavaScript', async () => {
    expect((await layout({ 'lib/index.js': '' }, { zhin: { entry: './plugin.js' } })).errors)
      .toEqual(['zhin.entry -> ./plugin.js is not in the tarball']);
    expect((await layout({ 'plugin.ts': '' }, { zhin: { entry: './plugin.ts' } })).errors)
      .toEqual(['zhin.entry -> ./plugin.ts is not JavaScript']);
  });

  it('rejects packed tests but not a command that happens to be called test', async () => {
    const result = await layout({
      'src/mime.test.ts': '',
      'tests/plugin.ts': '',
      'commands/test/index.js': '',
    });
    expect(result.errors).toEqual(['layout: 2 test file(s) packed, e.g. src/mime.test.ts, tests/plugin.ts']);
    expect(result.warnings).toEqual([]);
  });

  it('warns about packed build configuration', async () => {
    const result = await layout({ 'tsconfig.build.json': '{}', 'vitest.config.ts': '', 'lib/x.tsbuildinfo': '' });
    expect(result.errors).toEqual([]);
    expect(result.warnings[0]).toBe('layout: build configuration packed: lib/x.tsbuildinfo, tsconfig.build.json, vitest.config.ts');
  });

  it('warns when source maps point at sources that are neither packed nor inlined', async () => {
    const map = (sources: string[], sourcesContent?: string[]) => JSON.stringify({ version: 3, sources, sourcesContent });
    const broken = await layout({
      'lib/a.js.map': map(['../src/a.ts']),
      'lib/a.d.ts.map': map(['../src/a.ts']),
    });
    expect(broken.warnings).toEqual([
      'layout: 1 source map / 1 declaration map source(s) not packed or inlined, e.g. lib/a.d.ts.map -> src/a.ts',
    ]);
    const shipped = await layout({ 'lib/a.js.map': map(['../src/a.ts']), 'src/a.ts': '' });
    expect(shipped.warnings).toEqual([]);
    const inlined = await layout({ 'lib/a.js.map': map(['../src/a.ts'], ['export {}']) });
    expect(inlined.warnings).toEqual([]);
  });

  it('warns about TypeScript sources no source map refers to', async () => {
    const result = await layout({
      'commands/hello/index.js': '',
      'commands/hello/index.ts': '',
      'lib/index.d.ts': '',
    });
    expect(result.warnings).toEqual([
      'layout: 1 TypeScript source file(s) packed without a source map referring to them, e.g. commands/hello/index.ts',
    ]);
  });
});
