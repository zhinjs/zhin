import type { Adapters, Adapter } from './adapter.js';
import type { EndpointCapability, EndpointCapabilitiesConfig, FullEndpoint } from './endpoint-capabilities.js';
import type { EndpointWithManagement } from '@zhin.js/adapter';

export type {
  EndpointChannel,
  EndpointChannelParent,
  EndpointFriend,
  EndpointGroup,
  EndpointManagement,
  EndpointWithManagement,
  EndpointManagementCapability,
} from '@zhin.js/adapter';
export {
  endpointManagementCapabilityIds,
  listEndpointManagementCapabilities,
  resolveEndpointManagement,
} from '@zhin.js/adapter';

export type {
  EndpointCapability,
  EndpointCapabilitiesConfig,
  InboundEndpoint,
  OutboundEndpoint,
  FullEndpoint,
  CapableEndpoint,
} from './endpoint-capabilities.js';
export {
  DEFAULT_ENDPOINT_CAPABILITIES,
  OutboundNotSupportedError,
  InboundNotSupportedError,
  resolveEndpointCapabilities,
  registerEndpointCapabilities,
  getEndpointCapabilities,
  getAdapterCapabilities,
  hasInbound,
  hasOutbound,
  assertInbound,
  assertOutbound,
} from './endpoint-capabilities.js';

/**
 * Endpoint 接口：全双工平台机器人（入站 + 出站）。
 * 纯入站 / 纯出站请实现 InboundEndpoint / OutboundEndpoint。
 */
export type Endpoint<Config extends object = object, Event extends object = object> = FullEndpoint<
  Config,
  Event
> & EndpointWithManagement;

export namespace Endpoint {
  export type Config<K extends keyof Adapters = keyof Adapters> = Adapter.EndpointConfig<
    Adapter.InferEndpoint<Adapters[K]>
  > &
    EndpointCapabilitiesConfig & {
      context: K;
    };
}
