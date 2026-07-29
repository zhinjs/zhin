import {
  commandFeatureId,
  isCommandIndex,
  type CommandMatchInput,
  type CommandSegment,
} from '@zhin.js/command';
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
  return String(message.adapter).split('\0')[0] as PluginId;
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
  const endpointName = typeof message.metadata?.endpoint === 'string'
    ? message.metadata.endpoint
    : undefined;
  if (endpointName && Array.isArray(config.endpoints)) {
    const entry = config.endpoints.find((item) =>
      !!item && typeof item === 'object'
      && (item as { name?: unknown }).name === endpointName) as
      | { commandPrefix?: unknown }
      | undefined;
    if (typeof entry?.commandPrefix === 'string') return entry.commandPrefix;
  }
  return typeof config.commandPrefix === 'string' ? config.commandPrefix : '';
};

export class MessageDispatcher {
  constructor(private readonly resolvePrefix: CommandPrefixResolver = defaultCommandPrefixResolver) {}

  async dispatch(message: Message, snapshot: RuntimeSnapshot): Promise<MessageDispatchResult> {
    const prefix = this.resolvePrefix(message, snapshot);
    let input = message.content.trim();
    logger.debug(formatCompact({
      op: 'command_dispatch_start',
      adapter: ownerOfMessage(message),
      endpoint: typeof message.metadata?.endpoint === 'string'
        ? message.metadata.endpoint
        : undefined,
      prefix: prefix || '(none)',
      preview: truncatePreview(input),
      segments: summarizeSegmentTypes(message.segments),
    }));
    if (prefix) {
      if (!input.startsWith(prefix)) {
        logger.debug(formatCompact({
          op: 'command_dispatch_miss',
          reason: 'prefix_miss',
          prefix,
          preview: truncatePreview(input),
        }));
        return Object.freeze({ matched: false });
      }
      input = input.slice(prefix.length).trim();
    }
    if (!input) {
      logger.debug(formatCompact({
        op: 'command_dispatch_miss',
        reason: 'empty_after_prefix',
        prefix: prefix || '(none)',
      }));
      return Object.freeze({ matched: false });
    }
    const commands = snapshot.projections.get(commandFeatureId);
    if (!isCommandIndex(commands)) {
      logger.debug(formatCompact({
        op: 'command_dispatch_miss',
        reason: 'no_command_index',
      }));
      return Object.freeze({ matched: false });
    }
    const structuredInput = message.segments
      ? stripCommandPrefix(message.segments, prefix)
      : undefined;
    if (message.segments && structuredInput === undefined) {
      logger.debug(formatCompact({
        op: 'command_dispatch_fallback_text',
        reason: 'strip_prefix_failed',
        prefix: prefix || '(none)',
        segments: summarizeSegmentTypes(message.segments),
      }));
    }
    const matchInput = structuredInput ?? input;
    logger.debug(formatCompact({
      op: 'command_dispatch_match_input',
      mode: typeof matchInput === 'string' ? 'text' : 'segments',
      preview: typeof matchInput === 'string'
        ? truncatePreview(matchInput)
        : summarizeSegmentTypes(matchInput),
    }));
    const result = await commands.dispatch(matchInput, message);
    if (result.matched && result.value !== undefined) {
      if (!result.owner) throw new Error('Matched Command is missing its owner');
      logger.debug(formatCompact({
        op: 'command_dispatch_hit',
        command: result.command,
        owner: result.owner,
      }));
      await message.$replyFrom(result.owner, result.value as SendContent);
    } else {
      logger.debug(formatCompact({
        op: 'command_dispatch_miss',
        reason: result.matched ? 'empty_value' : 'no_match',
        command: result.command,
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

function summarizeSegmentTypes(
  segments: readonly Readonly<CommandSegment>[] | undefined,
): string | undefined {
  if (!segments?.length) return undefined;
  return segments
    .map((segment) => {
      if (typeof segment.type === 'string') return segment.type;
      if (segment.type && typeof segment.type === 'object' && 'name' in segment.type) {
        return String((segment.type as { name: unknown }).name);
      }
      return '?';
    })
    .join(',');
}
