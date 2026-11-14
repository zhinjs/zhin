import { EventEmitter } from 'node:events';
import { isJsxElement, type JSXElement } from '@zhin.js/jsx';
import { createToken, type PluginId } from '@zhin.js/plugin-runtime';
import type { ConversationRef, DeliveryReceipt } from '@zhin.js/im-contract';
import type { Message, MessageSenderRef, OutboundEnvelope, SendContent } from './contracts.js';

export interface EndpointEvent {
  readonly adapter: string;
  readonly endpointKey: string;
  readonly error?: Error;
}

export interface MessageBusEventMap {
  'message.receive': [message: Message];
  'before.sendMessage': [envelope: OutboundEnvelope];
  'message.send': [payload: { adapter: string; endpointKey: string; content: SendContent; receipt: DeliveryReceipt }];
  'endpoint.connect': [event: EndpointEvent];
  'endpoint.disconnect': [event: EndpointEvent];
  'endpoint.error': [event: EndpointEvent];
}

export type MessageBusEventName = keyof MessageBusEventMap;

export class MessageBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  on<E extends MessageBusEventName>(
    event: E,
    listener: (...args: MessageBusEventMap[E]) => void,
  ): () => void {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return () => this.emitter.off(event, listener as (...args: unknown[]) => void);
  }

  once<E extends MessageBusEventName>(
    event: E,
    listener: (...args: MessageBusEventMap[E]) => void,
  ): () => void {
    this.emitter.once(event, listener as (...args: unknown[]) => void);
    return () => this.emitter.off(event, listener as (...args: unknown[]) => void);
  }

  emit<E extends MessageBusEventName>(
    event: E,
    ...args: MessageBusEventMap[E]
  ): void {
    this.emitter.emit(event, ...args);
  }

  off<E extends MessageBusEventName>(
    event: E,
    listener: (...args: MessageBusEventMap[E]) => void,
  ): void {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
  }

  listenerCount(event: MessageBusEventName): number {
    return this.emitter.listenerCount(event);
  }

  removeAllListeners(event?: MessageBusEventName): void {
    if (event) {
      this.emitter.removeAllListeners(event);
    } else {
      this.emitter.removeAllListeners();
    }
  }
}

export const messageBusToken = createToken<MessageBus>('zhin.im.message-bus');

export type OutboundFallbackReason = 'renderer_unavailable' | 'renderer_failed' | 'media_unsupported'
  | 'html_text_policy' | 'markdown_text_policy' | 'interactive_text_policy';

/** Final payload handed to the Endpoint, not a claim about the remote client's display. */
export interface RuntimeMessageRendering {
  readonly forms: readonly ('text' | 'image' | 'native')[];
  readonly fallbacks: readonly OutboundFallbackReason[];
}

/** Bounded message projection for runtime observers such as Console and Inbox. */
export interface RuntimeMessageEvent {
  readonly direction: 'inbound' | 'outbound';
  readonly conversation: ConversationRef;
  readonly sender?: MessageSenderRef;
  readonly requester?: PluginId;
  readonly contentPreview: string;
  readonly messageId?: string;
  readonly timestamp: number;
  readonly rendering?: RuntimeMessageRendering;
}

export interface RuntimeMessageEventSource {
  subscribe(listener: (event: RuntimeMessageEvent) => void): () => void;
}

const messagePreviewLimit = 200;

/** Owns one ImRuntime's observer subscriptions without exposing publication authority. */
export class RuntimeMessageEventStream implements RuntimeMessageEventSource {
  readonly #listeners = new Set<(event: RuntimeMessageEvent) => void>();

  subscribe(listener: (event: RuntimeMessageEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  publish(event: RuntimeMessageEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // Observers never participate in message delivery success or failure.
      }
    }
  }
}

/**
 * #996: a social/scene fact just landed in `conversation_events` (notice or join request).
 * Observers (the Agent's scene-event wake) decide priority themselves; no raw platform payload.
 */
export interface RuntimeSceneEventSignal {
  readonly sequence: number;
  readonly event: import('@zhin.js/im-contract').ConversationEvent;
  /** Live endpoint key of the receiving bot account. */
  readonly endpointId?: string;
  /** Bot account candidates (endpoint key, platform self id) for "is the target the bot". */
  readonly selfIds: readonly string[];
}

export interface RuntimeSceneEventSource {
  subscribe(listener: (signal: RuntimeSceneEventSignal) => void): () => void;
}

export class RuntimeSceneEventStream implements RuntimeSceneEventSource {
  readonly #listeners = new Set<(signal: RuntimeSceneEventSignal) => void>();

  subscribe(listener: (signal: RuntimeSceneEventSignal) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  publish(signal: RuntimeSceneEventSignal): void {
    for (const listener of this.#listeners) {
      try {
        listener(signal);
      } catch {
        // Observers never participate in ingress success or failure.
      }
    }
  }
}

/** Log-safe structured conversation summary. */
export function formatConversationLog(conversation: ConversationRef): string {
  const base = `${conversation.kind}:${conversation.id}`;
  const parent = conversation.parent
    ? `@${conversation.parent.kind}:${conversation.parent.id}`
    : '';
  const thread = conversation.threadId ? `#${conversation.threadId}` : '';
  return `${base}${parent}${thread}`;
}

/** Content projection bounded for observer and log surfaces. */
export function previewMessageContent(content: unknown): string {
  const text = flattenContent(content);
  return text.length > messagePreviewLimit
    ? `${text.slice(0, messagePreviewLimit)}…`
    : text;
}

/**
 * Flattens any SendContent-like value to display text; non-text segments become `[type]`.
 * Markdown keeps its source text, buttons (keyboard rows and JSX `<button>`) become `[label]`, and
 * unrendered JSX is read through its children, never serialized as an object.
 */
export function flattenContent(content: unknown): string {
  return flattenNode(content, 0);
}

const MAX_FLATTEN_DEPTH = 32;

function flattenNode(content: unknown, depth: number): string {
  if (typeof content === 'string') return content;
  if (content == null || typeof content === 'boolean') return '';
  if (typeof content === 'number' || typeof content === 'bigint') return String(content);
  if (depth > MAX_FLATTEN_DEPTH) return '';
  if (Array.isArray(content)) return content.map((item) => flattenNode(item, depth + 1)).join('');
  if (isJsxElement(content)) return flattenJsx(content, depth);
  if (typeof content === 'object') {
    const record = content as Record<string, unknown>;
    const data = record.data as Record<string, unknown> | undefined;
    if (typeof record.type === 'string') {
      if (data && typeof data.text === 'string') return data.text;
      if (record.type === 'markdown' && data && typeof data.content === 'string') return data.content;
      if (record.type === 'keyboard' && data && Array.isArray(data.rows)) {
        const labels = data.rows.flatMap(row => Array.isArray(row) ? row : [])
          .map(button => button && typeof button === 'object' ? (button as { label?: unknown }).label : undefined)
          .filter((label): label is string => typeof label === 'string' && label.length > 0);
        if (labels.length) return labels.map(label => `[${label}]`).join('');
      }
      return `[${record.type}]`;
    }
    if (typeof record.text === 'string') return record.text;
    try {
      return JSON.stringify(content) ?? '';
    } catch {
      return String(content);
    }
  }
  return String(content);
}

function flattenJsx(element: JSXElement, depth: number): string {
  const props = element.props as Readonly<Record<string, unknown>>;
  if (element.type === 'button') {
    const label = typeof props.label === 'string' ? props.label : flattenNode(props.children, depth + 1);
    return label ? `[${label}]` : '';
  }
  // Explicit text fallbacks (e.g. <html text="…">) describe the element better than its markup.
  if (typeof props.text === 'string') return props.text;
  return flattenNode(props.children, depth + 1);
}
