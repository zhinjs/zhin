import { createHttpHost } from '@zhin.js/host-http';
import type { EndpointEventGateway } from 'zhin.js/adapter';
import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { TelegramEndpoint, type TelegramEndpointOptions } from '../src/endpoint.js';
import { resolveTelegramConfig } from '../src/protocol.js';

/** A real owned Endpoint; callers keep native API calls separate from framework lifecycle. */
export function telegramFixture(options: TelegramEndpointOptions,
  gateway?: { receive?(payload: unknown): unknown }, sideEvents?: Parameters<typeof createTestEventGateway>[1],
  events?: EndpointEventGateway) {
  return createEndpointHarness(() => new TelegramEndpoint(options), {
    id: options.config.id, name: 'telegram', capabilities: ['inbound', 'outbound'], operations: ['recall'],
    gateway: events ?? createTestEventGateway(gateway, sideEvents),
  });
}

/** Delivery-only fakes do not need to implement startup or a live poll transport. */
export async function telegramDeliveryFixture(options: TelegramEndpointOptions) {
  const fetch = options.fetch!;
  const ownedHttp = options.http ? undefined : createHttpHost({ port: 0 });
  const fixture = await telegramFixture({ ...options,
    config: resolveTelegramConfig({ ...options.config, polling: false,
      webhook: options.config.webhook ?? { domain: 'https://fixture.invalid' } }),
    fetch: (url, init) => {
      if (url.endsWith('/getUpdates')) return new Promise(() => {});
      if (['getMe', 'deleteWebhook', 'setWebhook'].some(method => url.endsWith(`/${method}`))) {
        return Promise.resolve({ ok: true, status: 200,
          text: async () => JSON.stringify({ ok: true, result: url.endsWith('/getMe') ? { id: 1 } : true }), json: async () => ({}) });
      }
      return fetch(url, init);
    },
    http: options.http ?? ownedHttp,
  });
  await fixture.start(); fixture.open();
  return { ...fixture, stop: async () => {
    await fixture.stop();
    await ownedHttp?.close();
  } };
}
