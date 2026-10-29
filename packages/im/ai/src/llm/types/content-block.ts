/** LLM content blocks (ADR 0009 D2). */

/** Runtime-owned, provider-neutral observed state. Null means unknown. */
export interface PromptContextState {
  readonly label: string;
  readonly fields: Readonly<Record<string, string | number | boolean | null | readonly string[]>>;
  readonly observedAt?: number;
  /** Pre-rendered one-line form shown instead of the JSON snapshot (ADR 0041 scene line). */
  readonly line?: string;
}

/**
 * 与 IM canonical MediaRef 结构同构（ai 层独立声明，不引入 IM 概念）。
 * kind=file：平台不透明引用（Telegram file_id 等），序列化时按 provider 能力处理。
 */
export interface MediaBlockRef {
  kind: 'url' | 'path' | 'base64' | 'file';
  value: string;
  mime_type?: string;
  file_name?: string;
  size?: number;
}

export interface TextContentBlock {
  type: 'text';
  text: string;
  /** Runtime-owned participant body inside a mixed context message; never inferred from text or sent to providers. */
  presentation?: 'user-input';
  /** Runtime-injected guidance, persisted verbatim; never inferred from user text.
   * The digest prevents a later text transform from reusing stale provenance.
   * Provider bridges must not serialize this metadata.
   */
  contextRef?: { readonly key: string; readonly digest: string; readonly state?: PromptContextState };
  /**
   * Per-turn runtime context (e.g. who the participants are to the bot): sent to the
   * model for this request only and dropped before the message is stored, so later
   * turns never replay a stale copy. Provider bridges must not serialize this metadata.
   */
  ephemeral?: true;
  /**
   * Gemini 3 may sign a text part (`google.thoughtSignature`); it is sent back with
   * the text on the next request. Only set on assistant text.
   */
  providerOptions?: ToolCallProviderOptions;
}

/**
 * 媒体内容块：与 canonical Segment（image/audio/video/file）子集同构，
 * agent 层透传零转换。用户消息的媒体经 `UserMessage.media` 承载（不持久化）。
 */
export interface MediaContentBlock {
  type: 'image' | 'audio' | 'video' | 'file';
  data: {
    media: MediaBlockRef;
    alt?: string;
  };
}

/**
 * Anthropic / MiniMax（Anthropic 兼容）thinking 回传所需的签名元数据。
 * 无 signature / redactedData 时不得作为 `reasoning` 再发给模型（否则 AI SDK 刷
 * `unsupported reasoning metadata`，且内容会被静默丢弃）。
 */
export interface AnthropicThinkingProviderOptions {
  readonly anthropic?: {
    readonly signature?: string;
    readonly redactedData?: string;
  };
}

/** Thinking-block signatures: Anthropic `signature`/`redactedData`, Gemini `thoughtSignature`. */
export interface ThinkingProviderOptions extends AnthropicThinkingProviderOptions {
  readonly google?: { readonly thoughtSignature?: string };
  readonly vertex?: { readonly thoughtSignature?: string };
}

export interface ThinkingContentBlock {
  type: 'thinking';
  thinking: string;
  /** AI SDK providerOptions: round-trips signed thinking (Anthropic protocol, Gemini thought parts). */
  providerOptions?: ThinkingProviderOptions;
}

export interface ToolCallContentBlock {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /**
   * Set when the model's arguments were not a JSON object; `arguments` is then `{}`.
   * Tool validation quotes `raw` back to the model so it can resend a valid call.
   */
  inputError?: ToolCallInputError;
  /**
   * Provider metadata that must be sent back with this call on the next request.
   * Gemini 3 signs function calls (`google.thoughtSignature`); dropping the
   * signature degrades multi-step tool use, so it round-trips with the history.
   */
  providerOptions?: ToolCallProviderOptions;
}

/** Arguments the model sent that could not be used, with the parse error. */
export interface ToolCallInputError {
  /** The text exactly as the model sent it. */
  raw: string;
  message: string;
}

/** Signed-call metadata keyed by AI SDK provider id (only `google` / `vertex` today). */
export type ToolCallProviderOptions = Record<string, { thoughtSignature?: string }>;

export type ContentBlock =
  | TextContentBlock
  | MediaContentBlock
  | ThinkingContentBlock
  | ToolCallContentBlock;

export type UserContentBlock = TextContentBlock;

export type ToolResultContentBlock = TextContentBlock | MediaContentBlock;

const MEDIA_BLOCK_TYPES = new Set(['image', 'audio', 'video', 'file']);

export function isMediaBlockRef(value: unknown): value is MediaBlockRef {
  if (!value || typeof value !== 'object') return false;
  const ref = value as Partial<MediaBlockRef>;
  return (ref.kind === 'url' || ref.kind === 'path' || ref.kind === 'base64' || ref.kind === 'file')
    && typeof ref.value === 'string'
    && ref.value.length > 0;
}

export function isMediaContentBlock(value: unknown): value is MediaContentBlock {
  if (!value || typeof value !== 'object') return false;
  const block = value as { type?: unknown; data?: unknown };
  if (typeof block.type !== 'string' || !MEDIA_BLOCK_TYPES.has(block.type)) return false;
  const data = block.data as { media?: unknown } | undefined;
  return !!data && isMediaBlockRef(data.media);
}
