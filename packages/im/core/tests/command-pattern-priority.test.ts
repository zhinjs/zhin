import { describe, it, expect } from 'vitest';
import { MessageCommand } from '../src/command.js';
import { CommandFeature, compareCommandPatterns } from '../src/built/command.js';

describe('CommandFeature pattern priority', () => {
  const mockPlugin = {
    contextIsReady: () => false,
    inject: () => null,
    root: {},
  } as any;

  const message = (text: string) =>
    ({
      $content: [{ type: 'text', data: { text } }],
      $adapter: 'process',
      $endpoint: 'x',
      $sender: { id: '1' },
    }) as any;

  it('compareCommandPatterns 同首词时较长 pattern 优先', () => {
    expect(compareCommandPatterns('/qbot add [name:word]', '/qbot')).toBeLessThan(0);
    expect(compareCommandPatterns('/qbot', '/qbot add [name:word]')).toBeGreaterThan(0);
  });

  it('/qbot 裸 pattern 不应抢 /qbot add', async () => {
    const feature = new CommandFeature();
    feature.add(new MessageCommand('/qbot help').action(() => 'HELP'), 'qq');
    feature.add(new MessageCommand('/qbot').action(() => 'BARE'), 'qq');
    feature.add(new MessageCommand('/qbot add [name:word]').action(() => 'ADD'), 'qq');

    expect(await feature.handle(message('/qbot add'), mockPlugin)).toBe('ADD');
    expect(await feature.handle(message('/qbot'), mockPlugin)).toBe('BARE');
    expect(await feature.handle(message('/qbot help'), mockPlugin)).toBe('HELP');
  });
});
