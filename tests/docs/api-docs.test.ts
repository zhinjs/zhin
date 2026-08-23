import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (relativePath: string) => JSON.parse(
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'),
) as Record<string, unknown>;

const publicModules = [
  { source: 'packages/im/plugin-runtime/src/plugin.ts', module: 'zhin.js' },
  { source: 'packages/im/command/src/definition.ts', module: 'zhin.js/command' },
  { source: 'packages/im/adapter/src/definition.ts', module: 'zhin.js/adapter' },
  { source: 'packages/im/component/src/definition.ts', module: 'zhin.js/component' },
  { source: 'packages/im/middleware/src/definition.ts', module: 'zhin.js/middleware' },
  { source: 'packages/im/handler/src/definition.ts', module: 'zhin.js/handler' },
  { source: 'packages/im/tool/src/definition.ts', module: '@zhin.js/tool' },
  { source: 'packages/im/skill/src/definition.ts', module: '@zhin.js/skill' },
  { source: 'packages/im/prompt-section/src/definition.ts', module: '@zhin.js/prompt-section' },
  { source: 'packages/im/core/src/plugin-runtime/im/public-api.ts', module: 'zhin.js/core/runtime' },
  { source: 'packages/im/agent/src/resource-hub/public-api.ts', module: 'zhin.js/agent' },
  { source: 'packages/host/http/src/public-api.ts', module: '@zhin.js/host-http' },
] as const;

describe('generated API reference', () => {
  it('documents every canonical public authoring entry point', () => {
    const config = readJson('typedoc.json');

    expect(config.entryPoints).toEqual(publicModules.map(({ source }) => source));
    expect(config.out).toBe('docs/public/api');
    expect(config.excludePrivate).toBe(true);
    expect(config.excludeInternal).toBe(true);
  });

  it('treats broken source comments as a documentation build failure', () => {
    const config = readJson('typedoc.json');

    expect(config.treatWarningsAsErrors).toBe(true);
    expect(config.validation).toEqual({
      invalidLink: true,
      notDocumented: false,
      notExported: false,
    });
  });

  it('publishes the generated reference through the documented commands', () => {
    const packageJson = readJson('package.json');
    const scripts = packageJson.scripts as Record<string, string>;

    expect(scripts['docs:api']).toBe('typedoc');
    expect(scripts['check:api-docs']).toBe('node scripts/check-api-docs-surface.mjs');
    expect(scripts['docs:build']).toContain('pnpm docs:api');
    expect(fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8'))
      .toContain('docs/public/api/');
    const deployWorkflow = fs.readFileSync(
      path.join(repoRoot, '.github/workflows/deploy-docs.yml'),
      'utf8',
    );
    expect(deployWorkflow).toContain("'packages/**/src/**'");
    expect(deployWorkflow).toContain("'basic/**/src/**'");
    for (const page of ['docs/reference/api.md', 'docs/en/reference/api.md']) {
      expect(fs.readFileSync(path.join(repoRoot, page), 'utf8'), page)
        .toContain('href="/api/index.html" target="_blank" rel="noopener"');
    }
  });

  it('keeps implementation projections out of the public reference', () => {
    const forbidden = ['AdapterIndex', 'CommandIndex', 'PromptSectionIndex', 'RootController'];
    for (const { source, module } of publicModules) {
      const content = fs.readFileSync(path.join(repoRoot, source), 'utf8');
      expect(content, source).toContain(`@module ${module}`);
      expect(content, source).not.toMatch(/export\s+\*\s+from/u);
      for (const symbol of forbidden) {
        expect(content, source).not.toMatch(new RegExp(
          `export\\s+(?:declare\\s+)?(?:class|interface|type|const|function)\\s+${symbol}\\b`,
          'u',
        ));
        expect(content, source).not.toMatch(new RegExp(
          `export\\s*\\{[^}]*\\b${symbol}\\b`,
          'su',
        ));
      }
    }
  });

  it('matches the generated TypeDoc reflection to the public API allowlist', () => {
    execFileSync(
      process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
      ['check:api-docs'],
      { cwd: repoRoot, stdio: 'pipe' },
    );
  });
});
