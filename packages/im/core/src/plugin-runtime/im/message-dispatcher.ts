import {
  commandFeatureId,
  isCommandIndex,
  type CommandMatchInput,
  type CommandSegment,
} from '@zhin.js/command';
import type { UserInteractionFactory } from '@zhin.js/interaction';
import { formatCompact, getLogger, truncatePreview } from '@zhin.js/logger';
import type { PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { Message, MessageDispatchResult, SendContent } from './contracts.js';

const logger = getLogger('command');

/**
 * 命令前缀解析器：返回该消息要求的命令前缀。
 * `''` 表示无前缀（任意文本都尝试按命令匹配）。
 */
export type CommandPrefixResolver = (message: Message, snapshot: RuntimeSnapshot) => string;

function ownerOfMessage(message: Message): PluginId {
  return message.conversation.endpoint.adapter as PluginId;
}

/**
 * 默认解析：读消息所属适配器实例 config 的 `commandPrefix`（默认 `''`）；
 * 实例声明 `endpoints` 数组时，按消息 endpoint 名找 entry，`entry.commandPrefix` 覆盖顶层。
 */
export const defaultCommandPrefixResolver: CommandPrefixResolver = (message, snapshot) => {
  const config = snapshot.config.get(ownerOfMessage(message)) as
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
  ): Promise<MessageDispatchResult> {
    const prefix = this.resolvePrefix(message, snapshot);
    let input = message.content.trim();
    if (prefix && !input.startsWith(prefix)) {
      return Object.freeze({ matched: false });
    }
    if (prefix) input = input.slice(prefix.length).trim();
    if (!input) return Object.freeze({ matched: false });
    const commands = snapshot.projections.get(commandFeatureId);
    if (!isCommandIndex(commands)) return Object.freeze({ matched: false });
    const structuredInput = message.segments
      ? stripCommandPrefix(message.segments, prefix)
      : undefined;
    const matchInput = structuredInput ?? input;
    const result = await commands.dispatch(matchInput, message, interactionFactory, prefix);
    if (result.matched && result.value !== undefined) {
      if (!result.owner) throw new Error('Matched Command is missing its owner');
      logger.debug(formatCompact({
        op: 'dispatch_hit',
        command: result.command,
        owner: result.owner,
      }));
      await message.$replyFrom(result.owner, result.value as SendContent);
    } else if (!result.matched) {
      logger.debug(formatCompact({
        op: 'dispatch_miss',
        preview: truncatePreview(input),
      }));
    }
    return result;
  }
}

/**
 * Keep the text and structured views aligned. Falling back to `content` is
 * intentional when an adapter supplies inconsistent segment data.
 */
function stripCommandPrefix(
  segments: readonly Readonly<CommandSegment>[],
  prefix: string,
): CommandMatchInput | undefined {
  let pendingPrefix = prefix;
  let atStart = true;
  const result: CommandSegment[] = [];

  for (const segment of segments) {
    if (!atStart) {
      result.push(segment);
      continue;
    }
    if (segment.type !== 'text' || typeof segment.data.text !== 'string') {
      if (pendingPrefix) return undefined;
      atStart = false;
      result.push(segment);
      continue;
    }

    let text = segment.data.text;
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
  return pendingPrefix ? undefined : result;
}
