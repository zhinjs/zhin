import { resolveTelegramConfig } from '../src/protocol.js';

it('enables Telegram drafts by default and preserves an explicit opt-out', () => {
  const config = { id: 'fixture', token: 'fixture' };
  expect(resolveTelegramConfig(config).streaming).toBe(true);
  expect(resolveTelegramConfig(config).streamingIntervalMs).toBe(500);
  expect(resolveTelegramConfig({ ...config, streaming: false }).streaming).toBe(false);
  expect(resolveTelegramConfig({ ...config, streamingIntervalMs: 1200 }).streamingIntervalMs).toBe(1200);
});
