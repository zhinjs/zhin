export {
  formatInboundContent,
  formatOutboundBody,
  generateMessageId,
  headerValue,
  normalizeWebhookPath,
  readTextBody,
  resolveChatType,
  resolveDingTalkConfig,
  resolveSender,
  resolveTarget,
  verifySignature,
  type AccessToken,
  type DingTalkAdapterConfig,
  type DingTalkApiResponse,
  type DingTalkEvent,
  type DingTalkMessage,
  type DingTalkSendBody,
  type DingTalkWireSegment,
  type ResolvedDingTalkConfig,
} from './protocol.js';

export {
  DingTalkEndpoint,
  type DingTalkEndpointOptions,
  type DingTalkFetch,
} from './endpoint.js';

export {
  registerDingTalkWebhookRoutes,
  handleDingTalkWebhookRequest,
  type DingTalkWebhookHandler,
} from './webhook.js';

export {
  getDingtalkAgentDeps,
  registerDingtalkAgentEndpoint,
  setDingtalkAgentDeps,
  type DingtalkAgentDeps,
  type DingtalkAgentEndpoint,
} from './dingtalk-agent-deps.js';

export {
  checkDingtalkPlatformPermit,
  dingtalkGroupPermitResolver,
  normalizeDingtalkSenderForPermit,
  platformPermit,
  registerDingtalkPlatformPermitChecker,
} from './platform-permit.js';
