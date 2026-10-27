import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import {
  createMemoryGameServices,
  plainTextFromSendContent,
  type GameReply,
} from '@zhin.js/game-kit';
import plugin from '../plugin.ts';
import dungeonCommand from '../commands/dungeon/[[action]]/index.ts';
import {
  createServices,
  type SessionService,
} from '../src/session-service.js';

let service: SessionService;

const context = {
  owner: {} as never,
  generation: 0,
  config: {},
  use: () => service,
  args: [] as string[],
  params: {} as Record<string, string | number | boolean>,
  input: undefined as never,
};

describe('@zhin.js/plugin-dungeon-expedition runtime', () => {
  beforeEach(() => {
    service = createMemoryGameServices(
      ['dungeon_sessions'],
      createServices,
    );
  });

  it('defines a discoverable plugin and command', () => {
    expect(plugin.name).toBe('dungeon-expedition');
    expect(parseCommandDefinition(dungeonCommand)).toBe(dungeonCommand);
  });

  it('creates a structured expedition from the command', async () => {
    const reply = await dungeonCommand.execute({
      ...context,
      params: { action: '开始' },
    });
    const text = plainTextFromSendContent(reply as GameReply);

    expect(text).toContain('地牢远征');
    expect(text).toContain('等待队员');
    expect((reply as unknown[])[1]).toMatchObject({ type: 'keyboard' });
  });
});


it('keeps the opening language for the actual dungeon inactivity job', async () => {
  const { DisposeStack, outboundHostToken, scheduleHostToken } = await import('zhin.js/plugin-runtime');
  const { gameServicesToken } = await import('../src/runtime-store.js');
  let timestamp = Date.UTC(2026, 0, 1);
  const now = vi.spyOn(Date, 'now').mockImplementation(() => timestamp);
  const send = vi.fn();
  let execute: (() => Promise<void>) | undefined;
  const values = new Map<string, unknown>([
    [outboundHostToken.id, { send }],
    [scheduleHostToken.id, { register(job: { execute: () => Promise<void> }) { execute = job.execute; return () => {}; } }],
  ]);
  const lifecycle = new DisposeStack();
  await plugin.setup?.({ resources: {
    has: (token: { id: string }) => values.has(token.id),
    use: (token: { id: string }) => values.get(token.id),
    provide: (token: { id: string }, value: unknown) => values.set(token.id, value),
  }, lifecycle, addGame() {} } as never);
  try {
    const sessions = values.get(gameServicesToken.id) as SessionService;
    for (const locale of ['en', 'zh-CN'] as const) {
      await sessions.createSession({ locale, $adapter: 'root/test', $endpoint: 'bot',
        $channel: { type: 'group', id: locale }, $sender: { id: locale, name: locale } });
    }
    timestamp += 31 * 60_000;
    await execute?.();
    expect(send.mock.calls.map(call => call[0])).toEqual([
      expect.objectContaining({ locale: 'en', content: 'Dungeon Expedition ended after 30 minutes of inactivity.' }),
      expect.objectContaining({ locale: 'zh-CN', content: '地牢远征因 30 分钟无人操作，已自动结束。' }),
    ]);
  } finally {
    await lifecycle.dispose();
    now.mockRestore();
  }
});
