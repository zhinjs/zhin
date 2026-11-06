import { definePluginStore } from 'zhin.js';
import type { ReminderService } from './service.js';

export const reminderServiceStore = definePluginStore<ReminderService>('zhin.reminder.service', 'Owner-scoped persistent reminders');
export const reminderServiceToken = reminderServiceStore;
