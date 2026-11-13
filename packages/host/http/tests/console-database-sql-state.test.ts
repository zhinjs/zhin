import { dispatchRuntimeConsoleRpc, pickRpcReply } from '../src/index.js';

/**
 * ADR 0059 §4: the restricted Console account makes the server refuse DDL on PostgreSQL (42501);
 * the reply carries the SQLSTATE so the Console can point to the schema editor.
 */
async function reply(error: Error) {
  const database = { execute: async () => { throw error; }, query: async () => { throw error; } };
  const request = { requestId: 1, type: 'db:execute', sql: 'CREATE TABLE t (a int)' };
  return pickRpcReply(request, await dispatchRuntimeConsoleRpc(request, { database } as never))!;
}

describe('Console SQL errors carry the SQLSTATE', () => {
  it('passes PostgreSQL and MySQL SQLSTATEs, not other error codes', async () => {
    const pg = Object.assign(new Error('permission denied for schema public'), { name: 'error', code: '42501' });
    expect(await reply(pg)).toMatchObject({ error: 'permission denied for schema public', data: { sqlState: '42501' } });
    const mysql = Object.assign(new Error("CREATE command denied to user 'x'@'%'"), { code: 'ER_TABLEACCESS_DENIED_ERROR', sqlState: '42000', errno: 1142 });
    expect(await reply(mysql)).toMatchObject({ data: { sqlState: '42000' } });
    const node = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect((await reply(node)).data).toBeUndefined();
  });

  it('keeps Console refusal codes as they were', async () => {
    const refusal = Object.assign(new Error('Only one statement'), { name: 'ConsoleSqlRefusal', code: 'multi_statement' });
    const answer = await reply(refusal);
    expect(answer.data).toEqual({ code: 'multi_statement' });
  });
});
