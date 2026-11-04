import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ADR 0044 §3: platform event mappings live in adapters / @zhin.js/adapter-onebot-events, not in core.
const PLATFORM_NAMES = ['onebot', 'napcat', 'icqq', 'kook', 'slack', 'discord', 'telegram', 'bilibili', 'wecom', 'lark', 'dingtalk', 'satori', 'milky'];

describe('core side-event has no platform literals', () => {
  const dir = join(import.meta.dirname, '../src/side-event');
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts'))) {
    it(`${file} mentions no platform name`, () => {
      const text = readFileSync(join(dir, file), 'utf8').toLowerCase();
      expect(PLATFORM_NAMES.filter((name) => text.includes(name))).toEqual([]);
    });
  }
});
