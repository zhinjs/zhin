import { adapterFeatureId, isAdapterIndex } from '@zhin.js/adapter';
import {
  commandFeatureId,
  isCommandIndex,
  type CommandMatchInput,
  type CommandSegment,
} from '@zhin.js/command';
import type { UserInteractionFactory } from '@zhin.js/interaction';
import { formatCompact, getLogger, truncatePreview } from '@zhin.js/logger';
import type { CapabilityId, PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { Message, MessageDispatchResult, SendContent } from './contracts.js';
import { renderCommandFeedback } from './command-feedback.js';
import { commandMenuReply } from './command-menu-navigation.js';

const logger = getLogger('command');

/**
 * 命令前缀解析器：返回该消息要求的命令前缀。
 * `''` 表示无前缀（任意文本都尝试按命令匹配）。
 */
export type CommandPrefixResolver = (message: Message, snapshot: RuntimeSnapshot) => string;

/** @internal Keep command facts separate from the author of the rendered reply. */
export interface MessageDispatchOutcome {
  readonly dispatch: MessageDispatchResult;
  readonly reply?: { readonly owner: PluginId; readonly content: SendContent };
}

function dispatchOutcome(result: MessageDispatchResult, replyOwner = result.owner): MessageDispatchOutcome {
  return { dispatch: result, ...(result.value !== undefined && replyOwner
    ? { reply: { owner: replyOwner, content: result.value as SendContent } } : {}) };
}

function ownerOfMessage(message: Message, snapshot: RuntimeSnapshot): PluginId | undefined {
  // adapter is a platform literal (e.g. terminal), not the Plugin owner.
  const slot = snapshot.capabilities.get(message.conversation.endpoint.id as CapabilityId);
  if (slot) return slot.owner;
  // Expanded endpoint records have identities distinct from their source slot.
  // Resolve their ownership through the generation's canonical AdapterIndex.
  const adapters = snapshot.projections.get(adapterFeatureId);
  if (!isAdapterIndex(adapters)) return undefined;
  try { return adapters.owner(message.conversation.endpoint.id as CapabilityId); } catch { return undefined; }
}

/**
 * 默认解析：读消息所属适配器实例 config 的 `commandPrefix`（默认 `''`）；
 * 实例声明 `endpoints` 数组时，按消息 endpoint 名找 entry，`entry.commandPrefix` 覆盖顶层。
 */
export const defaultCommandPrefixResolver: CommandPrefixResolver = (message, snapshot) => {
  const owner = ownerOfMessage(message, snapshot);
  const config = (owner ? snapshot.config.get(owner) : undefined) as
    | { commandPrefix?: unknown; endpoints?: unknown }
    | undefined;
  if (!config) return '';
  const endpointId = message.endpointId;
  if (endpointId && Array.isArray(config.endpoints)) {
    const entry = config.endpoints.find((item) =>
      !!item && typeof item === 'object'
      && (item as { id?: unknown }).id === endpointId) as
      | { commandPrefix?: unknown }
      | undefined;
    if (typeof entry?.commandPrefix === 'string') return entry.commandPrefix;
  }
  return typeof config.commandPrefix === 'string' ? config.commandPrefix : '';
};

export class MessageDispatcher {
  constructor(private readonly resolvePrefix: CommandPrefixResolver = defaultCommandPrefixResolver) {}

  async dispatch(
    message: Message,
    snapshot: RuntimeSnapshot,
    interactionFactory?: UserInteractionFactory,
    observe?: (stage: 'prefix' | 'dispatch', status: 'mismatch' | 'matched' | 'empty_input' | 'commands_unavailable' | 'started') => void,
  ): Promise<MessageDispatchResult> {
    return (await this.dispatchWithReply(message, snapshot, interactionFactory, observe)).dispatch;
  }

  /** @internal The inbound runtime retains reply authorship without changing command facts. */
  async dispatchWithReply(
    message: Message,
    snapshot: RuntimeSnapshot,
    interactionFactory?: UserInteractionFactory,
    observe?: (stage: 'prefix' | 'dispatch', status: 'mismatch' | 'matched' | 'empty_input' | 'commands_unavailable' | 'started') => void,
  ): Promise<MessageDispatchOutcome> {
    const note = (stage: 'prefix' | 'dispatch', status: 'mismatch' | 'matched' | 'empty_input' | 'commands_unavailable' | 'started') => {
      try { observe?.(stage, status); } catch { /* Observation never controls dispatch. */ }
    };
    const prefix = this.resolvePrefix(message, snapshot);
    let input = message.content.trim();
    if (prefix && !input.startsWith(prefix)) {
      note('prefix', 'mismatch');
      return dispatchOutcome(Object.freeze({ matched: false }));
    }
    note('prefix', 'matched');
    if (prefix) input = input.slice(prefix.length).trim();
    if (!input) {
      note('dispatch', 'empty_input');
      return dispatchOutcome(Object.freeze({ matched: false }));
    }
    const commands = snapshot.projections.get(commandFeatureId);
    if (!isCommandIndex(commands)) {
      note('dispatch', 'commands_unavailable');
      return dispatchOutcome(Object.freeze({ matched: false }));
    }
    const structuredInput = message.segments
      ? stripCommandPrefix(message.segments, prefix)
      : undefined;
    const matchInput = structuredInput ?? input;
    note('dispatch', 'started');
    const result = await commands.dispatch(matchInput, message, interactionFactory, prefix, snapshot);
    const feedback = await renderCommandFeedback(result, message, snapshot);
    if (feedback) return dispatchOutcome(Object.freeze({ ...result, value: feedback.content }), feedback.owner);
    if (result.matched && result.value !== undefined) {
      if (!result.owner) throw new Error('Matched Command is missing its owner');
      logger.debug(formatCompact({
        op: 'dispatch_hit',
        command: result.command,
        owner: result.owner,
      }));
    } else if (!result.matched) {
      logger.debug(formatCompact({
        op: 'dispatch_miss',
        preview: truncatePreview(input),
      }));
    }
    return dispatchOutcome(result.menu ? Object.freeze({ ...result,
      value: await commandMenuReply(result, commands, snapshot, message.conversation, prefix),
    }) : result);
  }
}

/**
 * Keep the text and structured views aligned. Falling back to `content` is
 * intentional when an adapter supplies inconsistent segment data.
 *
 * Platforms put a quote (`reply`) segment before the text ("quote a message, then type the
 * command"). Leading quotes are moved after the command text so the command name still
 * matches and a `reply` parameter can still read the quote; `message.replyTo` is untouched.
 */
function stripCommandPrefix(
  segments: readonly Readonly<CommandSegment>[],
  prefix: string,
): CommandMatchInput | undefined {
  let pendingPrefix = prefix;
  let atStart = true;
  let trimLeading = true;
  const result: CommandSegment[] = [];
  const leadingQuotes: CommandSegment[] = [];

  for (const segment of segments) {
    if (!atStart) {
      result.push(segment);
      continue;
    }
    if (segment.type === 'reply') {
      leadingQuotes.push(segment);
      continue;
    }
    if (segment.type !== 'text' || typeof segment.data.text !== 'string') {
      if (pendingPrefix) return undefined;
      atStart = false;
      result.push(segment);
      continue;
    }

    let text = segment.data.text;
    // Match the leading whitespace normalization of message.content without
    // discarding structured arguments when the prefix follows whitespace.
    if (trimLeading) {
      text = text.trimStart();
      if (text) trimLeading = false;
    }
    if (pendingPrefix) {
      if (text.startsWith(pendingPrefix)) {
        text = text.slice(pendingPrefix.length);
        pendingPrefix = '';
      } else if (pendingPrefix.startsWith(text)) {
        pendingPrefix = pendingPrefix.slice(text.length);
        continue;
      } else {
        return undefined;
      }
    }
    text = text.trimStart();
    if (!text) continue;
    atStart = false;
    result.push({ ...segment, data: { ...segment.data, text } });
  }
  return pendingPrefix ? undefined : [...result, ...leadingQuotes];
}
