import { definePluginStore } from 'zhin.js';
import type { ModerationEngine } from './engine.js';

export const moderationEngineStore = definePluginStore<ModerationEngine>(
  'zhin.content-moderation.engine',
  'Owner-scoped content moderation engine',
);
export const moderationEngineToken = moderationEngineStore;
