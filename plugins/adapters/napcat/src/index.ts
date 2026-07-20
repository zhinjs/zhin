export {
  buildSendAction,
  buildWsConnectOptions,
  callNapCatHttpAction,
  formatInboundContent,
  formatInboundTarget,
  formatOutboundSegments,
  getChannelId,
  isMessageEvent,
  parseSendTarget,
  resolveNapCatConfig,
  senderNickname,
  senderUserId,
  type MessageSegment,
  type NapCatActionRequest,
  type NapCatActionResponse,
  type NapCatAdapterConfig,
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

export {
  InboundMessageDeduper,
  isNapCatBotMentioned,
  isSelfMessage,
  normalizeMessage,
} from './napcat-inbound.js';

export {
  getEndpoint,
  getNapcatAgentDeps,
  registerNapcatAgentEndpoint,
  setNapcatAgentDeps,
  type NapcatAgentDeps,
  type NapcatAgentEndpoint,
} from './napcat-agent-deps.js';

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
  callNapCatWsAction,
  decodeWsPayload,
  handleNapCatWsMessage,
  rejectAllPending,
  startNapCatHeartbeat,
} from './ws-transport.js';

export { verifyNapCatAccessToken } from './wss-auth.js';

export { readRequestBody } from './webhook.js';
