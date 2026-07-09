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
export type { TurnSessionPrep } from './session-system.js';

export { SessionSystem, createSessionSystem } from './session-system.js';
export {
  CollaborationSessionStrategy,
  SimpleSessionStrategy,
} from './strategies.js';

export {
  buildUserMessageExtra,
  prepareUserContentForSession,
  layerInboundUserTurnBody,
  resolveTurnUserMessage,
  formatUserContentForSession,
  buildSessionCreateInput,
  buildImTranscriptQuery,
  buildHistoryMessagesFromContext,
  resolveSessionIsNewBeforeCreate,
  beginTurnSession,
  touchSession,
  archiveSessionByKey,
} from './session-io.js';

export {
  resolveAgentTurnSessionKey,
  resolveAgentSessionKeyForTurn,
  resolveArtifactRunId,
} from '../collaboration/resolve-agent-session-key.js';

export {
  resolvePassiveGroupSessionKey,
  recordPassiveGroupMessage,
  consumePassiveGroupContextForTurn,
  appendPassiveGroupMessageToContext,
} from './passive-group-session.js';

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
  listSessionTreeForCommMessage,
  jumpSessionTreeForCommMessage,
} from './session-tree-commands.js';

export {
  summarizeAbandonedBranchIfNeeded,
} from './branch-summarization-runtime.js';
export type { BranchSummarizationOptions } from './branch-summarization-runtime.js';
