import type { RoomTaskDatabase, RoomTaskDatabaseModel } from '../../src/room/database-room-task-journal.js';

export function databaseFixture() {
  const rows: Record<string, unknown>[] = [];
  const isolationLevels: string[] = [];
  const select = (query: Record<string, unknown>) => rows.filter(row =>
    Object.entries(query).every(([key, value]) => row[key] === value));
  const model: RoomTaskDatabaseModel = { select: () => ({ where: async query => select(query) }) };
  const database: RoomTaskDatabase = {
    transaction: async (operation, options) => {
      isolationLevels.push(options.isolationLevel);
      await Promise.resolve();
      return await operation({
        select: () => ({ where: async query => select(query) }),
        insertMany: async (_table, inserted) => {
          if (inserted.some(candidate => rows.some(row => row.id === candidate.id))) {
            throw Object.assign(new Error('unique constraint'), { code: '23505' });
          }
          rows.push(...inserted);
        },
      });
    },
  };
  return { database, model, rows, isolationLevels };
}
