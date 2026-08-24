export {
  buildSendMessageParams,
  buildWsConnectOptions,
  callOneBot12Action,
  formatInboundContent,
  formatOutboundSegments,
  getChannelId,
  isBotMentioned,
  isMessageEvent,
  mediaRefToOneBot12Fields,
  mediaRefToOneBot12UploadParams,
  onebot12InboundConversation,
  resolveOneBot12Config,
  senderNickname,
  senderUserId,
  uploadOneBot12MediaSegments,
  type OneBot12ActionRequest,
  type OneBot12ActionResponse,
  type OneBot12AdapterConfig,
  type OneBot12CallAction,
  type OneBot12ConfigBase,
  type OneBot12EndpointConfig,
  type OneBot12Event,
  type OneBot12HttpOptions,
  type OneBot12Segment,
  type OneBot12Self,
  type OneBot12WebhookConfig,
  type OneBot12WireSegment,
  type OneBot12WsConfig,
  type OneBot12WssConfig,
  type ResolvedOneBot12Config,
} from './protocol.js';

export {
  OneBot12WebhookEndpoint,
  type OneBot12WebhookEndpointOptions,
} from './webhook.js';

export {
  OneBot12WsEndpoint,
  type OneBot12WsEndpointOptions,
} from './ws-endpoint.js';

export {
  OneBot12WssEndpoint,
  type OneBot12WssEndpointOptions,
} from './wss-endpoint.js';

export type { OneBot12WsSocket, OneBot12WsCreateOptions } from './ws-types.js';

export { verifyOneBotAccessToken } from './wss-auth.js';
export {
  Onebot12Client,
  onebot12Client,
  type Onebot12ClientEventMap,
} from './client.js';

export type {
  OneBotV12ActionUrlResolver,
  OneBotV12AdapterConfig as ImHelperOneBotV12AdapterConfig,
  OneBotV12Call,
  OneBotV12ClientConfig,
  OneBotV12Event as ImHelperOneBotV12Event,
  OneBotV12Response,
} from '@imhelper/onebot-v12';
export { ProtocolError } from '@imhelper/onebot-v12';
export type { ProtocolErrorKind, ProtocolErrorOptions } from 'imhelper';
