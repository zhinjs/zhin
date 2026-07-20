/**
 * Group-suite table schemas for DatabaseHost / legacy DatabaseFeature.
 */
import {
  CHECKIN_TABLE,
  TEACH_TABLE,
  STATS_TABLE,
} from './memory-store.js';

export function defineGroupSuiteTables(
  db: { define: (name: string, schema: Record<string, unknown>) => void },
): void {
  db.define(CHECKIN_TABLE, {
    user_id: { type: 'text', nullable: false },
    user_name: { type: 'text', default: '' },
    points: { type: 'integer', default: 0 },
    total_checkins: { type: 'integer', default: 0 },
    streak: { type: 'integer', default: 0 },
    max_streak: { type: 'integer', default: 0 },
    last_checkin: { type: 'text', default: '' },
    context_type: { type: 'text', default: 'global' },
    context_id: { type: 'text', default: '' },
    created_at: { type: 'text', default: '' },
    updated_at: { type: 'text', default: '' },
  });
  db.define(TEACH_TABLE, {
    question: { type: 'text', nullable: false },
    answer: { type: 'text', nullable: false },
    is_regex: { type: 'integer', default: 0 },
    context_type: { type: 'text', default: 'global' },
    context_id: { type: 'text', default: '' },
    creator_id: { type: 'text', default: '' },
    creator_name: { type: 'text', default: '' },
    hit_count: { type: 'integer', default: 0 },
    created_at: { type: 'text', default: '' },
    updated_at: { type: 'text', default: '' },
  });
  db.define(STATS_TABLE, {
    user_id: { type: 'text', nullable: false },
    user_name: { type: 'text', default: '' },
    group_id: { type: 'text', default: '' },
    date: { type: 'text', nullable: false },
    count: { type: 'integer', default: 0 },
    updated_at: { type: 'text', default: '' },
  });
}
