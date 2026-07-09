/**
 * Context System — builder/injector 链 + turn 上下文构建。
 */

export type {
  BuildContext,
  InjectContext,
  ContextBuilder,
  ContextInjector,
  ContextSystemConfig,
} from './contracts.js';

export type { TurnEnvelopeParts } from './envelope-parts.js';
export type { TextTurnContextInput, TextTurnContextOutput } from './context-system.js';
export type { TurnContextEnvelopeInput } from './turn-envelope.js';
export type { AgentsInstructionEntry } from './agents-instruction.js';
export type { ModelResolverConfig } from './model-resolver.js';

export {
  ContextSystem,
  createContextSystemForHost,
  ProfileContextBuilder,
  ToneInjector,
  CollaborationContextBuilder,
  createDefaultContextBuilders,
} from './context-system.js';

export {
  buildTurnContextEnvelope,
  prependTurnContextEnvelope,
  formatSessionContextLine,
  resolveQuoteSystemHint,
  TURN_CONTEXT_BEGIN,
  TURN_CONTEXT_END,
} from './turn-envelope.js';

export {
  buildTurnUserMessages,
  applyTurnContextToUserMessages,
  prependEnvelopeToFirstUserText,
} from './turn-user-message.js';

export {
  buildAgentsEnvelopeContext,
  collectAgentsInstructionChain,
  clearAgentsInstructionCache,
} from './agents-instruction.js';

export { resolveModel, resolveModelCandidates } from './model-resolver.js';

export {
  DEFAULT_CONTEXT_TAIL_MESSAGE_LIMIT,
  COLLABORATION_CONTEXT_TAIL_MESSAGE_LIMIT,
  resolveContextTailMessageLimit,
} from './context-tail-limit.js';
