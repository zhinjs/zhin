export {
  buildSendAction,
  buildWsConnectOptions,
  callNapCatHttpAction,
  formatInboundContent,
  formatOutboundSegments,
  getChannelId,
  isMessageEvent,
  mediaRefToOneBotFile,
  napcatInboundConversation,
  napcatOutboundTarget,
  resolveNapCatConfig,
  senderNickname,
  senderUserId,
  type MessageSegment,
  type NapCatActionRequest,
  type NapCatActionResponse,
  type NapCatConfigBase,
  type NapCatEndpointConfig,
  type NapCatEvent,
  type NapCatHttpConfig,
  type NapCatMessageEvent,
  type NapCatSender,
  type NapCatWireSegment,
  type NapCatWsConfig,
  type NapCatWssConfig,
  type ParsedSendTarget,
  type ResolvedNapCatConfig,
} from './protocol.js';
export { NapcatAdapter } from './adapter.js';

export {
  InboundMessageDeduper,
  isNapCatBotMentioned,
  isSelfMessage,
  normalizeMessage,
} from './napcat-inbound.js';

export {
  type NapcatClient,
  type NapcatClientEventMap,
  type NapcatClientOptions,
  type NapcatMemberTitleRequest,
  type NapcatProfileRequest,
  type NapcatGroupFileRequest,
  type NapcatMiniAppRequest,
} from './client.js';

export { parseOneBotGetMsgResponse } from './onebot-get-msg.js';

export {
  NapCatWsEndpoint,
  type NapCatWsEndpointOptions,
} from './ws-endpoint.js';

export {
  NapCatWssEndpoint,
  type NapCatWssEndpointOptions,
} from './wss-endpoint.js';

export {
  NapCatHttpEndpoint,
  type NapCatHttpEndpointOptions,
} from './http-endpoint.js';

export type { NapCatWsSocket, NapCatWsCreateOptions } from './ws-types.js';

export {
  createNapCatRpc,
  decodeWsPayload,
  type NapCatRpc,
  type NapCatRpcOptions,
} from './ws-transport.js';

export { verifyNapCatAccessToken } from './wss-auth.js';

export { readRequestBody } from './webhook.js';
