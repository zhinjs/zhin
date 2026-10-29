/**
 * ADR 0041 §2: render stored `event` messages at the LLM boundary.
 *
 * - consecutive events merge into one message whose lines each start with `[state change]`;
 * - `system` / `developer`: a provider system / developer message at that position;
 * - `none`: a user message headed `[id:…;user_id:system;time:…;]`, merged into an adjacent user
 *   message (previous, else next) as a separate content block so each part keeps its own header;
 * - never between an assistant `tool_calls` message and its tool results: the event moves after
 *   the full group;
 * - append-only: an event is only ever moved later, never before a message already emitted.
 *
 * Pure: the stored history is not touched.
 */
import {
  isEventMessage,
  type AgentMessage,
  type AssistantMessage,
  type EventMessage,
  type UserMessage,
} from '../llm/types/agent-message.js';
import type { MidConversationSystem } from '../llm/mid-conversation-system.js';
import { resolveMidConversationSystem } from '../llm/mid-conversation-system.js';
import type { Model } from '../llm/types/model.js';
import { projectPromptContext } from './prompt-context.js';
import type { MessageAliasTable } from './message-alias.js';
import { formatHeader, SYSTEM_SENDER_ID } from './message-header.js';
import { formatEventClock, STATE_CHANGE_PREFIX } from './event-message.js';

/** A provider-level mid-conversation system / developer message (carried through `AgentMessage`'s custom arm). */
export interface MidConversationSystemMessage {
  role: 'system' | 'developer';
  content: string;
  timestamp: number;
}

export function isMidConversationSystemMessage(message: AgentMessage): message is AgentMessage & MidConversationSystemMessage {
  return (message.role === 'system' || message.role === 'developer')
    && typeof (message as { content?: unknown }).content === 'string';
}

function toolCallIds(message: AssistantMessage): string[] {
  return Array.isArray(message.content)
    ? message.content.flatMap(block => (block.type === 'toolCall' ? [block.id] : []))
    : [];
}

function renderEventText(events: readonly EventMessage[]): string {
  return events.map(event => `${STATE_CHANGE_PREFIX} ${event.name}`).join('\n');
}

function eventId(event: EventMessage): string {
  return typeof event.id === 'string' && event.id ? event.id : String(event.timestamp);
}

function renderGroup(events: readonly EventMessage[], capability: MidConversationSystem): AgentMessage {
  const first = events[0]!;
  const text = renderEventText(events);
  if (capability === 'system' || capability === 'developer') {
    return { role: capability, content: text, timestamp: first.timestamp } satisfies MidConversationSystemMessage;
  }
  const header = formatHeader([['id', eventId(first)], ['user_id', SYSTEM_SENDER_ID], ['time', formatEventClock(first.timestamp)]]);
  return {
    role: 'user',
    content: [{ type: 'text', text: `${header}\n${text}` }],
    timestamp: first.timestamp,
  } satisfies UserMessage;
}

function mergeUser(first: UserMessage, second: UserMessage): UserMessage {
  return { ...second, content: [...first.content, ...second.content], timestamp: first.timestamp };
}

/**
 * @param capability `none` degrades to a `user_id:system` user message; `system` / `developer` emit a
 * provider system / developer message (the bridge sends both as `system`; the OpenAI SDK maps it to
 * `developer` for reasoning models).
 */
export function renderEventsForProvider(messages: AgentMessage[], capability: MidConversationSystem): AgentMessage[] {
  if (!messages.some(isEventMessage)) return messages;
  const out: AgentMessage[] = [];
  let pending: EventMessage[] = [];
  let openCalls = new Set<string>();
  /** The last emitted message is an event-user message that may still absorb the next user message. */
  let eventUserOpen = false;

  const flush = (): void => {
    if (pending.length === 0) return;
    const rendered = renderGroup(pending, capability);
    pending = [];
    const previous = out.at(-1);
    if (capability === 'none' && previous?.role === 'user') {
      out[out.length - 1] = { ...previous, content: [...(previous as UserMessage).content, ...(rendered as UserMessage).content] } as UserMessage;
      eventUserOpen = false;
      return;
    }
    out.push(rendered);
    eventUserOpen = capability === 'none';
  };

  for (const message of messages) {
    if (isEventMessage(message)) {
      pending.push(message);
      continue;
    }
    if (message.role === 'toolResult') {
      const id = (message as { toolCallId?: unknown }).toolCallId;
      if (typeof id === 'string') openCalls.delete(id);
      out.push(message);
      eventUserOpen = false;
      continue;
    }
    if (openCalls.size === 0) flush();
    if (eventUserOpen && message.role === 'user') {
      out[out.length - 1] = mergeUser(out.at(-1) as UserMessage, message as UserMessage);
    } else {
      out.push(message);
    }
    eventUserOpen = false;
    openCalls = message.role === 'assistant' ? new Set(toolCallIds(message as AssistantMessage)) : new Set();
  }
  // Trailing events: after the last complete group (an unanswered tool_calls tail is invalid regardless).
  flush();
  return out;
}

/** The `convertToLlm` of an agent loop: participant/state projection, then event rendering for the model. */
export function createLlmMessageProjection(
  model: Pick<Model, 'sdk' | 'id' | 'baseUrl' | 'compat'>,
  aliases?: MessageAliasTable,
): (messages: AgentMessage[]) => AgentMessage[] {
  const capability = resolveMidConversationSystem(model);
  return messages => {
    // The aliases the model is about to see must resolve when it calls a tool with one.
    aliases?.index(messages);
    return renderEventsForProvider(projectPromptContext(messages), capability);
  };
}
