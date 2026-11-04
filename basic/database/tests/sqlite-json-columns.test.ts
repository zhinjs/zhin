import { SQLiteDialect } from '../src/dialects/sqlite.js';

let database: SQLiteDialect;
beforeEach(async () => {
  database = new SQLiteDialect({ filename: ':memory:' });
  database.registerTableSchema('json_rows', { id: { type: 'integer' }, value: { type: 'json' } });
  database.registerTableSchema('text_rows', { id: { type: 'integer' }, value: { type: 'text' } });
  await database.connect();
  await database.query('CREATE TABLE json_rows (id INTEGER PRIMARY KEY, value TEXT)');
  await database.query('CREATE TABLE text_rows (id INTEGER PRIMARY KEY, value TEXT)');
  for (const table of ['json_rows', 'text_rows']) await database.query(`INSERT INTO ${table} (id, value) VALUES (?, ?)`, [1, '{"message":"unchanged"}']);
});
afterEach(async () => { await database.dispose(); });

it('decodes by the actual table and column instead of contaminating an identically named TEXT column', async () => {
  expect(await database.query('SELECT value FROM json_rows')).toEqual([{ value: { message: 'unchanged' } }]);
  expect(await database.query('SELECT value FROM text_rows')).toEqual([{ value: '{"message":"unchanged"}' }]);
});
it('retains the origin type through result aliases and joins', async () => {
  expect(await database.query('SELECT j.value AS json_value, t.value AS text_value FROM json_rows j JOIN text_rows t ON j.id=t.id'))
    .toEqual([{ json_value: { message: 'unchanged' }, text_value: '{"message":"unchanged"}' }]);
});
it('does not infer JSON from an expression result with no origin table', async () => {
  expect(await database.query("SELECT '{\"expression\":true}' AS value")).toEqual([{ value: '{"expression":true}' }]);
  expect(await database.query('SELECT substr(value, 1) AS value FROM json_rows')).toEqual([{ value: '{"message":"unchanged"}' }]);
});
it('uses the same origin metadata for DML RETURNING results', async () => {
  expect(await database.query('UPDATE text_rows SET value = ? WHERE id = 1 RETURNING value', ['[1,2]'])).toEqual([{ value: '[1,2]' }]);
  expect(await database.query('UPDATE json_rows SET value = ? WHERE id = 1 RETURNING value AS alias', ['[1,2]'])).toEqual([{ alias: [1, 2] }]);
});
it('does not apply a registered main-table JSON declaration to an attached table with the same name', async () => {
  await database.query("ATTACH DATABASE ':memory:' AS external");
  await database.query('CREATE TABLE external.json_rows (value TEXT)');
  await database.query('INSERT INTO external.json_rows (value) VALUES (?)', ['{"external":true}']);
  expect(await database.query('SELECT value FROM external.json_rows')).toEqual([{ value: '{"external":true}' }]);
});
