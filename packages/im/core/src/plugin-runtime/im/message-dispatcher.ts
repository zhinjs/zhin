import { commandFeatureId, isCommandIndex } from '@zhin.js/command';
import type { PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { Message, MessageDispatchResult, SendContent } from './contracts.js';

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
    if (prefix) {
      if (!input.startsWith(prefix)) return Object.freeze({ matched: false });
      input = input.slice(prefix.length).trim();
    }
    if (!input) return Object.freeze({ matched: false });
    const commands = snapshot.projections.get(commandFeatureId);
    if (!isCommandIndex(commands)) return Object.freeze({ matched: false });
    const result = await commands.dispatch(input, message);
    if (result.matched && result.value !== undefined) {
      if (!result.owner) throw new Error('Matched Command is missing its owner');
      await message.$replyFrom(result.owner, result.value as SendContent);
    }
    return result;
  }
}
