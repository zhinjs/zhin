import { Adapter, createAdapterOutageNotifier, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
import { outboundHostToken } from 'zhin.js';
import { httpHostToken } from '@zhin.js/host-http';
import { QqHttpEndpoint, QqWebsocketEndpoint } from './endpoint.js';
import { resolveQqConfig, type QqEndpointConfig } from './protocol.js';
import type { QqClientEventMap } from './client.js';

export class QqAdapter extends Adapter<QqHttpEndpoint | QqWebsocketEndpoint, QqEndpointConfig, QqClientEventMap> {
  constructor(private readonly context: AdapterContext<QqEndpointConfig>) { super(); }
  override get configurationIdentityFields(): readonly string[] { return ['id', 'appid']; }
  override get configurationIdentityProbeFields(): readonly string[] { return ['accessTokenUrl', 'gatewayUrl']; }
  override get configurationUpdateFields(): readonly string[] { return ['secret', 'mode', 'sandbox', 'intents', 'botKind',
    'accessTokenUrl', 'gatewayUrl', 'streamProxy', 'streamProxy.port', 'streamProxy.serverName', 'webhookPath']; }
  protected override validateConfiguration(input: QqEndpointConfig): void { resolveQqConfig(input); }
  protected createEndpoint(input: QqEndpointConfig, execution: EndpointCreationContext): QqHttpEndpoint | QqWebsocketEndpoint {
    const config = resolveQqConfig(input);
    const outbound = this.context.has?.(outboundHostToken) ? this.context.use(outboundHostToken) : undefined;
    const notifier = createAdapterOutageNotifier(outbound, config.notify);
    return config.mode === 'websocket'
      ? new QqWebsocketEndpoint({ id: execution.canonicalId, config, notifier })
      : new QqHttpEndpoint({ id: execution.canonicalId, config, notifier, http: this.context.use(httpHostToken) });
  }
}
