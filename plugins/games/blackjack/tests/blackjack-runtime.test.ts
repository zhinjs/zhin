import { invokeGameCommand } from '../../../../packages/game-kit/tests/command-operation-fixture.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import plugin from '../plugin.ts';
import gameCommand from '../commands/bj/[[action]]/index.ts';
import { BJ_HELP } from '../src/index.js';
import {
  createMemoryGameServices,
  plainTextFromSendContent,
  type GameReply,
} from '@zhin.js/game-kit';
import { createServices } from '../src/session-service.js';
let services: ReturnType<typeof createServices>;

const emptyCtx = {
  owner: {} as never,
  generation: 0,
  config: {},
  use: () => services,
  args: [] as string[],
  params: {} as Record<string, string | number | boolean>,
  input: { conversation: { endpoint: { adapter: 'synthetic', id: 'test-account' }, kind: 'private', id: 'alice' }, sender: { id: 'alice', name: 'Alice' }, content: '' } as never,
};

describe('@zhin.js/plugin-blackjack runtime (slice-2)', () => {
  beforeEach(() => {
    services = createMemoryGameServices(['bj_sessions'], createServices);
  });

  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('blackjack');
  });

  it('brands bj command', () => {
    expect(parseCommandDefinition(gameCommand)).toBe(gameCommand);
  });

  it('help action returns help text', async () => {
    const result = await invokeGameCommand(gameCommand, {
      ...emptyCtx,
      params: {},
    });
    expect(String(result)).toBe(BJ_HELP);
  });

  it('start action returns a playable keyboard', async () => {
    const result = await invokeGameCommand(gameCommand, {
      ...emptyCtx,
      params: { action: 'start' },
    });
    expect(plainTextFromSendContent(result as GameReply)).toContain('21 点');
    expect((result as unknown[]).some((part) =>
      (part as { type?: string }).type === 'keyboard')).toBe(true);
  });

  it('short words: `二十一点 开会` is no command, `二十一点 要牌` plays (#1250 第 82 批)', async () => {
    const pattern = gameCommand.match!;
    expect(pattern.test('二十一点 开会')).toBe(false);
    const run = (text: string) => invokeGameCommand(gameCommand, { ...emptyCtx, params: { action: '' }, match: pattern.exec(text)! });
    expect(plainTextFromSendContent(await run('21点 要牌') as GameReply)).not.toContain('21 点');
    expect(plainTextFromSendContent(await run('二十一点 开始') as GameReply)).toContain('21 点');
    const hit = plainTextFromSendContent(await run('二十一点 要牌') as GameReply);
    expect(hit).not.toBe(BJ_HELP);
    expect(String(await run('二十一点'))).toBe(BJ_HELP);
  });
});
