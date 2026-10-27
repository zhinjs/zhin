import { DisposeStack, outboundHostToken, projectLocaleToken, scheduleHostToken, createToken } from '@zhin.js/plugin-runtime';
import { defineGamePlugin } from '../src/define-game-plugin.js';
import { GameEventBus } from '../src/game-events.js';
import { GameSessionConflictError } from '../src/session-coordinator.js';
import type { BaseGameSessionRow } from '../src/base-session-service.js';

it('localizes a session conflict only at the presentation boundary', () => {
  const error = new GameSessionConflictError('next', 'active', 'session', 'user');
  expect(error.format('en')).toContain('already have an active');
  expect(error.format('zh-CN')).toBe(error.message);
  expect(error).toMatchObject({ requestedGameId: 'next', activeGameId: 'active', sessionId: 'session', userId: 'user' });
});

it('uses the stored game locale for timeout notifications and keeps legacy rows in Chinese', async () => {
  const base: BaseGameSessionRow = { id: 'game', channel_key: 'channel', status: 'active', created_at: 0, updated_at: 0,
    adapter: 'root/test', endpoint: 'bot', channel_type: 'group', channel_id: 'room' };
  const rows: BaseGameSessionRow[] = [{ ...base, id: 'english', locale: 'en' }, { ...base, id: 'chinese', locale: 'zh-CN' }, { ...base, id: 'legacy' }];
  const services = {
    gameId: 'test', events: new GameEventBus(), bindAvailability() {}, getActiveForUser: async () => null,
    abortStale: async (_idle: number, callback?: (row: BaseGameSessionRow) => void | Promise<void>) => {
      for (const row of rows) await callback?.(row);
      return rows.length;
    },
  };
  const sent: { content: unknown; locale?: string }[] = [];
  let execute: (() => Promise<void>) | undefined;
  const resources = new Map<string, unknown>([
    [projectLocaleToken.id, 'en'],
    [outboundHostToken.id, { send: async (message: { content: unknown }) => { sent.push(message); return 'sent'; } }],
    [scheduleHostToken.id, { register: (job: { execute: () => Promise<void> }) => { execute = job.execute; return () => {}; } }],
  ]);
  const plugin = defineGamePlugin({ name: 'test', game: { id: 'test', title: '测试', titleI18n: { en: 'Test' }, icon: '🎮', description: 'test', commandPrefix: '/unused', commandPath: 'test' },
    tables: [], servicesToken: createToken<typeof services>('localization-test-services'), defineHostTables() {},
    createServices: () => services, session: service => service });
  const lifecycle = new DisposeStack();
  await plugin.setup?.({ resources: {
    has: (token: { id: string }) => resources.has(token.id),
    use: (token: { id: string }) => resources.get(token.id),
    provide: (token: { id: string }, value: unknown) => resources.set(token.id, value),
  }, lifecycle, addGame() {} } as never);
  expect(execute).toBeDefined();
  await execute?.();
  expect(sent.map(item => item.content)).toEqual([
    '🎮 The Test game ended due to inactivity.',
    '🎮 测试对局因长时间无操作已结束。',
    '🎮 测试对局因长时间无操作已结束。',
  ]);
  expect(sent.map(item => item.locale)).toEqual(['en', 'zh-CN', 'zh-CN']);
  await lifecycle.dispose();
});
