/**
 * Session System — SessionSystem + 策略 + session-io（契约见 contracts.ts）。
 */

export type {
  Session,
  CreateSessionInput,
  SessionStore,
  SessionStrategy,
  SessionSystemConfig,
} from './contracts.js';

export type { SessionIODeps } from './session-io.js';
export type { IngressTurnSessionPrep, TurnSessionPrep } from './session-system.js';

export { SessionSystem, createSessionSystem } from './session-system.js';
export {
  GroupSessionStrategy,
  SimpleSessionStrategy,
} from './strategies.js';

export {
  buildUserMessageExtra,
  prepareUserContentForSession,
  layerInboundUserTurnBody,
  resolveTurnUserMessage,
  formatUserContentForSession,
  buildAgentSessionCreateInput,
  buildHistoryMessagesFromContext,
  resolveSessionIsNewBeforeCreate,
  beginTurnSession,
  touchSession,
  archiveSessionByKey,
} from './session-io.js';

export {
  resolveAgentTurnSessionKey,
} from './session-key.js';

export {
  recordPassiveGroupObservation,
  consumePassiveGroupContextForTurn,
} from './passive-group-session.js';
export type { PassiveGroupObservation } from './passive-group-session.js';

export {
  pushPassiveGroupLine,
  drainPassiveGroupBuffer,
  peekPassiveGroupBuffer,
  formatPassiveGroupContextBlock,
  prunePassiveLines,
  MAX_PASSIVE_LINES,
  PASSIVE_TTL_MS,
} from './passive-group-buffer.js';
export type { PassiveGroupLine } from './passive-group-buffer.js';

export {
  listSessionTree,
  jumpSessionTree,
} from './session-tree-commands.js';

export {
  summarizeAbandonedBranchIfNeeded,
} from './branch-summarization-runtime.js';
export type { BranchSummarizationOptions } from './branch-summarization-runtime.js';
export {
  beginIngressTurnSession,
  buildTurnSessionCreateInput,
  layerIngressUserBody,
  resolveIngressUserMessage,
} from './turn-ingress-session.js';
export type { ResolvedIngressUserMessage } from './turn-ingress-session.js';
