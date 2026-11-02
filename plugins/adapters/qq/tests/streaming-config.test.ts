import { resolveQqConfig } from '../src/protocol.js';

it.each(['websocket', 'webhook', 'middleware'] as const)('enables QQ %s streaming by default and preserves an explicit opt-out', mode => {
  const config = { id: 'fixture', appid: 'fixture', secret: 'fixture', mode };
  expect(resolveQqConfig(config).streaming).toBe(true);
  expect(resolveQqConfig(config).streamingIntervalMs).toBe(500);
  expect(resolveQqConfig({ ...config, streaming: false }).streaming).toBe(false);
  expect(resolveQqConfig({ ...config, streamingIntervalMs: 1200 }).streamingIntervalMs).toBe(1200);
});
