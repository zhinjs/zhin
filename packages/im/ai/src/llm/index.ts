export type {
  TextContentBlock,
  ImageContentBlock,
  ThinkingContentBlock,
  ToolCallContentBlock,
  ContentBlock,
  UserContentBlock,
  ToolResultContentBlock,
  ImageContent,
} from './types/content-block.js';

export type { TokenUsage } from './types/agent-message.js';
export type {
  AgentMessage,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  CustomAgentMessage,
  AssistantStopReason,
  TokenCost,
} from './types/agent-message.js';
export {
  EMPTY_TOKEN_USAGE,
  isLlmAgentMessage,
  createUserMessage,
} from './types/agent-message.js';

export type {
  Model,
  ModelApi,
  ModelInputModality,
  ModelCostRates,
  OpenAiCompatFlags,
  ProviderInstanceConfig,
} from './types/model.js';

export type { Context } from './types/context.js';
export { createContext } from './types/context.js';

export type { LlmTool, ParsedToolCall } from './types/tool.js';

export type {
  AgentEvent,
  AgentMessageDelta,
  ThinkingLevel,
  ToolExecutionMode,
} from './types/agent-event.js';

export type { QueueMode } from './types/queue-mode.js';
export { DEFAULT_STEERING_MODE, DEFAULT_FOLLOW_UP_MODE } from './types/queue-mode.js';

export {
  registerApiProvider,
  registerProviderInstance,
  getApiProvider,
  getProviderConfig,
  getModel,
  stream,
  complete,
  streamSimple,
  completeSimple,
  createAssistantMessageEventStream,
  clearApiRegistryForTests,
} from './api-registry.js';
export type {
  StreamOptions,
  StreamFn,
  StreamSimpleFn,
  ApiProviderRegistration,
  AssistantStreamEvent,
  AssistantMessageEventStream,
  RegisteredProvider,
} from './api-registry.js';

export {
  validateToolCall,
  toolCallFromContentBlock,
  stringParamTool,
  ToolCallValidationError,
  Type,
  Value,
} from './validate-tool-call.js';

export { agentLoop, agentContextFrom } from './agent-loop.js';
export type {
  AgentLoopConfig,
  AgentContext,
  BeforeToolCallContext,
  BeforeToolCallResult,
  AfterToolCallContext,
} from './agent-loop.js';

export {
  agentMessagesToOpenAi,
  contextToChatCompletionRequest,
  chatCompletionToAssistantMessage,
  assistantText,
} from './convert/openai-bridge.js';

export {
  createOpenAiCompletionsStreamFn,
  driverToModelApi,
  OPENAI_COMPAT_APIS,
} from './providers/openai-completions.js';

export {
  registerLlmApiFromProviders,
  resetLlmApiRegistryForTests,
  setLegacyProviderResolver,
} from './register-api-layer.js';
export type { LegacyProviderEntry } from './register-api-layer.js';

export {
  convertLegacyTool,
  convertLegacyTools,
} from './legacy-tool-bridge.js';

export { formatRedactedJson, redactValueForLog } from './redact-request-body.js';
