/**
 * IM ask_user adapter for SessionInteractionPort (ADR 0041).
 */
import type { Message, Plugin } from '@zhin.js/core';
import { AskUserBuiltinTool } from '../builtin/ask-user-tool.js';
import type { ApprovalRequestInput, SessionInteractionPort } from './session-interaction-port.js';

export class ImApprovalAdapter implements SessionInteractionPort {
  constructor(
    private readonly plugin: Plugin | undefined,
    private readonly commMessage: Message,
  ) {}

  async requestApproval(input: ApprovalRequestInput): Promise<boolean> {
    if (!this.plugin) {
      throw new Error('approval required but Host plugin is unavailable');
    }
    const askTool = new AskUserBuiltinTool(this.plugin);
    const raw = await askTool.run(
      {
        question: input.question,
        type: 'confirm',
        timeout: input.timeoutMs ?? 120,
        sensitive: true,
      },
      this.commMessage,
    );
    const answer = typeof raw === 'string' ? raw.trim().toLowerCase() : String(raw);
    return answer === 'yes';
  }
}
