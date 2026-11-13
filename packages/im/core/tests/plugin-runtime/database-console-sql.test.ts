import {
  ConsoleSqlRefusal,
  readOnlyConsoleStatement,
  splitConsoleSql,
  writeConsoleStatements,
} from '../../src/plugin-runtime/im/host/database-console-sql.js';
import { planConsoleSchemaChange, type SchemaPlanContext } from '../../src/plugin-runtime/im/host/database-console-schema.js';

const refusal = (run: () => unknown) => {
  try { run(); } catch (error) { return error instanceof ConsoleSqlRefusal ? error.code : String(error); }
  return undefined;
};

describe('Console SQL statement analysis', () => {
  it('splits on top-level semicolons only', () => {
    expect(splitConsoleSql('SELECT \';\'; SELECT "a;b" -- ;\n; /* ; */ SELECT 3;', 'sqlite').map(s => s.text))
      .toEqual(['SELECT \';\'', 'SELECT "a;b" -- ;', '/* ; */ SELECT 3']);
    expect(splitConsoleSql('SELECT $x$ ; $x$; SELECT 2', 'pg')).toHaveLength(2);
    expect(splitConsoleSql('SELECT \'it\\\'s;\' # ;\n', 'mysql')).toHaveLength(1);
    expect(refusal(() => splitConsoleSql('SELECT \'open', 'sqlite'))).toBe('refused_statement');
  });

  it('classifies read statements per dialect', () => {
    expect(readOnlyConsoleStatement('select * from t', 'sqlite').kind).toBe('select');
    expect(readOnlyConsoleStatement('(SELECT 1) UNION (SELECT 2)', 'pg').kind).toBe('select');
    expect(readOnlyConsoleStatement('EXPLAIN ANALYZE SELECT 1', 'pg').kind).toBe('explain');
    expect(readOnlyConsoleStatement('SHOW TABLES', 'mysql').kind).toBe('show');
    expect(readOnlyConsoleStatement('DESCRIBE t', 'mysql').kind).toBe('describe');
    expect(readOnlyConsoleStatement('PRAGMA index_list("t")', 'sqlite').kind).toBe('pragma');
    expect(readOnlyConsoleStatement('SELECT updated_at, "delete" FROM t', 'sqlite').kind).toBe('select');
    for (const [sql, dialect] of [
      ['SELECT * INTO copy FROM t', 'pg'],
      ['SELECT * FROM t FOR UPDATE', 'pg'],
      ['SELECT 1 INTO OUTFILE \'/tmp/x\'', 'mysql'],
      ['EXPLAIN DELETE FROM t', 'pg'],
      ['SHOW TABLES', 'sqlite'],
      ['PRAGMA cache_size(10)', 'sqlite'],
      ['PRAGMA journal_mode = DELETE', 'sqlite'],
      ['WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x', 'pg'],
    ] as const) expect(refusal(() => readOnlyConsoleStatement(sql, dialect)), sql).toBe('read_only');
    expect(refusal(() => readOnlyConsoleStatement('SELECT pg_terminate_backend(1)', 'pg'))).toBe('refused_statement');
    expect(refusal(() => readOnlyConsoleStatement('SELECT load_file(\'/etc/passwd\')', 'mysql'))).toBe('refused_statement');
    expect(refusal(() => readOnlyConsoleStatement('SELECT * FROM `console_tokens`', 'mysql'))).toBe('protected_table');
    expect(refusal(() => readOnlyConsoleStatement('   ', 'sqlite'))).toBe('empty');
  });

  it('accepts write batches but refuses protected tables and control statements', () => {
    expect(writeConsoleStatements('UPDATE t SET a = 1; DELETE FROM u', 'pg')).toHaveLength(2);
    expect(writeConsoleStatements('SELECT 1 FROM console_conversations', 'sqlite')).toHaveLength(1);
    expect(refusal(() => writeConsoleStatements('INSERT INTO agent_schedule_migration VALUES (1)', 'sqlite'))).toBe('protected_table');
    expect(refusal(() => writeConsoleStatements('SET ROLE admin', 'pg'))).toBe('refused_statement');
    expect(refusal(() => writeConsoleStatements('SELECT 1;'.repeat(51), 'pg'))).toBe('multi_statement');
  });
});

describe('Console schema DDL rendering', () => {
  const describeTable = async () => ({
    table: 't',
    columns: [
      { name: 'id', type: 'integer', nativeType: 'int', nullable: false, primary: true },
      { name: 'body', type: 'text', nativeType: 'text', nullable: true, primary: false, defaultSql: '\'x\'' },
    ],
    indexes: [{ name: 'PRIMARY', columns: ['id'], unique: true, primary: true }],
  });
  const context = (dialect: 'pg' | 'mysql'): SchemaPlanContext => ({
    mysqlColumn: async (_table, column) => (column === 'body' ? {
      name: 'body', columnType: 'text', dataType: 'text', nullable: true, defaultValue: 'x', extra: '',
      comment: '', characterSet: null, collation: null, generation: null, indexed: false,
    } : undefined),
    dialect,
    host: {
      name: dialect,
      mapColumnType: type => ({ text: 'TEXT', integer: 'INTEGER', bigint: 'BIGINT', float: 'REAL', boolean: 'BOOLEAN', date: 'TIMESTAMP', json: 'JSON' } as Record<string, string>)[type]!,
      formatDefaultValue: value => typeof value === 'string' ? `'${value.replaceAll('\'', '\'\'')}'` : String(value),
    },
    hasTable: table => table === 't',
    describe: describeTable,
  });

  it('renders PostgreSQL ALTER COLUMN clauses', async () => {
    const plan = await planConsoleSchemaChange({ kind: 'alter-column', table: 't', column: 'body', type: 'integer', nullable: false, dropDefault: true }, context('pg'));
    expect(plan.statements).toEqual(['ALTER TABLE "t" ALTER COLUMN "body" TYPE INTEGER USING "body"::INTEGER, ALTER COLUMN "body" SET NOT NULL, ALTER COLUMN "body" DROP DEFAULT']);
    expect(plan).toMatchObject({ destructive: true, confirm: 'body' });
  });

  it('restates the whole column for MySQL MODIFY and quotes with backticks', async () => {
    const plan = await planConsoleSchemaChange({ kind: 'alter-column', table: 't', column: 'body', nullable: false }, context('mysql'));
    // A TEXT literal default must be an expression on MySQL 8.0.13+.
    expect(plan.statements).toEqual(['ALTER TABLE `t` MODIFY COLUMN `body` text NOT NULL DEFAULT (\'x\')']);
    const index = await planConsoleSchemaChange({ kind: 'create-index', table: 't', name: 'by_body', columns: ['body'] }, context('mysql'));
    expect(index.statements).toEqual(['CREATE INDEX `by_body` ON `t` (`body`(128))']);
    const drop = await planConsoleSchemaChange({ kind: 'drop-index', table: 't', name: 'by_body' }, { ...context('mysql'), describe: async () => ({ ...(await describeTable()), indexes: [{ name: 'by_body', columns: ['body'], unique: false, primary: false }] }) });
    expect(drop.statements).toEqual(['DROP INDEX `by_body` ON `t`']);
  });

  it('refuses dropping the primary key and unknown kinds', async () => {
    await expect(planConsoleSchemaChange({ kind: 'drop-column', table: 't', column: 'id' }, context('pg'))).rejects.toThrow(/primary key/);
    await expect(planConsoleSchemaChange({ kind: 'truncate', table: 't' }, context('pg'))).rejects.toThrow(/Unknown/);
    await expect(planConsoleSchemaChange({ kind: 'drop-index', table: 't', name: 'PRIMARY' }, context('mysql'))).rejects.toThrow(/Primary key/);
  });
});
