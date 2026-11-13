import { MySQLDialect } from '@zhin.js/database/dialects/mysql';
import {
  ConsoleSqlRefusal,
  readOnlyConsoleStatement,
  redactConsoleSql,
  splitConsoleSql,
  writeConsoleStatements,
} from '../../src/plugin-runtime/im/host/database-console-sql.js';
import {
  planConsoleSchemaChange,
  renderMysqlModify,
  type MysqlColumnDefinition,
  type SchemaPlanContext,
} from '../../src/plugin-runtime/im/host/database-console-schema.js';

const refusal = (run: () => unknown) => {
  try { run(); } catch (error) { return error instanceof ConsoleSqlRefusal ? error.code : String(error); }
  return undefined;
};

describe('Console SQL lexer matches the server (review of #1246)', () => {
  it('lexes PostgreSQL E-strings like the server', () => {
    // A naive lexer sees one string to the end; the server sees `COMMIT; DELETE …`.
    expect(splitConsoleSql(String.raw`SELECT E'\''; COMMIT; DELETE FROM victim; --'`, 'pg').map(s => s.text))
      .toEqual([String.raw`SELECT E'\''`, 'COMMIT', 'DELETE FROM victim', "--'"]);
    expect(splitConsoleSql(String.raw`SELECT e'a\\'; SELECT 2`, 'pg')).toHaveLength(2);
    // A standard string has no backslash escapes.
    expect(splitConsoleSql(String.raw`SELECT 'a\'; SELECT 2`, 'pg')).toHaveLength(2);
    // `somee'x'` is a word followed by a standard string, not an E-string.
    expect(splitConsoleSql(String.raw`SELECT somee'a\'; SELECT 2`, 'pg')).toHaveLength(2);
  });

  it('nests PostgreSQL block comments (and only PostgreSQL)', () => {
    expect(splitConsoleSql("SELECT 1 /* /* */ ' */; COMMIT; INSERT INTO victim VALUES (99); --'", 'pg').map(s => s.text))
      .toEqual(["SELECT 1 /* /* */ ' */", 'COMMIT', 'INSERT INTO victim VALUES (99)', "--'"]);
    expect(splitConsoleSql('SELECT 1 /* /* */ ; SELECT 2', 'sqlite')).toHaveLength(2);
    expect(refusal(() => splitConsoleSql('SELECT 1 /* /* */', 'pg'))).toBe('refused_statement');
  });

  it('reads dollar tags with digits', () => {
    expect(splitConsoleSql("SELECT $a1$ ' $a1$; COMMIT; DROP TABLE t; --'", 'pg').map(s => s.text))
      .toEqual(["SELECT $a1$ ' $a1$", 'COMMIT', 'DROP TABLE t', "--'"]);
    expect(splitConsoleSql('SELECT $_x9$ ; $_x9$', 'pg')).toHaveLength(1);
    // `$1` is a parameter, not a tag.
    expect(splitConsoleSql('SELECT $1; SELECT $2', 'pg')).toHaveLength(2);
  });

  it('refuses the reviewer statements on both paths', () => {
    for (const sql of [
      String.raw`SELECT E'\''; COMMIT; DELETE FROM victim; --'`,
      "SELECT 1 /* /* */ ' */; COMMIT; INSERT INTO victim VALUES (99); --'",
      "SELECT $a1$ ' $a1$; COMMIT; DROP TABLE t; --'",
    ]) {
      expect(refusal(() => readOnlyConsoleStatement(sql, 'pg')), sql).toBe('multi_statement');
      expect(refusal(() => writeConsoleStatements(sql, 'pg')), sql).toBe('refused_statement');
    }
  });

  it('refuses transaction control in read and write SQL', () => {
    for (const sql of [
      'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT a', 'RELEASE SAVEPOINT a', 'START TRANSACTION', 'END', 'ABORT',
      'SET TRANSACTION READ WRITE', 'SET LOCAL statement_timeout = 0', 'PREPARE p AS SELECT 1', 'EXECUTE p',
    ]) {
      expect(refusal(() => readOnlyConsoleStatement(sql, 'pg')), sql).toBe('refused_statement');
      expect(refusal(() => writeConsoleStatements(sql, 'pg')), sql).toBe('refused_statement');
    }
    expect(refusal(() => writeConsoleStatements("XA START 'x'", 'mysql'))).toBe('refused_statement');
    expect(refusal(() => writeConsoleStatements('UPDATE t SET a = 1; COMMIT; UPDATE t SET a = 2', 'sqlite'))).toBe('refused_statement');
  });
});

describe('Console SQL refuses ways around the gateway tables', () => {
  it('refuses U& escaped names and strings on PostgreSQL', () => {
    for (const sql of [
      String.raw`SELECT * FROM U&"\0063onsole_users"`,
      String.raw`SELECT U&'\0063onsole_users'`,
      String.raw`SELECT * FROM u&"d\0061t\+000061"`,
    ]) {
      expect(refusal(() => readOnlyConsoleStatement(sql, 'pg')), sql).toBe('refused_statement');
      expect(refusal(() => writeConsoleStatements(sql, 'pg')), sql).toBe('refused_statement');
    }
    // `u&1` is a column and an operator.
    expect(readOnlyConsoleStatement('SELECT u&1 FROM t', 'pg').kind).toBe('select');
  });

  it('refuses dynamic SQL functions, also quoted and schema-qualified', () => {
    for (const sql of [
      "SELECT query_to_xml('select * from con'||'sole_users', true, true, '')",
      "SELECT pg_catalog.query_to_xml('select 1', true, true, '')",
      `SELECT "query_to_xml"('select 1', true, true, '')`,
      `SELECT "pg_catalog"."query_to_xmlschema"('select 1', true, true, '')`,
      "SELECT query_to_xml_and_xmlschema('select 1', true, true, '')",
      "SELECT database_to_xml(true, true, '')",
      "SELECT schema_to_xml('public', true, true, '')",
      "SELECT table_to_xml('t', true, true, '')",
      "SELECT cursor_to_xml('c', 1, true, true, '')",
      "SELECT xpath('/a', '<a/>')",
      "SELECT * FROM ts_stat('select 1')",
      "SELECT dblink('x', 'select 1')",
      "SELECT lo_import('/etc/passwd')",
      "SELECT pg_ls_dir('.')",
    ]) {
      expect(refusal(() => readOnlyConsoleStatement(sql, 'pg')), sql).toBe('refused_statement');
      expect(refusal(() => writeConsoleStatements(sql, 'pg')), sql).toBe('refused_statement');
    }
  });

  it('compares protected tables on normalised identifiers and decoded literals', () => {
    for (const sql of [
      'SELECT * FROM "Console_Users"',
      'SELECT * FROM public."console_users"',
      'SELECT * FROM "console_""users"',
      String.raw`SELECT E'\x63onsole_users'`,
    ]) expect(refusal(() => readOnlyConsoleStatement(sql, 'pg')), sql).toBe('protected_table');
    expect(refusal(() => readOnlyConsoleStatement('SELECT * FROM [console_users]', 'sqlite'))).toBe('protected_table');
  });

  it('only takes literal arguments in SQLite table-valued PRAGMA functions', () => {
    expect(refusal(() => readOnlyConsoleStatement("SELECT * FROM pragma_table_info('con'||'sole_users')", 'sqlite'))).toBe('refused_statement');
    expect(refusal(() => readOnlyConsoleStatement("SELECT * FROM pragma_table_info('console_users')", 'sqlite'))).toBe('protected_table');
    expect(readOnlyConsoleStatement("SELECT * FROM pragma_table_info('notes')", 'sqlite').kind).toBe('select');
    expect(refusal(() => readOnlyConsoleStatement('SELECT * FROM sqlite_dbpage', 'sqlite'))).toBe('refused_statement');
  });

  it('checks refused functions on normalised names', () => {
    for (const sql of [
      `SELECT "set_config"('statement_timeout','0',true)`,
      `SELECT pg_catalog.set_config('statement_timeout','0',true)`,
      `SELECT "pg_catalog"."set_config"('statement_timeout','0',true)`,
      `SELECT "set_config"('statement_timeout','0',true), pg_sleep(1e6)`,
      `SELECT "pg_terminate_backend"(1)`,
      `SELECT "pg_read_file"('/etc/passwd')`,
      `SELECT pg_read_binary_file('/etc/passwd')`,
      `SELECT set_config ('a', 'b', false)`,
      `SELECT set_config/**/('a', 'b', false)`,
      `SELECT pg_try_advisory_lock(1)`,
    ]) {
      expect(refusal(() => readOnlyConsoleStatement(sql, 'pg')), sql).toBe('refused_statement');
      expect(refusal(() => writeConsoleStatements(sql, 'pg')), sql).toBe('refused_statement');
    }
    // Reading a setting is fine; only writing it is refused.
    expect(readOnlyConsoleStatement("SELECT current_setting('statement_timeout')", 'pg').kind).toBe('select');
  });

  it('refuses defining code that runs SQL later, and role / server settings', () => {
    for (const sql of [
      'CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END $$',
      'CREATE OR REPLACE PROCEDURE p() LANGUAGE sql AS $$ SELECT 1 $$',
      'CREATE RULE r AS ON INSERT TO t DO INSTEAD NOTHING',
      'CREATE EXTENSION dblink',
      'ALTER SYSTEM SET statement_timeout = 0',
      'ALTER ROLE app SET statement_timeout = 0',
      'CREATE ROLE evil',
    ]) expect(refusal(() => writeConsoleStatements(sql, 'pg')), sql).toBe('refused_statement');
    expect(refusal(() => writeConsoleStatements('CREATE DEFINER=root@localhost PROCEDURE p() SELECT 1', 'mysql'))).toBe('refused_statement');
    expect(writeConsoleStatements('CREATE TABLE f (id int); CREATE INDEX f_id ON f (id); CREATE VIEW v AS SELECT 1', 'pg')).toHaveLength(3);
  });
});

describe('Console SQL on MySQL', () => {
  it('refuses executable comments and optimizer hints', () => {
    for (const sql of [
      "SELECT /*! load_file('/etc/passwd') */",
      "SELECT * FROM t /*! INTO OUTFILE '/tmp/x' */",
      'SELECT /*!50000 1 */',
      'SELECT /*+ MAX_EXECUTION_TIME(0) */ 1',
    ]) {
      expect(refusal(() => readOnlyConsoleStatement(sql, 'mysql')), sql).toBe('refused_statement');
      expect(refusal(() => writeConsoleStatements(sql, 'mysql')), sql).toBe('refused_statement');
    }
    // Elsewhere they are ordinary comments.
    expect(readOnlyConsoleStatement('SELECT /*! x */ 1', 'pg').kind).toBe('select');
  });

  it('treats -- as a comment only before whitespace', () => {
    // `--x` is `- -x` on MySQL: the `;` after it splits the statement.
    expect(splitConsoleSql('SELECT 1 --x; DELETE FROM t', 'mysql')).toHaveLength(2);
    expect(refusal(() => readOnlyConsoleStatement('SELECT 1 --x; DELETE FROM t', 'mysql'))).toBe('multi_statement');
    expect(splitConsoleSql('SELECT 1 -- x; DELETE FROM t', 'mysql')).toHaveLength(1);
    expect(splitConsoleSql('SELECT 1 --\t; DELETE FROM t', 'mysql')).toHaveLength(1);
    expect(splitConsoleSql('SELECT 1 --', 'mysql')).toHaveLength(1);
    // PostgreSQL and SQLite: always a comment.
    expect(splitConsoleSql('SELECT 1 --x; DELETE FROM t', 'pg')).toHaveLength(1);
  });
});

describe('Console SQL audit redaction', () => {
  it('replaces literal values and keeps identifiers and numbers', () => {
    expect(redactConsoleSql(String.raw`UPDATE "users" SET key = 'sk-1', note = E'it\'s' WHERE b = $t$x$t$ AND c = $$y$$ AND n = 5`, 'pg'))
      .toBe(`UPDATE "users" SET key = '…', note = E'…' WHERE b = $t$…$t$ AND c = $$…$$ AND n = 5`);
    // Comments are dropped entirely (a quote inside one never shifts what counts as a literal).
    expect(redactConsoleSql("UPDATE `users` SET a = \"secret\", b = 'it\\'s' -- 'x'", 'mysql'))
      .toBe("UPDATE `users` SET a = \"…\", b = '…'");
    // Text the lexer cannot read is not recorded at all.
    expect(redactConsoleSql("INSERT INTO t VALUES ('a''b', 'unterminated", 'sqlite')).toMatch(/^\[SQL not recorded: \d+ characters/);
  });

  it('uses the Console lexer: quotes in comments, quoted names and backticks do not shift literals', () => {
    expect(redactConsoleSql("-- fix user's key\nUPDATE accounts SET api_key = 'sk-live-123' WHERE id = 1", 'pg'))
      .toBe("UPDATE accounts SET api_key = '…' WHERE id = 1");
    expect(redactConsoleSql(`SELECT "it's" AS a, 'sk-live-123' AS b`, 'pg')).toBe(`SELECT "it's" AS a, '…' AS b`);
    expect(redactConsoleSql("SELECT `it's` AS a, 'sk-live-123' AS b", 'mysql')).toBe("SELECT `it's` AS a, '…' AS b");
    expect(redactConsoleSql("/* it's */ INSERT INTO t VALUES ('sk-live-123')", 'sqlite')).toBe("INSERT INTO t VALUES ('…')");
    expect(redactConsoleSql("SELECT e'\\'' , 'sk-live-123'", 'pg')).toBe("SELECT e'…' , '…'");
    for (const sql of ["-- fix user's key\nUPDATE a SET k = 'sk-live-123'", "/* it's */ SELECT 'sk-live-123'", `SELECT "it's", 'sk-live-123'`]) {
      expect(redactConsoleSql(sql, 'pg')).not.toContain('sk-live');
    }
  });
});

describe('MySQL MODIFY COLUMN keeps what the change does not touch', () => {
  const host = new MySQLDialect<any>({} as never);
  const column = (overrides: Partial<MysqlColumnDefinition>): MysqlColumnDefinition => ({
    name: 'c', columnType: 'varchar(64)', dataType: 'varchar', nullable: true, defaultValue: null, extra: '',
    comment: '', characterSet: null, collation: null, generation: null, indexed: false, ...overrides,
  });

  it('keeps CURRENT_TIMESTAMP and ON UPDATE as expressions, not quoted strings', () => {
    expect(renderMysqlModify(column({ columnType: 'timestamp', dataType: 'timestamp', defaultValue: 'CURRENT_TIMESTAMP', extra: 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP' }), { nullable: false }, host))
      .toBe('`c` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
    expect(renderMysqlModify(column({ columnType: 'datetime(3)', dataType: 'datetime', defaultValue: 'CURRENT_TIMESTAMP(3)', extra: 'DEFAULT_GENERATED' }), { nullable: true }, host))
      .toBe('`c` datetime(3) NULL DEFAULT CURRENT_TIMESTAMP(3)');
    expect(renderMysqlModify(column({ columnType: 'char(36)', dataType: 'char', defaultValue: 'uuid()', extra: 'DEFAULT_GENERATED' }), { nullable: false }, host))
      .toBe('`c` char(36) NOT NULL DEFAULT (uuid())');
  });

  it('escapes backslashes and quotes of literal defaults and comments', () => {
    expect(renderMysqlModify(column({ defaultValue: 'C:\\dir\\x', comment: "a\\b 'c'" }), { nullable: false }, host))
      .toBe("`c` varchar(64) NOT NULL DEFAULT 'C:\\\\dir\\\\x' COMMENT 'a\\\\b ''c'''");
    expect(renderMysqlModify(column({}), { default: 'back\\slash' }, host)).toBe("`c` varchar(64) NULL DEFAULT 'back\\\\slash'");
    // The dialect itself (code-declared defaults, JSON values) escapes backslashes too.
    expect(host.formatDefaultValue("a\\b'c")).toBe("'a\\\\b''c'");
    expect(host.formatJson({ path: 'a\\b' })).toBe("'{\"path\":\"a\\\\\\\\b\"}'");
  });

  it('keeps character set, collation, comment, auto_increment and invisibility', () => {
    expect(renderMysqlModify(column({ characterSet: 'utf8mb4', collation: 'utf8mb4_bin', comment: 'name', extra: 'INVISIBLE' }), { nullable: false }, host))
      .toBe("`c` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL INVISIBLE COMMENT 'name'");
    expect(renderMysqlModify(column({ columnType: 'bigint unsigned', dataType: 'bigint', nullable: false, extra: 'auto_increment' }), { nullable: false }, host))
      .toBe('`c` bigint unsigned NOT NULL AUTO_INCREMENT');
    // A type change drops the old character set (it may not apply to the new type).
    expect(renderMysqlModify(column({ characterSet: 'utf8mb4', collation: 'utf8mb4_bin' }), { type: 'integer' }, host)).toBe('`c` INT NULL');
  });

  it('writes TEXT / JSON literal defaults as expressions and keeps indexed text columns indexable', () => {
    expect(renderMysqlModify(column({ columnType: 'text', dataType: 'text' }), { default: 'hi' }, host)).toBe("`c` text NULL DEFAULT ('hi')");
    expect(renderMysqlModify(column({ columnType: 'json', dataType: 'json', defaultValue: "_utf8mb4\\'{}\\'", extra: 'DEFAULT_GENERATED' }), { nullable: false }, host))
      .toBe("`c` json NOT NULL DEFAULT (_utf8mb4'{}')");
    expect(renderMysqlModify(column({ indexed: true }), { type: 'text', default: 'x' }, host)).toBe("`c` VARCHAR(768) NULL DEFAULT 'x'");
    expect(renderMysqlModify(column({}), { type: 'text', default: 'x' }, host)).toBe("`c` TEXT NULL DEFAULT ('x')");
    expect(renderMysqlModify(column({ defaultValue: 'x' }), { dropDefault: true }, host)).toBe('`c` varchar(64) NULL');
  });

  it('refuses generated columns and needs the current definition', async () => {
    expect(() => renderMysqlModify(column({ generation: 'a + 1', extra: 'VIRTUAL GENERATED' }), { nullable: false }, host)).toThrow(/Generated/);
    await expect(planConsoleSchemaChange({ kind: 'alter-column', table: 't', column: 'c', nullable: false }, {
      dialect: 'mysql', host, hasTable: () => true,
      describe: async () => ({ table: 't', columns: [{ name: 'c', type: 'text', nativeType: 'text', nullable: true, primary: false }], indexes: [] }),
    })).rejects.toThrow(/current definition/);
  });

  it('adds TEXT columns with expression defaults through the dialect column DDL', async () => {
    const plan = await planConsoleSchemaChange({ kind: 'add-column', table: 't', column: { name: 'note', type: 'text', default: "it's" } }, {
      dialect: 'mysql', host, hasTable: () => true,
      describe: async () => ({ table: 't', columns: [{ name: 'id', type: 'integer', nativeType: 'int', nullable: false, primary: true }], indexes: [] }),
    });
    expect(plan.statements).toEqual(["ALTER TABLE `t` ADD COLUMN `note` TEXT DEFAULT ('it''s')"]);
  });
});

describe('Console schema editor and code-declared tables', () => {
  const context = (declared: boolean): SchemaPlanContext => ({
    dialect: 'sqlite',
    host: { name: 'sqlite', mapColumnType: () => 'TEXT', formatDefaultValue: value => String(value) },
    hasTable: () => true,
    isDeclared: () => declared,
    describe: async () => ({
      table: 'notes',
      columns: [
        { name: 'id', type: 'integer', nativeType: 'INTEGER', nullable: false, primary: true },
        { name: 'title', type: 'text', nativeType: 'TEXT', nullable: true, primary: false },
      ],
      indexes: [],
    }),
  });

  it('refuses dropping or renaming columns a plugin declared, and allows them otherwise', async () => {
    await expect(planConsoleSchemaChange({ kind: 'drop-column', table: 'notes', column: 'title' }, context(true))).rejects.toThrow(/declared by plugin code/);
    await expect(planConsoleSchemaChange({ kind: 'rename-column', table: 'notes', column: 'title', to: 'name' }, context(true))).rejects.toThrow(/declared by plugin code/);
    expect((await planConsoleSchemaChange({ kind: 'drop-column', table: 'notes', column: 'title' }, context(false))).statements)
      .toEqual(['ALTER TABLE "notes" DROP COLUMN "title"']);
    expect((await planConsoleSchemaChange({ kind: 'add-column', table: 'notes', column: { name: 'tag', type: 'text', nullable: true } }, context(true))).destructive).toBe(false);
  });
});

describe('Console SQL refuses what name-based protection cannot see (re-review of #1246)', () => {
  it('refuses statistics views and credential catalogs on both paths', () => {
    for (const sql of [
      "select tablename, attname, histogram_bounds::text from pg_stats where tablename like 'con%'",
      'select * from pg_catalog.pg_stats',
      'select * from "pg_stats_ext"',
      'select * from pg_stats_ext_exprs',
      'select * from pg_statistic',
      'select * from pg_statistic_ext_data',
      'select usename, passwd from pg_shadow',
      'select * from pg_authid',
      'select * from pg_largeobject',
    ]) {
      expect(refusal(() => readOnlyConsoleStatement(sql, 'pg')), sql).toBe('refused_statement');
      expect(refusal(() => writeConsoleStatements(`create table x as ${sql}`, 'pg')), sql).toBe('refused_statement');
    }
    for (const sql of ['select * from sqlite_stat1', 'select * from sqlite_stat4', 'select * from main.sqlite_stat1']) {
      expect(refusal(() => readOnlyConsoleStatement(sql, 'sqlite')), sql).toBe('refused_statement');
    }
    for (const sql of ['select * from mysql.user', 'select * from `mysql`.`global_priv`', 'select * from information_schema.column_statistics']) {
      expect(refusal(() => readOnlyConsoleStatement(sql, 'mysql')), sql).toBe('refused_statement');
    }
    expect(refusal(() => writeConsoleStatements('analyze table t update histogram on a', 'mysql'))).toBe('refused_statement');
    // ANALYZE itself stays allowed; catalogs show names, not values.
    expect(writeConsoleStatements('analyze', 'pg')).toHaveLength(1);
    expect(readOnlyConsoleStatement("select relname from pg_class where relname like 'con%'", 'pg').kind).toBe('select');
  });

  it('refuses bulk and cascading destruction', () => {
    for (const [sql, dialect] of [
      ['drop owned by current_user', 'pg'],
      ['reassign owned by a to b', 'pg'],
      ['drop schema public cascade', 'pg'],
      ['drop schema s', 'pg'],
      ['alter schema public rename to x', 'pg'],
      ['create database x', 'pg'],
      ['alter database x set statement_timeout = 0', 'pg'],
      ['drop database zhin', 'pg'],
      ['drop table notes cascade', 'pg'],
      ['drop view v cascade', 'pg'],
      ['truncate notes cascade', 'pg'],
      ['alter table foo owner to postgres', 'pg'],
      ['create tablespace t location \'/tmp\'', 'pg'],
      ['drop database zhin', 'mysql'],
      ['drop schema zhin', 'mysql'],
      ['restart', 'mysql'],
      ['clone local data directory = \'/tmp/x\'', 'mysql'],
      ['purge binary logs before now()', 'mysql'],
      ['rename user a to b', 'mysql'],
    ] as const) expect(refusal(() => writeConsoleStatements(sql, dialect)), sql).toBe('refused_statement');
    expect(writeConsoleStatements('drop table scratch', 'pg')).toHaveLength(1);
    expect(writeConsoleStatements('truncate scratch', 'pg')).toHaveLength(1);
  });

  it('refuses triggers, including the MySQL DEFINER form', () => {
    for (const [sql, dialect] of [
      ['create trigger t before insert on foo for each row execute function suppress_redundant_updates_trigger()', 'pg'],
      ['create or replace trigger t after insert on foo execute function f()', 'pg'],
      ['create constraint trigger t after insert on foo for each row execute function f()', 'pg'],
      ['create trigger t before insert on foo for each row set new.a = 1', 'mysql'],
      ['create definer=`root`@`%` trigger t before insert on foo for each row set new.a=1', 'mysql'],
      ['create definer = root@localhost trigger t before insert on foo for each row set new.a=1', 'mysql'],
      ['create trigger t after insert on foo begin select 1; end', 'sqlite'],
      ['create event e on schedule every 1 second do select 1', 'mysql'],
    ] as const) expect(refusal(() => writeConsoleStatements(sql, dialect)), sql).toBe('refused_statement');
    expect(writeConsoleStatements('create definer = root@localhost view v as select 1', 'mysql')).toHaveLength(1);
  });
});
