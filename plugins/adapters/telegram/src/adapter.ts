import { Adapter, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
import { httpHostToken } from '@zhin.js/host-http';
import { TelegramEndpoint, type TelegramEndpointOptions } from './endpoint.js';
import { TelegramClient } from './telegram-client.js';
import { resolveTelegramConfig, type TelegramEndpointConfig } from './protocol.js';
import type { TelegramClientEventMap } from './client.js';

export class TelegramAdapter extends Adapter<TelegramEndpoint, TelegramEndpointConfig, TelegramClientEventMap> {
  constructor(private readonly context: AdapterContext<TelegramEndpointConfig>,
    private readonly transport: Pick<TelegramEndpointOptions, 'fetch' | 'requestTimeoutMs'> = {}) { super(); }
  override get configurationIdentityFields(): readonly string[] { return ['id']; }
  override get configurationIdentityProbeFields(): readonly string[] { return ['token', 'apiBaseUrl']; }
  override get configurationUpdateFields(): readonly string[] { return ['token', 'polling', 'webhook',
    'webhook.domain', 'webhook.path', 'webhook.secretToken', 'allowedUpdates', 'apiBaseUrl']; }
  protected override validateConfiguration(config: TelegramEndpointConfig): void { resolveTelegramConfig(config); }
  protected override async identifyConfiguration(input: TelegramEndpointConfig, signal: AbortSignal): Promise<string> {
    const client = new TelegramClient({ config: resolveTelegramConfig(input), ...this.transport });
    const me = await client.callApi<{ id?: number }>('getMe', {}, signal);
    if (typeof me?.id !== 'number' || !Number.isFinite(me.id)) throw new Error('Telegram identity response is incomplete');
    return JSON.stringify(['telegram', String(me.id)]);
  }
  protected createEndpoint(input: TelegramEndpointConfig, execution: EndpointCreationContext): TelegramEndpoint {
    const config = resolveTelegramConfig(input);
    return new TelegramEndpoint({ id: execution.canonicalId, config, ...this.transport,
      ...(config.mode === 'webhook' ? { http: this.context.use(httpHostToken) } : {}) });
  }
}
