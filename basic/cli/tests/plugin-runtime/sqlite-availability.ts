import { createRequire } from 'node:module';

/** Match the database test gate: SQLite is optional on the supported Node 20 line. */
export const sqliteAvailable = (() => {
  try {
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    const database = new DatabaseSync(':memory:');
    database.close();
    return true;
  } catch { return false; }
})();
