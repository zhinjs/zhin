export const displayName = 'iPad WeChat';

export {
  ADAPTER_KEY,
  DEFAULT_DATA_DIR,
  isGroupId,
  planOutbound,
  projectInbound,
  resolveIpadWechatConfig,
  type InboundIpadMessage,
  type OutboundPart,
  type ResolvedIpadWechatConfig,
  type IpadWechatEndpointConfig,
  type IpadWechatVerificationConfig,
} from './protocol.js';
export { loadIpadSdk, type IpadClient, type IpadSdk } from './sdk.js';
export { IpadWechatLoginReporter } from './login.js';
export { IpadWechatClient, IpadWechatLoginError, mediaSource, type IpadWechatEndpointOptions } from './client.js';
export { IpadWechatEndpoint } from './endpoint.js';
export { IpadWechatAdapter, type IpadWechatAdapterOptions } from './adapter.js';
