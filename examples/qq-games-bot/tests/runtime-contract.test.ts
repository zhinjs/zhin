import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const config = readFileSync(join(root, 'zhin.config.yml'), 'utf8');

describe('qq-games-bot Plugin Runtime contract', () => {
  it('declares the adapter and complete game topology', () => {
    expect(manifest.scripts.dev).toBe('zhin runtime start');
    expect(manifest.zhin.entry).toBe('./plugin.ts');
    expect(manifest.zhin.plugins.map((item: { instanceKey: string }) => item.instanceKey))
      .toEqual([
        'qq',
        'group-suite',
        'game-hub',
        'tic-tac-toe',
        'rps',
        'guess-number',
        'dice-duel',
        'idiom-chain',
        'word-riddle',
        'text-adventure',
        'blackjack',
      ]);
  });

  it('uses hierarchical child configuration without legacy hosts', () => {
    expect(config).toMatch(/plugins:\s*\n\s+qq:/u);
    expect(config).toMatch(/\n\s+group-suite:/u);
    expect(config).not.toContain('@zhin.js/host-router');
    expect(config).not.toContain('@zhin.js/host-api');
  });
});
