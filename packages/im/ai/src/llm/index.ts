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
export { repairAgentMessagesForLlm } from './repair-agent-messages.js';

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
  setLiveModelsResolver,
  setLegacyProviderResolver,
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
  z,
} from './validate-tool-call.js';

export { agentLoop, agentContextFrom } from './agent-loop.js';
export { isTieredParallelTool, TIERED_PARALLEL_TOOL_NAMES } from './tiered-tool-buckets.js';
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
  ensureLanguageModelRegistered,
} from './register-api-layer.js';
export type { SdkProviderEntry, LegacyProviderEntry } from './register-api-layer.js';

export {
  convertLegacyTool,
  convertLegacyTools,
} from './legacy-tool-bridge.js';

export { formatRedactedJson, redactValueForLog } from './redact-request-body.js';

export {
  SDK_IDS,
  isSdkId,
  createLanguageModel,
  sdkSupportsImageGeneration,
} from './sdk-registry.js';
export type { SdkId } from './sdk-registry.js';

export {
  SDK_DEFAULT_MODELS,
  ANYROUTER_ANTHROPIC_MODELS,
  SDK_SUPPORTS_OPENAI_MODEL_DISCOVERY,
  resolveSdkProviderModels,
  sdkHasStaticModelPreset,
} from './sdk-default-models.js';

export { createSdkProviderAdapter, SdkProviderAdapter, sdkEntryFromProvider } from '../sdk-provider-adapter.js';

export {
  agentMessagesToAiSdk,
  contextToAiSdkPrompt,
  llmToolsToAiSdk,
} from './bridge/ai-sdk-messages.js';

export { createAiSdkStreamFn, generateTextViaAiSdk } from './bridge/ai-sdk-stream.js';
export {
  buildPromptCacheKey,
  supportsPromptCacheSdk,
  isStreamPromptCacheEnabled,
  type PromptCacheRetention,
} from './bridge/ai-sdk-prompt-cache.js';
export { generateImageViaAiSdk } from './bridge/ai-sdk-image.js';
