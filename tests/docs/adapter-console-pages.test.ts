import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const adaptersRoot = path.join(repoRoot, 'plugins/adapters');

function adapterDirectories(): string[] {
  return fs.readdirSync(adaptersRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(adaptersRoot, name, 'plugin.ts')))
    .sort();
}

function pageSource(directory: string): string | undefined {
  for (const candidate of ['pages/index/index.ts', 'pages/index/index.tsx']) {
    const file = path.join(adaptersRoot, directory, candidate);
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  }
  return undefined;
}

describe('adapter Console pages', () => {
  it('every adapter ships a page and declares the page feature', () => {
    const directories = adapterDirectories();
    expect(directories.length).toBeGreaterThanOrEqual(20);
    for (const directory of directories) {
      const packagePath = path.join(adaptersRoot, directory, 'package.json');
      const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as {
        files?: string[];
        dependencies?: Record<string, string>;
        zhin?: { features?: { package?: string }[] };
      };
      const source = pageSource(directory);
      expect(source, `${directory} should have pages/index/index.ts(x)`).toBeTypeOf('string');
      expect(source).toContain('definePage');
      expect(source).toContain('@zhin.js/console-contract');
      expect(manifest.zhin?.features?.some((feature) => feature.package === '@zhin.js/page')).toBe(true);
      expect(manifest.dependencies?.['@zhin.js/page']).toBeTypeOf('string');
      expect(manifest.files).toContain('pages');
    }
  });

  it('shared adapter pages are permission-gated and use the shared component', () => {
    for (const directory of adapterDirectories()) {
      if (directory === 'bilibili' || directory === 'sandbox') continue;
      const source = pageSource(directory) ?? '';
      expect(source, directory).toContain('createAdapterConsolePage');
      expect(source, directory).toMatch(/requiredPermissions:\s*\[\s*['"][a-z0-9-]+:read['"]\s*\]/u);
    }
  });

  it('adapter plugins wire the Console RPC token except the fully custom sandbox', () => {
    for (const directory of adapterDirectories()) {
      if (directory === 'sandbox') continue;
      const plugin = fs.readFileSync(path.join(adaptersRoot, directory, 'plugin.ts'), 'utf8');
      expect(plugin, directory).toContain('pluginConsoleRpcToken');
    }
  });
});
