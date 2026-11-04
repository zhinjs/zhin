import { Adapter, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
import { httpHostToken } from '@zhin.js/host-http';
import { KookWebhookEndpoint, KookWebsocketEndpoint } from './endpoint.js';
import { RuntimeKookClient, kookWebhookClientOptions, kookWebsocketClientOptions } from './ws.js';
import { resolveKookConfig, type KookEndpointConfig } from './protocol.js';
import type { KookClientEventMap } from './client.js';

export class KookAdapter extends Adapter<KookWebhookEndpoint | KookWebsocketEndpoint, KookEndpointConfig, KookClientEventMap> {
  constructor(private readonly context: AdapterContext<KookEndpointConfig>) { super(); }
  override get configurationIdentityFields(): readonly string[] { return ['id']; }
  override get configurationIdentityProbeFields(): readonly string[] { return ['token', 'verify_token', 'encrypt_key']; }
  override get configurationUpdateFields(): readonly string[] { return ['token', 'verify_token', 'encrypt_key', 'connection',
    'webhookPath', 'data_dir', 'timeout', 'max_retry', 'ignore', 'logLevel', 'apiProxy', 'apiProxy.port',
    'streamProxy', 'streamProxy.port', 'streamProxy.serverName']; }
  protected override validateConfiguration(input: KookEndpointConfig): void { resolveKookConfig(input); }
  protected override async identifyConfiguration(input: KookEndpointConfig, signal: AbortSignal, changedFields: readonly string[]): Promise<string | undefined> {
    if (changedFields.some(field => field !== 'token')) return undefined;
    const config = resolveKookConfig(input);
    const options = config.connection === 'websocket' ? kookWebsocketClientOptions(config) : kookWebhookClientOptions(config);
    // Webhook receiver construction has no gateway socket or login; only GET /v3/user/me is issued.
    const client = new RuntimeKookClient({ ...options, mode: 'webhook' }, undefined, config.apiProxy);
    client.request.interceptors.request.use(request => { request.signal = signal; return request; });
    try {
      const me = await client.getSelfInfo();
      if (typeof me?.id !== 'string' || !me.id.trim()) throw new Error('KOOK identity response is incomplete');
      return JSON.stringify(['kook', me.id]);
    } finally { await client.disconnect(); }
  }
  protected createEndpoint(input: KookEndpointConfig, execution: EndpointCreationContext): KookWebhookEndpoint | KookWebsocketEndpoint {
    const config = resolveKookConfig(input);
    return config.connection === 'webhook'
      ? new KookWebhookEndpoint({ id: execution.canonicalId, config, http: this.context.use(httpHostToken) })
      : new KookWebsocketEndpoint({ id: execution.canonicalId, config });
  }
}
