import { checkBashSensitiveReadAccess, checkSensitiveFilePathAccess } from '../src/security/dangerous-tool-policy.js';

// The instance and the gateway share one SQLite file holding console_* password / token hashes.
describe('Agent file tools and the project SQLite database (ADR 0054 §7)', () => {
  const workspace = '/srv/bot';

  it('read_file cannot open SQLite database files or their WAL siblings', () => {
    for (const file of ['/srv/bot/bot.db', '/srv/bot/store/app.sqlite', '/srv/bot/bot.db-wal', '/srv/bot/x.sqlite3', '/srv/bot/a.db-shm']) {
      expect(checkSensitiveFilePathAccess('read_file', file, undefined, workspace).allowed).toBe(false);
    }
    expect(checkSensitiveFilePathAccess('read_file', '/srv/bot/src/index.ts', undefined, workspace).allowed).toBe(true);
    expect(checkSensitiveFilePathAccess('read_file', '/srv/bot/src/db.ts', undefined, workspace).allowed).toBe(true);
  });

  it('bash cannot read console_users through a database client or a read command', () => {
    expect(checkBashSensitiveReadAccess('sqlite3 bot.db "select password_hash from console_users"', undefined, workspace).allowed).toBe(false);
    expect(checkBashSensitiveReadAccess('sqlite3 -readonly ./store/app.sqlite .dump', undefined, workspace).allowed).toBe(false);
    expect(checkBashSensitiveReadAccess('strings ./bot.db', undefined, workspace).allowed).toBe(false);
    expect(checkBashSensitiveReadAccess('cat src/index.ts', undefined, workspace).allowed).toBe(true);
  });
});
