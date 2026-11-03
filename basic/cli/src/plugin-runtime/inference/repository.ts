import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  DatabaseHost,
  DatabaseHostModel,
  DatabaseHostTransaction,
} from '@zhin.js/plugin-runtime';
import {
  normalizeProviderGraph,
  type JsonObject,
  type CommitProviderGraphInput,
  type ProviderCredentialCommitResult,
  type ProviderCredentialRecord,
  type ProviderCredentialWrite,
  type ProviderGraph,
  type ProviderMutationReceipt,
  type ProviderMutationResult,
  type ProviderRepository,
} from '@zhin.js/ai/provider';

const GRAPH = 'agent_inference_graphs';
const MUTATION = 'agent_inference_mutations';
const CREDENTIAL = 'agent_inference_credentials';
const fields = ['id', 'revision', 'value'] as const;

export class InferenceStoreError extends Error {
  constructor(readonly code: 'unavailable' | 'integrity') {
    super(`Inference storage: ${code}`);
    this.name = 'InferenceStoreError';
  }
}

interface RepositoryOptions {
  readonly database: DatabaseHost;
  readonly normalizeGraph: (value: unknown) => ProviderGraph;
}
interface StoredRow {
  readonly revision: number;
  readonly value: unknown;
}
export interface CommitInferenceCredentialMutation
  extends Omit<CommitProviderGraphInput, 'graph' | 'expectedRevision'> {
  readonly expectedGraphRevision: number;
  readonly credentials: readonly ProviderCredentialWrite[];
}
class CasConflict extends Error {
  constructor(readonly reason: 'revision' | 'credential') {
    super(reason);
  }
}
function key(parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new InferenceStoreError('integrity');
  return value as Record<string, unknown>;
}
function json(value: unknown): unknown {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    throw new InferenceStoreError('integrity');
  }
}
function row(input: Record<string, unknown> | undefined): StoredRow | undefined {
  if (!input) return undefined;
  const revision = Number(input.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new InferenceStoreError('integrity');
  return { revision, value: json(input.value) };
}
function storedGraph(
  stored: StoredRow | undefined,
  rootId: string,
  normalizeGraph: RepositoryOptions['normalizeGraph']
): ProviderGraph | undefined {
  if (!stored) return undefined;
  try {
    const graph = normalizeGraph(stored.value);
    if (graph.rootId !== rootId || graph.revision !== stored.revision)
      throw new InferenceStoreError('integrity');
    return graph;
  } catch {
    throw new InferenceStoreError('integrity');
  }
}
export interface ReadStoredInferenceGraphOptions {
  readonly database: JsonObject;
  readonly rootId: string;
}
/** Offline SQLite metadata read. It never starts DatabaseHost, creates a file/table,
 * resolves environment references, or imports any Driver or credential store. */
export function readStoredInferenceGraph(
  options: ReadStoredInferenceGraphOptions
): ProviderGraph | undefined {
  if (options.database.dialect !== 'sqlite')
    throw new Error('Read-only Session target preview currently requires a SQLite database');
  if (typeof options.database.filename !== 'string' || options.database.filename.includes('${'))
    throw new InferenceStoreError('unavailable');
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(options.database.filename, { readOnly: true });
  } catch {
    throw new InferenceStoreError('unavailable');
  }
  try {
    const table = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(GRAPH);
    if (!table) return undefined;
    const value = database
      .prepare(`SELECT revision, value FROM ${GRAPH} WHERE id = ?`)
      .get(key([options.rootId]));
    return storedGraph(row(value), options.rootId, normalizeProviderGraph);
  } catch (error) {
    throw error instanceof InferenceStoreError ? error : new InferenceStoreError('unavailable');
  } finally {
    database.close();
  }
}
async function read(model: DatabaseHostModel, id: string): Promise<StoredRow | undefined> {
  const rows = await model.select(...fields).where({ id });
  if (!Array.isArray(rows) || rows.length > 1) throw new InferenceStoreError('integrity');
  return row(rows[0]);
}
function parseCredential(input: unknown): ProviderCredentialRecord {
  const value = object(input);
  if (
    !text(value.rootId) ||
    !text(value.accountId) ||
    !text(value.incarnation) ||
    !text(value.authContractVersion) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1 ||
    !Number.isSafeInteger(value.formatVersion) ||
    Number(value.formatVersion) < 1 ||
    !Object.hasOwn(value, 'payload')
  ) {
    throw new InferenceStoreError('integrity');
  }
  return structuredClone(value) as unknown as ProviderCredentialRecord;
}
function parseReceipt(input: unknown): ProviderMutationReceipt {
  const value = object(input);
  if (
    !text(value.rootId) ||
    !text(value.mutationId) ||
    !text(value.fingerprint) ||
    !Number.isSafeInteger(value.graphRevision) ||
    Number(value.graphRevision) < 0 ||
    !Object.hasOwn(value, 'result')
  ) {
    throw new InferenceStoreError('integrity');
  }
  return structuredClone(value) as unknown as ProviderMutationReceipt;
}

/** Root-private SQL repository: graph, commit receipt and encrypted credentials share one transaction. */
export class DatabaseInferenceRepository implements ProviderRepository {
  constructor(private readonly options: RepositoryOptions) {
    for (const table of [GRAPH, MUTATION, CREDENTIAL])
      options.database.define(table, {
        id: {
          type: 'text',
          ...(options.database.dialect === 'pg' ? {} : { length: 64 }),
          primary: true,
          nullable: false,
        },
        revision: { type: 'bigint', nullable: false },
        value: { type: 'json', nullable: false },
        ...(table === GRAPH
          ? {
              write_nonce: {
                type: 'text',
                ...(options.database.dialect === 'pg' ? {} : { length: 36 }),
                nullable: false,
              },
            }
          : {}),
      });
  }

  #model(table: string): DatabaseHostModel {
    const db = this.options.database;
    const model = db.started && db.models.get(table);
    if (!model || !db.transaction || !['sqlite', 'mysql', 'pg'].includes(db.dialect))
      throw new InferenceStoreError('unavailable');
    return model;
  }
  async readGraph(input: Readonly<{ rootId: string }>): Promise<ProviderGraph | undefined> {
    let stored: StoredRow | undefined;
    try {
      stored = await read(this.#model(GRAPH), key([input.rootId]));
    } catch (error) {
      throw error instanceof InferenceStoreError ? error : new InferenceStoreError('unavailable');
    }
    // Invalid persisted state is a storage integrity failure, not invalid caller input.
    return storedGraph(stored, input.rootId, this.options.normalizeGraph);
  }
  async readMutation(
    input: Readonly<{ rootId: string; mutationId: string }>
  ): Promise<ProviderMutationReceipt | undefined> {
    let stored: StoredRow | undefined;
    try {
      stored = await read(this.#model(MUTATION), key([input.rootId, input.mutationId]));
    } catch (error) {
      throw error instanceof InferenceStoreError ? error : new InferenceStoreError('unavailable');
    }
    if (!stored) return undefined;
    const receipt = parseReceipt(stored.value);
    if (receipt.rootId !== input.rootId || receipt.mutationId !== input.mutationId)
      throw new InferenceStoreError('integrity');
    return receipt;
  }
  async readCredential(
    input: Readonly<{ rootId: string; accountId: string }>
  ): Promise<ProviderCredentialRecord | undefined> {
    let stored: StoredRow | undefined;
    try {
      stored = await read(this.#model(CREDENTIAL), key([input.rootId, input.accountId]));
    } catch (error) {
      throw error instanceof InferenceStoreError ? error : new InferenceStoreError('unavailable');
    }
    if (!stored) return undefined;
    const record = parseCredential(stored.value);
    if (
      record.rootId !== input.rootId ||
      record.accountId !== input.accountId ||
      record.revision !== stored.revision
    ) {
      throw new InferenceStoreError('integrity');
    }
    return record;
  }

  async commit(input: CommitProviderGraphInput): Promise<ProviderMutationResult> {
    const graph = this.options.normalizeGraph(input.graph);
    if (
      graph.rootId !== input.rootId ||
      graph.revision !== input.expectedRevision + 1 ||
      !text(input.mutationId) ||
      !text(input.fingerprint)
    )
      throw new InferenceStoreError('integrity');
    return this.#commit(input, graph);
  }

  /** User-facing credential saves have durable mutation receipts without changing model selections. */
  async commitCredentialMutation(
    input: CommitInferenceCredentialMutation
  ): Promise<ProviderMutationResult> {
    return this.#commit({
      ...input,
      expectedRevision: input.expectedGraphRevision,
    });
  }

  async #commit(
    input: Omit<CommitProviderGraphInput, 'graph'>,
    nextGraph?: ProviderGraph
  ): Promise<ProviderMutationResult> {
    try {
      this.#model(GRAPH);
    } catch {
      return { status: 'not-committed' };
    }
    try {
      return await this.options.database.transaction!(async (transaction) => {
        const oldReceipt = await read(
          transaction.model(MUTATION),
          key([input.rootId, input.mutationId])
        );
        if (oldReceipt) {
          const receipt = parseReceipt(oldReceipt.value);
          return receipt.fingerprint === input.fingerprint
            ? { status: 'committed', receipt, replayed: true }
            : { status: 'conflict', reason: 'mutation-content' };
        }
        const graphId = key([input.rootId]);
        const current = await read(transaction.model(GRAPH), graphId);
        if ((current?.revision ?? 0) !== input.expectedRevision)
          return { status: 'conflict', reason: 'revision' };
        const oldGraph = current ? this.options.normalizeGraph(current.value) : undefined;
        const graph = nextGraph ?? oldGraph;
        if (!graph) return { status: 'conflict', reason: 'revision' };
        if (!nextGraph) {
          if (
            (await transaction
              .model(GRAPH)
              .update({ write_nonce: randomUUID() })
              .where({ id: graphId, revision: input.expectedRevision })) !== 1
          )
            throw new CasConflict('revision');
        } else if (current) {
          const changed = await transaction
            .model(GRAPH)
            .update({
              revision: graph.revision,
              value: graph,
              write_nonce: randomUUID(),
            })
            .where({ id: graphId, revision: input.expectedRevision });
          if (changed !== 1) throw new CasConflict('revision');
        } else {
          try {
            await transaction.model(GRAPH).insert({
              id: graphId,
              revision: graph.revision,
              value: graph,
              write_nonce: randomUUID(),
            });
          } catch (error) {
            if (uniqueConflict(error)) throw new CasConflict('revision');
            throw error;
          }
        }
        for (const write of input.credentials ?? [])
          await this.#writeCredential({
            transaction,
            rootId: input.rootId,
            write,
            before: oldGraph ?? graph,
            after: graph,
          });
        const receipt: ProviderMutationReceipt = {
          rootId: input.rootId,
          mutationId: input.mutationId,
          fingerprint: input.fingerprint,
          graphRevision: graph.revision,
          result: structuredClone(input.result),
        };
        await transaction.model(MUTATION).insert({
          id: key([input.rootId, input.mutationId]),
          revision: graph.revision,
          value: receipt,
        });
        return { status: 'committed', receipt, replayed: false };
      });
    } catch (error) {
      // A transaction may have committed before its acknowledgement was lost. Only its receipt proves that result.
      try {
        const receipt = await this.readMutation(input);
        if (receipt)
          return receipt.fingerprint === input.fingerprint
            ? { status: 'committed', receipt, replayed: true }
            : { status: 'conflict', reason: 'mutation-content' };
        if (error instanceof CasConflict) return { status: 'conflict', reason: error.reason };
      } catch {
        /* Lookup failure is still unknown, never absence or an invitation to replay. */
      }
      return { status: 'commit-unknown' };
    }
  }

  async commitCredential(
    input: Readonly<{ rootId: string; write: ProviderCredentialWrite }>
  ): Promise<ProviderCredentialCommitResult> {
    try {
      this.#model(CREDENTIAL);
    } catch {
      return { status: 'not-committed' };
    }
    try {
      await this.options.database.transaction!(async (transaction) => {
        const stored = await read(transaction.model(GRAPH), key([input.rootId]));
        if (!stored) throw new CasConflict('credential');
        const graph = this.options.normalizeGraph(stored.value);
        // Lock the same physical row as graph replacement. REPEATABLE_READ alone permits a
        // refresh to write a different row after concurrently deleting its account.
        if (
          (await transaction
            .model(GRAPH)
            .update({ write_nonce: randomUUID() })
            .where({ id: key([input.rootId]), revision: graph.revision })) !== 1
        )
          throw new CasConflict('credential');
        await this.#writeCredential({
          transaction,
          rootId: input.rootId,
          write: input.write,
          before: graph,
          after: graph,
        });
      });
      return { status: 'committed' };
    } catch (error) {
      if (error instanceof CasConflict) return { status: 'conflict' };
      // Credential exchanges are not replayed: a lost refresh result can already have rotated the upstream token.
      return { status: 'commit-unknown' };
    }
  }

  /** Compare private versions while holding the graph's transaction fence. */
  async #writeCredential(
    input: Readonly<{
      transaction: DatabaseHostTransaction;
      rootId: string;
      write: ProviderCredentialWrite;
      before: ProviderGraph;
      after: ProviderGraph;
    }>
  ): Promise<void> {
    const { transaction, rootId, write, before, after } = input;
    const account =
      before.accounts[write.accountId] ??
      (write.expectedRevision === 0 ? after.accounts[write.accountId] : undefined);
    if (!account || account.incarnation !== write.expectedIncarnation)
      throw new CasConflict('credential');
    const id = key([rootId, write.accountId]);
    const current = await read(transaction.model(CREDENTIAL), id);
    const old = current ? parseCredential(current.value) : undefined;
    if (
      (old?.revision ?? 0) !== write.expectedRevision ||
      (old &&
        (old.incarnation !== write.expectedIncarnation ||
          (write.expectedAuthContractVersion !== undefined &&
            old.authContractVersion !== write.expectedAuthContractVersion)))
    ) {
      throw new CasConflict('credential');
    }
    if (write.record === null) {
      // Local disconnect is a versioned private tombstone, not absence. Only removal
      // of the account from the same graph transaction may erase its credential row.
      if (after.accounts[write.accountId]) throw new CasConflict('credential');
      if (
        current &&
        (await transaction.model(CREDENTIAL).delete().where({ id, revision: current.revision })) !==
          1
      ) {
        throw new CasConflict('credential');
      }
      return;
    }
    const next = parseCredential(write.record);
    if (
      next.rootId !== rootId ||
      next.accountId !== write.accountId ||
      after.accounts[write.accountId]?.incarnation !== next.incarnation ||
      next.incarnation !== write.expectedIncarnation ||
      next.revision !== write.expectedRevision + 1
    ) {
      throw new InferenceStoreError('integrity');
    }
    if (current) {
      if (
        (await transaction
          .model(CREDENTIAL)
          .update({ revision: next.revision, value: next })
          .where({ id, revision: current.revision })) !== 1
      )
        throw new CasConflict('credential');
    } else {
      try {
        await transaction.model(CREDENTIAL).insert({ id, revision: next.revision, value: next });
      } catch (error) {
        if (uniqueConflict(error)) throw new CasConflict('credential');
        throw error;
      }
    }
  }
}

function uniqueConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as {
    code?: string;
    errno?: number;
    errcode?: number;
    cause?: unknown;
  };
  return (
    ['23505', 'ER_DUP_ENTRY', 'SQLITE_CONSTRAINT_PRIMARYKEY', 'SQLITE_CONSTRAINT_UNIQUE'].includes(
      value.code ?? ''
    ) ||
    value.errno === 1062 ||
    (value.code === 'ERR_SQLITE_ERROR' && [1555, 2067].includes(value.errcode ?? 0)) ||
    (value.cause !== undefined && uniqueConflict(value.cause))
  );
}
