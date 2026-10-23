/**
 * Plugin-facing contract for tool-free text completion (#804, #877).
 *
 * Lives in core so plugins can import it from the `zhin.js` main entry without installing the
 * optional `@zhin.js/agent`. The agent provides {@link aiCompletionToken} only when an AI host is
 * configured; check with {@link hasResource} (or `context.has?.(token)`) before `use()`.
 */
import { createToken, type Token } from '@zhin.js/plugin-runtime';

/** Who a completion is billed to (`onBehalfOf`). `groupId` is `${platform}:${endpoint}:${sceneId}` in group / channel chats. */
export interface UsageSubject {
  readonly userId: string;
  /** Stable group key (platform + endpoint + group id); undefined in private chats. */
  readonly groupId?: string;
  readonly owner: boolean;
}

/** Original input used to estimate one participant's share of a completion. */
export interface AiCompletionUsageShare {
  readonly subject: UsageSubject;
  readonly text: string;
}

export interface AiCompletionUntrustedInput {
  /** Where the text came from, e.g. `group-chat`; shown to the model as the block's source. */
  readonly source: string;
  readonly text: string;
}

export interface AiCompletionInput {
  /** Required label for logs and usage attribution, e.g. `summarize-chat`. */
  readonly purpose: string;
  /** Trusted instructions written by the plugin. */
  readonly system?: string;
  /** Trusted input written by the plugin. */
  readonly prompt: string;
  /** Untrusted content (group chat, web pages, files); always rendered as data, never as instructions. */
  readonly untrusted?: readonly AiCompletionUntrustedInput[];
  /** Agent binding whose provider / model is used; defaults to `zhin`. */
  readonly agent?: string;
  /** Model id on the binding's provider; defaults to the binding's model. */
  readonly model?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  /** Per-request timeout in ms; defaults to the provider resilience setting. */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /** The IM user (and group) this call is made for; counts against their usage quota. */
  readonly onBehalfOf?: UsageSubject;
  /** Shared attribution, mutually exclusive with onBehalfOf. Denied users must be removed from the prompt before retrying. */
  readonly usageShares?: readonly AiCompletionUsageShare[];
}

/** Token cost breakdown; structurally identical to `@zhin.js/ai` `TokenCost`. */
export interface AiCompletionTokenCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

/** Token usage; structurally identical to `@zhin.js/ai` `TokenUsage` (asserted by agent type tests). */
export interface AiCompletionTokenUsage {
  /** Availability metadata mirrors TokenUsage without importing the optional AI package. */
  reported?: Partial<Record<'input' | 'output' | 'totalTokens' | 'cacheRead' | 'cacheWrite' | 'reasoning', boolean>>;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  reasoning?: number;
  cost: AiCompletionTokenCost;
}

export interface AiCompletionResult {
  readonly text: string;
  /** Model that actually answered (may be a fallback). */
  readonly model: string;
  readonly durationMs: number;
  readonly usage?: AiCompletionTokenUsage;
}

export interface AiCompletion {
  /** Older/custom hosts may omit this; callers must not send shared attribution to such hosts. */
  readonly supportsUsageShares?: true;
  completeText(input: AiCompletionInput): Promise<AiCompletionResult>;
}

/**
 * Generation-owned plain text completion for plugins, provided by `@zhin.js/agent` when an AI host
 * is configured; absent otherwise. Importing it never loads the agent.
 */
export const aiCompletionToken: Token<AiCompletion> = createToken<AiCompletion>(
  'zhin.agent.ai-completion',
  'Tool-free text completion with retry and fallback, for plugins',
);

/** Shape of the agent's `AiCompletionQuotaError`, recognisable without importing `@zhin.js/agent`. */
export interface AiCompletionQuotaErrorLike extends Error {
  readonly name: 'AiCompletionQuotaError';
  readonly scope: 'user' | 'group';
  readonly retryAfterSeconds: number;
  /** Batch preflight rejected these users without starting a provider request or reserving quota. */
  readonly deniedUserIds?: readonly string[];
}

/** True for the agent's quota error (`message` is user-facing); works without importing `@zhin.js/agent`. */
export function isAiCompletionQuotaError(error: unknown): error is AiCompletionQuotaErrorLike {
  return error instanceof Error && error.name === 'AiCompletionQuotaError'
    && ((error as { scope?: unknown }).scope === 'user' || (error as { scope?: unknown }).scope === 'group')
    && typeof (error as { retryAfterSeconds?: unknown }).retryAfterSeconds === 'number';
}

/** Usage quota group key shared by Agent turns and plugin completions. */
export function usageGroupId(platform: string, endpoint: string, sceneId: string): string {
  return `${platform}:${endpoint}:${sceneId}`;
}

/** Minimal structural input: core `Message`, `CommandMessage` and `@zhin.js/testing` fakes all fit. */
export interface UsageSubjectSource {
  readonly conversation: Readonly<{
    endpoint: Readonly<{ adapter: string; id: string }>;
    kind: string;
    id: string;
  }>;
  readonly sender?: Readonly<{ id?: string; roles?: readonly string[] }>;
  readonly clientAdapter?: string;
  readonly endpointId?: string;
}

/**
 * The {@link UsageSubject} for a call made on behalf of a message's sender, with the same rules as
 * Agent turns (so both count against one quota bucket): platform = `clientAdapter` or the endpoint
 * adapter, endpoint = `endpointId` or the endpoint id, `groupId` only in group / channel chats,
 * `owner` when the sender has the `master` role.
 *
 * Returns `undefined` when the message has no sender (e.g. system events); omit `onBehalfOf` then.
 * Throws `TypeError` for a malformed conversation (missing platform / endpoint / id, unknown kind).
 */
export function usageSubjectFromMessage(message: UsageSubjectSource): UsageSubject | undefined {
  const userId = String(message.sender?.id ?? '').trim();
  if (!userId) return undefined;
  const { conversation } = message;
  const kind = conversation.kind;
  if (kind !== 'private' && kind !== 'group' && kind !== 'channel') {
    throw new TypeError(`usageSubjectFromMessage: unsupported conversation kind ${String(kind)}`);
  }
  const platform = String(message.clientAdapter ?? conversation.endpoint.adapter ?? '').trim();
  const endpoint = String(message.endpointId ?? conversation.endpoint.id ?? '').trim();
  const sceneId = String(conversation.id ?? '').trim();
  if (!platform || !endpoint || !sceneId) {
    throw new TypeError('usageSubjectFromMessage: conversation platform, endpoint and id are required');
  }
  return Object.freeze({
    userId,
    ...(kind === 'private' ? {} : { groupId: usageGroupId(platform, endpoint, sceneId) }),
    owner: message.sender?.roles?.includes('master') ?? false,
  });
}

/** Any context that resolves resources: setup `resources` (Scope), capability / construction contexts. */
export interface ResourceReader {
  use<T>(token: Token<T>): T;
  has?(token: Token<unknown>): boolean;
}

/**
 * True when `context.use(token)` would succeed. Uses `context.has` when the context provides it and
 * otherwise probes `use()`, so it also works with older or hand-written contexts.
 */
export function hasResource(context: ResourceReader, token: Token<unknown>): boolean {
  if (typeof context.has === 'function') return context.has(token);
  try {
    context.use(token);
    return true;
  } catch {
    return false;
  }
}
