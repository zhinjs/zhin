import { ensureScheduleHistoryIndexes } from '../../../src/plugin-runtime/agent/persistence-coordinator.js';
import type { StructuredDatabase } from '@zhin.js/database';

it.each(['sqlite', 'mysql', 'pg'] as const)('indexes schedule history with MySQL prefixes only on unbounded TEXT (%s)', async dialectName => {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith('SHOW INDEX')) return [];
    return [];
  });
  await ensureScheduleHistoryIndexes({ dialectName, query } as unknown as StructuredDatabase);
  const statements = query.mock.calls.map(([sql]) => sql).filter(sql => String(sql).startsWith('CREATE INDEX'));
  expect(statements).toEqual(dialectName === 'mysql'
    ? [
      'CREATE INDEX `agent_schedule_runs_job_time` ON `agent_schedule_runs` (`job_id`(128), `queued_at`, `id`)',
      'CREATE INDEX `agent_schedule_runs_time` ON `agent_schedule_runs` (`queued_at`, `id`)',
      'CREATE INDEX `agent_schedule_attempts_run` ON `agent_schedule_attempts` (`run_id`, `number`)',
    ]
    : [
      'CREATE INDEX IF NOT EXISTS "agent_schedule_runs_job_time" ON "agent_schedule_runs" ("job_id", "queued_at", "id")',
      'CREATE INDEX IF NOT EXISTS "agent_schedule_runs_time" ON "agent_schedule_runs" ("queued_at", "id")',
      'CREATE INDEX IF NOT EXISTS "agent_schedule_attempts_run" ON "agent_schedule_attempts" ("run_id", "number")',
    ]);
});
