import { createToken } from 'zhin.js';
import type { ModerationEngine } from './engine.js';

export const moderationEngineToken = createToken<ModerationEngine>(
  'zhin.content-moderation.engine',
  'Owner-scoped content moderation engine',
);
