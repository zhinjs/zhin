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
});
