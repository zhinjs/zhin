import { definePluginStore } from 'zhin.js';
import type { ReminderService } from './service.js';

export const reminderServiceToken = definePluginStore<ReminderService>('zhin.reminder.service', 'Owner-scoped persistent reminders');
