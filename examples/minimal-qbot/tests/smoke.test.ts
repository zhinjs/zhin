import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const botRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('minimal-qbot smoke', () => {
  it('pnpm start 跑通 enqueue → claim → execute', () => {
    const out = execSync('pnpm start', {
      cwd: botRoot,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    expect(out).toContain('minimal-qbot OK');
    expect(out).toContain('[done] done');
  });
});
