import type { PluginId } from '@zhin.js/plugin-runtime';
import type { ConversationRef } from '@zhin.js/im-contract';
import type { MessageSenderRef } from './contracts.js';

/** Bounded message projection for runtime observers such as Console and Inbox. */
export interface RuntimeMessageEvent {
  readonly direction: 'inbound' | 'outbound';
  readonly conversation: ConversationRef;
  readonly sender?: MessageSenderRef;
  readonly requester?: PluginId;
  readonly contentPreview: string;
  readonly messageId?: string;
  readonly timestamp: number;
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

function flattenContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  if (Array.isArray(content)) return content.map((item) => flattenContent(item)).join('');
  if (typeof content === 'object') {
    const record = content as Record<string, unknown>;
    const data = record.data as Record<string, unknown> | undefined;
    if (typeof record.type === 'string') {
      if (data && typeof data.text === 'string') return data.text;
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
