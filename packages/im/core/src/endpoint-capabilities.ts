import type { Message } from './message.js';
import type { Notice } from './notice.js';
import type { Request } from './request.js';
import type { SendOptions } from './types.js';
import type { AIAccessScopeConfig } from './built/ai-access.js';

export type EndpointCapability = 'inbound' | 'outbound';

export const DEFAULT_ENDPOINT_CAPABILITIES: readonly EndpointCapability[] = ['inbound', 'outbound'];

/** 入站能力：含连接生命周期 */
export interface InboundEndpoint<Config extends object = object, Event extends object = object> {
  $id: string;
  $config: Config;
  $connected: boolean;
  $formatMessage(event: Event): Message<Event>;
  $formatNotice?(event: unknown): Notice;
  $formatRequest?(event: unknown): Request;
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
}

/** 出站能力：无连接方法 */
export interface OutboundEndpoint<Config extends object = object> {
  $id: string;
  $config: Config;
  $connected: boolean;
  $sendMessage(options: SendOptions): Promise<string>;
  $recallMessage(id: string): Promise<void>;
}

export type FullEndpoint<Config extends object = object, Event extends object = object> =
  InboundEndpoint<Config, Event> & OutboundEndpoint<Config>;

export type CapableEndpoint<
  Config extends object,
  Event extends object,
  Caps extends readonly EndpointCapability[],
> =
  ('inbound' extends Caps[number] ? InboundEndpoint<Config, Event> : object) &
  ('outbound' extends Caps[number] ? OutboundEndpoint<Config> : object);

export class OutboundNotSupportedError extends Error {
  constructor(endpointId?: string) {
    super(endpointId ? `Endpoint ${endpointId} does not support outbound` : 'Outbound not supported');
    this.name = 'OutboundNotSupportedError';
  }
}

export class InboundNotSupportedError extends Error {
  constructor(endpointId?: string) {
    super(endpointId ? `Endpoint ${endpointId} does not support inbound` : 'Inbound not supported');
    this.name = 'InboundNotSupportedError';
  }
}

const endpointCapabilitiesRegistry = new WeakMap<object, readonly EndpointCapability[]>();

export function registerEndpointCapabilities(
  endpoint: object,
  caps: readonly EndpointCapability[],
): void {
  endpointCapabilitiesRegistry.set(endpoint, caps);
}

export function getEndpointCapabilities(endpoint: object): readonly EndpointCapability[] | undefined {
  return endpointCapabilitiesRegistry.get(endpoint);
}

export function resolveEndpointCapabilities(
  adapterCaps: readonly EndpointCapability[],
  endpointConfigCaps?: readonly EndpointCapability[],
): readonly EndpointCapability[] {
  const resolved: EndpointCapability[] =
    endpointConfigCaps?.length ? [...endpointConfigCaps] : [...adapterCaps];

  if (resolved.length === 0) {
    throw new Error('Endpoint must declare at least one capability (inbound and/or outbound)');
  }

  for (const cap of resolved) {
    if (!adapterCaps.includes(cap)) {
      throw new Error(
        `Endpoint capability "${cap}" exceeds adapter capabilities [${adapterCaps.join(', ')}]`,
      );
    }
  }

  return resolved;
}

export function getAdapterCapabilities(adapter: object): readonly EndpointCapability[] {
  const ctor = adapter.constructor as { capabilities?: readonly EndpointCapability[] };
  const caps = ctor.capabilities;
  return caps?.length ? caps : DEFAULT_ENDPOINT_CAPABILITIES;
}

export function hasInbound(endpoint: object): boolean {
  const caps = getEndpointCapabilities(endpoint);
  return caps ? caps.includes('inbound') : true;
}

export function hasOutbound(endpoint: object): boolean {
  const caps = getEndpointCapabilities(endpoint);
  return caps ? caps.includes('outbound') : true;
}

export function assertInbound(
  endpoint: InboundEndpoint | OutboundEndpoint,
): asserts endpoint is InboundEndpoint {
  if (!hasInbound(endpoint)) {
    throw new InboundNotSupportedError('$id' in endpoint ? String(endpoint.$id) : undefined);
  }
}

export function assertOutbound(
  endpoint: InboundEndpoint | OutboundEndpoint,
): asserts endpoint is OutboundEndpoint {
  if (!hasOutbound(endpoint)) {
    throw new OutboundNotSupportedError('$id' in endpoint ? String(endpoint.$id) : undefined);
  }
}

export interface EndpointCapabilitiesConfig {
  capabilities?: EndpointCapability[];
  /** 本 Endpoint 的 AI 访问控制（覆盖 ai.access 全局默认） */
  aiAccess?: AIAccessScopeConfig;
}
