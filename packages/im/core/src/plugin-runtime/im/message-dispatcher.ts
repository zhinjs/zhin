import { commandFeatureId, isCommandIndex } from '@zhin.js/command';
import type { RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { Message, MessageDispatchResult, SendContent } from './contracts.js';

export class MessageDispatcher {
  constructor(private readonly prefix = '/') {
    if (!prefix) throw new TypeError('Command prefix cannot be empty');
  }

  async dispatch(message: Message, snapshot: RuntimeSnapshot): Promise<MessageDispatchResult> {
    if (!message.content.startsWith(this.prefix)) return Object.freeze({ matched: false });
    const input = message.content.slice(this.prefix.length).trim();
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
