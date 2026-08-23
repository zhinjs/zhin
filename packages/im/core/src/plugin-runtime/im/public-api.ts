/**
 * Public IM gateway contract exposed from `zhin.js/core/runtime`.
 * @module zhin.js/core/runtime
 */
export { messageGatewayToken } from './im-runtime.js';
export {
  Message,
  type ComponentCall,
  type ConversationAddress,
  type IncomingContext,
  type IncomingMessage,
  type MessageDispatchResult,
  type MessageGateway,
  type MessageSenderRef,
  type OutboundEnvelope,
  type RawContent,
  type SendContent,
  type SendRequest,
} from './contracts.js';
