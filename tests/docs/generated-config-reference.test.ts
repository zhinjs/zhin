import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('generated configuration reference', () => {
  it('is reproducible from runtime source and plugin JSON Schema', () => {
    expect(() => execFileSync(
      process.execPath,
      ['scripts/generate-config-reference.mjs', '--check'],
      { cwd: repoRoot, stdio: 'pipe' },
    )).not.toThrow();
  });

  it('publishes field-level host and plugin contracts in both languages', () => {
    const zh = fs.readFileSync(path.join(repoRoot, 'docs/configuration/generated.md'), 'utf8');
    const en = fs.readFileSync(path.join(repoRoot, 'docs/en/configuration/generated.md'), 'utf8');

    for (const content of [zh, en]) {
      expect(content).toContain('`http`');
      expect(content).toContain('`plugins.qq.mode`');
      expect(content).toContain('`plugins.sandbox.endpoints`');
      expect(content).toContain('"websocket"');
      expect(content).toContain('plugins/adapters/qq/schema.json');
      expect(content).toContain('plugins.content-moderation.actions.pass` | string:');
      expect(content).not.toContain('| unknown |');
    }
    expect(zh).toContain('由源码与 JSON Schema 自动生成');
    expect(en).toContain('Generated from runtime source and JSON Schema');
  });
});
