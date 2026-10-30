import { Adapter, createAdapterOutageNotifier, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
import { projectLocaleToken } from 'zhin.js/i18n';
import { loginAssistToken } from '@zhin.js/core/runtime';
import { outboundHostToken } from 'zhin.js';
import { IcqqEndpoint } from './endpoint.js';
import { resolveIcqqConfig, type IcqqEndpointConfig } from './protocol.js';
import type { IcqqClientEventMap } from './client.js';

/** ICQQ account construction and actual SDK ownership belong to this Adapter. */
export class IcqqAdapter extends Adapter<IcqqEndpoint, IcqqEndpointConfig, IcqqClientEventMap> {
  override get configurationIdentityFields(): readonly string[] { return ['id']; }
  override get configurationUpdateFields(): readonly string[] {
    return ['password', 'platform', 'ver', 'dataDir', 'signApiAddr', 'autoReconnect', 'autoServer', 'qqnt', 'ntLogin'];
  }
  readonly #context: AdapterContext<IcqqEndpointConfig>;
  constructor(context: AdapterContext<IcqqEndpointConfig>) { super(); this.#context = context; }
  protected override validateConfiguration(config: IcqqEndpointConfig): void { resolveIcqqConfig(config); }
  protected createEndpoint(input: IcqqEndpointConfig, execution: EndpointCreationContext): IcqqEndpoint {
    const context = this.#context;
    const config = resolveIcqqConfig(input);
    const outbound = context.has?.(outboundHostToken) ? context.use(outboundHostToken) : undefined;
    const endpoint = new IcqqEndpoint({ id: execution.canonicalId, config,
      signal: execution.signal, endpointIdentity: { canonicalId: execution.canonicalId, instanceId: execution.instanceId, epoch: execution.epoch, incarnationId: execution.incarnationId },
      loginAssist: context.use(loginAssistToken), locale: context.use(projectLocaleToken),
      notifier: createAdapterOutageNotifier(outbound, config.notify),
    });
    return endpoint;
  }
}
