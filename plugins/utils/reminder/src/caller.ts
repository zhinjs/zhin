import { createDeliveryTarget } from 'zhin.js';
import type { CommandMessage } from '@zhin.js/command';
import { ReminderInputError, type ReminderActor } from './service.js';

export function reminderActor(input: CommandMessage | undefined): ReminderActor {
  if (!input?.sender?.id) throw new ReminderInputError('提醒指令需要真实会话和发送者');
  return { senderId: input.sender.id, target: createDeliveryTarget(input) };
}

export async function replyReminder(operation: () => Promise<string>): Promise<string> {
  try { return await operation(); }
  catch (error) { if (error instanceof ReminderInputError) return error.message; throw error; }
}
