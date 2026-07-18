export {
  buildTextReply,
  computeSignatureHash,
  decryptEchostr,
  decryptMessage,
  encryptMessage,
  extractOutboundText,
  formatCustomerServiceBody,
  formatInboundContent,
  isEncryptedEchostr,
  normalizeEchostrParam,
  parseXMLMessage,
  queryParam,
  readTextBody,
  resolveEventPassiveReply,
  resolveWeChatMpConfig,
  verifySignature,
  type ResolvedWeChatMpConfig,
  type TokenResponse,
  type WeChatAPIResponse,
  type WeChatMessage,
  type WeChatMpAdapterConfig,
  type WeChatWireSegment,
} from './protocol.js';

export {
  getPassiveReplyCapture,
  recordPassiveReplyText,
  runWithPassiveReplyCapture,
  type PassiveReplyCapture,
} from './passive-reply.js';

export {
  WeChatMpEndpoint,
  type WeChatMpEndpointOptions,
  type WeChatMpFetch,
} from './endpoint.js';

export {
  registerWeChatMpWebhookRoutes,
  handleWeChatMpVerification,
  handleWeChatMpMessage,
  collectPassiveReply,
  type WeChatMpWebhookHandler,
} from './webhook.js';
