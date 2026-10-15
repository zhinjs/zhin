import { describe, expect, it } from 'vitest';
import {
  entryTargets,
  findBrokenPackImports,
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

  it('requires main, bin and exports targets to be packed, skipping development and wildcard targets', async () => {
    const manifest = {
      type: 'module',
      main: './lib/index.js',
      bin: { tool: './bin/tool.js' },
      exports: {
        '.': { types: './lib/index.d.ts', development: './src/index.ts', import: './lib/index.js' },
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

  it('ignores non-JavaScript files when scanning imports', async () => {
    const result = await check({
      'src/index.ts': "import './not-built.js';",
      'lib/index.d.ts': "export * from './gone.js';",
    });
    expect(result).toEqual({ errors: [], warnings: [] });
  });
});
