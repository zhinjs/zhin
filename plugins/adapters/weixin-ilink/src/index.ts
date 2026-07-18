export {
  formatInboundContent,
  formatOutboundSegments,
  inboundMessageId,
  resolveWeixinIlinkConfig,
  segmentLocalPath,
  sleep,
  type ResolvedWeixinIlinkConfig,
  type WeixinIlinkAdapterConfig,
  type WeixinIlinkEndpointConfig,
  type WeixinInboundMediaPaths,
  type WeixinMessageWithMedia,
  type WeixinWireSegment,
} from './protocol.js';

export type { WeixinMessage, MessageItem } from './ilink-types.js';
export type { WeixinIlinkCredentials } from './credentials.js';

export {
  WeixinIlinkEndpoint,
  type WeixinIlinkEndpointOptions,
  type WeixinIlinkGetUpdates,
  type WeixinIlinkNotifyStart,
  type WeixinIlinkNotifyStop,
  type WeixinIlinkSendText,
} from './endpoint.js';
