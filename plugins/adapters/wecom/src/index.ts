export {
  buildSendRequestBody,
  decryptMessage,
  extractEncryptFromXml,
  formatInboundContent,
  formatOutboundBody,
  getAesKey,
  normalizeEchostrParam,
  normalizeWebhookPath,
  parseXmlMessage,
  queryParam,
  readTextBody,
  resolveChatType,
  resolveWecomConfig,
  verifySignature,
  type AccessToken,
  type ResolvedWecomConfig,
  type WecomAdapterConfig,
  type WecomApiResponse,
  type WecomMessage,
  type WecomSendBody,
  type WecomWireSegment,
} from './protocol.js';

export { wecomClient, type WecomClientEventMap } from './client.js';

export {
  checkWecomPlatformPermit,
  normalizeWecomSenderForPermit,
  platformPermit,
  wecomGroupPermitResolver,
} from './platform-permit.js';

export {
  WecomClient,
  WecomEndpoint,
  type WecomClientApi,
  type WecomEndpointOptions,
  type WecomFetch,
} from './endpoint.js';

export {
  buildMediaUploadForm,
  readOutboundImageMedia,
  resolveMediaBinary,
  type MediaBinary,
  type WecomMediaUploadResult,
} from './media-upload.js';

export {
  registerWecomWebhookRoutes,
  handleWecomVerificationRequest,
  handleWecomWebhookRequest,
  type WecomWebhookHandler,
} from './webhook.js';
