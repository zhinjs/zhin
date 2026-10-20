/**
 * Re-export agent stream wire format from @zhin.js/ai (SSOT for ADR 0039 P0).
 */
export {
  ZHIN_SESSION_ID_HEADER,
  AGENT_STREAM_MEDIA_TYPE,
  ZHIN_AGENT_SESSION_API_PREFIX,
  AgentStreamEventType,
  formatAgentStreamNdjsonLine,
  createAgentStreamReduceState,
  reduceAgentStreamEvent,
} from "@zhin.js/ai/agent-stream";
export {
  createAgentStreamNdjsonParserState,
  parseAgentStreamNdjsonChunk,
  flushAgentStreamNdjsonParser,
  iterateAgentStreamNdjson,
  foldAgentStreamNdjson,
} from "@zhin.js/ai/agent-stream-consumer";
export type {
  AgentStreamEvent,
  AgentStreamEventTypeName,
  StartAgentSessionResponse,
  ContinueAgentSessionBody,
  ContinueAgentSessionResponse,
  AgentStreamReduceState,
  AgentStreamPendingInput,
  AgentStreamPendingAuthorization,
} from "@zhin.js/ai/agent-stream";
export type {
  AgentStreamNdjsonParserState,
  FoldAgentStreamOptions,
} from "@zhin.js/ai/agent-stream-consumer";
