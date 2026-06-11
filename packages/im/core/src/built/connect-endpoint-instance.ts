import type { Adapter } from '../adapter.js';
import type { Endpoint } from '../endpoint.js';
import type { Plugin } from '../plugin.js';
import {
  assertInbound,
  getAdapterCapabilities,
  hasInbound,
  registerEndpointCapabilities,
  resolveEndpointCapabilities,
  type EndpointCapabilitiesConfig,
} from '../endpoint-capabilities.js';
import { emitEndpointLifecycle } from './endpoint-lifecycle.js';

export interface ConnectEndpointInstanceOptions {
  plugin: Plugin;
  adapter: Adapter;
  config: EndpointCapabilitiesConfig & Record<string, unknown>;
}

/**
 * 按 Endpoint capabilities 连接或注册单个实例（connectEndpoints 与 Adapter.start 共用）。
 */
export async function connectEndpointInstance(options: ConnectEndpointInstanceOptions): Promise<Endpoint> {
  const { plugin, adapter, config } = options;
  const adapterCaps = getAdapterCapabilities(adapter);
  const caps = resolveEndpointCapabilities(adapterCaps, config.capabilities);
  const endpoint = adapter.createEndpoint(config as never);
  registerEndpointCapabilities(endpoint, caps);

  if (caps.includes('inbound')) {
    assertInbound(endpoint);
    try {
      await endpoint.$connect();
      await emitEndpointLifecycle(plugin, adapter, endpoint, 'connect');
    } catch (error) {
      await emitEndpointLifecycle(plugin, adapter, endpoint, 'error', {
        error: error instanceof Error ? error.message : String(error),
        phase: 'connect',
      });
      throw error;
    }
  } else {
    endpoint.$connected = true;
  }

  return endpoint;
}

/**
 * 按 Endpoint capabilities 断开单个实例。
 */
export async function disconnectEndpointInstance(
  plugin: Plugin,
  adapter: Adapter,
  endpoint: Endpoint,
): Promise<void> {
  if (!hasInbound(endpoint)) return;
  assertInbound(endpoint);
  await endpoint.$disconnect();
  await emitEndpointLifecycle(plugin, adapter, endpoint, 'disconnect');
}
