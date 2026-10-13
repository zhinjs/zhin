import { createToken } from 'zhin.js';
import type { ReminderService } from './service.js';

export const reminderServiceToken = createToken<ReminderService>('zhin.reminder.service', 'Owner-scoped persistent reminders');
