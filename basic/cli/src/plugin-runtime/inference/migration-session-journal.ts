export * from '@zhin.js/agent/runtime';
import {
  applyMigrationSessionJournal as runtimeApplyMigrationSessionJournal,
  type MigrationSessionJournal,
} from '@zhin.js/agent/runtime';

export function applyMigrationSessionJournal(
  input: Parameters<typeof runtimeApplyMigrationSessionJournal>[0],
): ReturnType<typeof runtimeApplyMigrationSessionJournal> {
  return runtimeApplyMigrationSessionJournal(input);
}

export type { MigrationSessionJournal };
