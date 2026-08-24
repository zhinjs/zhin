export {
  buildTextReply,
  computeSignatureHash,
  decryptEchostr,
  decryptMessage,
  encryptMessage,
  extractOutboundText,
  formatCustomerServiceBody,
  formatInboundContent,
  formatInboundId,
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
  WeChatMpClient,
  wechatMpClient,
  type WeChatMpClientEventMap,
  type WeChatMpFetch,
} from './client.js';

export {
  WeChatMpEndpoint,
  type WeChatMpEndpointOptions,
} from './endpoint.js';

export {
  buildMediaUploadForm,
  readOutboundMedia,
  resolveMediaBinary,
  type MediaBinary,
  type WeChatMediaUploadResult,
} from './media-upload.js';

export {
  registerWeChatMpWebhookRoutes,
  handleWeChatMpVerification,
  handleWeChatMpMessage,
  collectPassiveReply,
  type WeChatMpWebhookHandler,
} from './webhook.js';
