import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

describe('demo-bot config', () => {
  it('configures demo scoped token and cors', () => {
    const configText = readFileSync(resolve(dir, '../zhin.config.yml'), 'utf8');
    expect(configText).toMatch(/scope:\s*demo/);
    expect(configText).toMatch(/demo\.zhin\.dev/);
    expect(configText).toMatch(/host:\s*0\.0\.0\.0/);
  });

  it('conventional hello command contains card and AI guidance', () => {
    const hello = readFileSync(resolve(dir, '../commands/hello.ts'), 'utf8');
    expect(hello).toContain('card');
    expect(hello).toContain('ai:');
  });

  it('uses the Plugin Runtime manifest', () => {
    const manifest = JSON.parse(readFileSync(resolve(dir, '../package.json'), 'utf8'));
    expect(manifest.scripts.dev).toBe('zhin runtime start');
    expect(manifest.zhin.entry).toBe('./plugin.ts');
    expect(manifest.zhin.plugins).toContainEqual({
      package: '@zhin.js/adapter-sandbox',
      instanceKey: 'sandbox',
    });
  });
});
