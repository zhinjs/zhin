import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const configText = readFileSync(join(root, 'zhin.config.yml'), 'utf8');
const config = parse(configText);

describe('qq-games-bot Plugin Runtime contract', () => {
  it('declares the adapter and complete game topology', () => {
    expect(manifest.scripts.dev).toBe('zhin runtime start');
    expect(manifest.zhin.entry).toBe('./plugin.ts');
    expect(manifest.zhin.plugins ?? []).toEqual([]);
    expect(config.configVersion).toBe(2);
    expect(Object.keys(config.plugins))
      .toEqual([
        'qq',
        'group-suite',
        'game-hub',
        'tic-tac-toe',
        'rps',
        'guess-number',
        'dice-duel',
        'dungeon-expedition',
        'idiom-chain',
        'word-riddle',
        'text-adventure',
        'blackjack',
      ]);
    expect(config.plugins.qq).toBe('@zhin.js/adapter-qq');
    for (const [alias, reference] of Object.entries(config.plugins)) {
      if (alias !== 'qq') expect(reference).toBe(`@zhin.js/plugin-${alias}`);
    }
  });

  it('uses top-level instance configuration without legacy hosts', () => {
    expect(config.disable_plugins ?? []).toEqual([]);
    expect(config.qq).toMatchObject({ mode: 'websocket', sandbox: true,
      endpoints: [{ id: 'zhin', appid: '${QQ_APPID}', secret: '${QQ_SECRET}' }] });
    expect(config['group-suite']).toEqual({ keywordReply: false, rankSize: 10, teachCooldownMs: 3000 });
    for (const alias of Object.keys(config.plugins).filter(key => key !== 'qq' && key !== 'group-suite')) {
      expect(config[alias] ?? {}).toEqual({});
    }
    expect(configText).not.toContain('@zhin.js/host-router');
    expect(configText).not.toContain('@zhin.js/host-api');
  });
});
