import { createHash, randomUUID } from 'node:crypto';
import { decodeStorageIdentity, encodeStorageIdentity, type DatabaseHost, type DatabaseHostModel } from '@zhin.js/plugin-runtime';
import type { SandboxWorkspaceScope } from './sandbox-workspace-scope.js';

const TABLE = 'console_conversations';
const FIELDS = ['conversation_id', 'conversation_kind', 'name', 'run_config', 'revision', 'updated_at'];

/** Host-owned Console metadata; canonical conversation events remain the message source. */
export function defineWorkspaceConversationTable(database: DatabaseHost): void {
  if (!['sqlite', 'mysql', 'pg'].includes(database.dialect)) return;
  database.define(TABLE, {
    id: { type: 'text', length: 64, primary: true, nullable: false },
    endpoint_adapter: { type: 'text', nullable: false },
    endpoint_id: { type: 'text', nullable: false },
    owner_id: { type: 'text', nullable: false },
    conversation_id: { type: 'text', nullable: false },
    conversation_kind: { type: 'text', nullable: false },
    name: { type: 'text', nullable: false },
    run_config: { type: 'text', nullable: false },
    revision: { type: 'text', length: 36, nullable: false },
    updated_at: { type: 'bigint', nullable: false },
  });
}

export interface WorkspaceConversationInput {
  readonly id: string;
  readonly type: 'private' | 'group' | 'channel';
  readonly name: string;
  readonly runConfig: Readonly<{
    workingDirectory: string;
    safetyMode: 'read-only' | 'workspace-write' | 'danger-full-access';
    approvalMode: 'ask' | 'auto' | 'bypass';
    networkAccess: boolean;
  }>;
}

export interface WorkspaceConversation extends WorkspaceConversationInput {
  readonly revision: string;
  readonly updatedAt: number;
}

export class WorkspaceStoreUnavailableError extends Error {
  readonly code = 'workspace_store_unavailable';
  constructor() { super('当前 Host 未提供会话目录存储'); }
}

export class WorkspaceRevisionConflictError extends Error {
  readonly code = 'revision_conflict';
  constructor() { super('会话已在其他页面更新，请读取最新配置后再保存'); }
}

export async function listWorkspaceConversations(database: DatabaseHost | undefined, scope: SandboxWorkspaceScope): Promise<readonly WorkspaceConversation[]> {
  const model = requireStore(database);
  const rows = await model.select(...FIELDS).where(scopeFields(scope)).orderBy('updated_at', 'DESC').orderBy('id', 'ASC');
  return rows.map(row => ({ id: decodeStorageIdentity(row.conversation_id), type: row.conversation_kind as WorkspaceConversation['type'],
    name: String(row.name), runConfig: JSON.parse(String(row.run_config)) as WorkspaceConversation['runConfig'],
    revision: String(row.revision), updatedAt: Number(row.updated_at) }));
}

/** One explicit compare-and-swap; neither contention nor uncertain writes are replayed. */
export async function saveWorkspaceConversation(database: DatabaseHost | undefined, scope: SandboxWorkspaceScope,
  input: WorkspaceConversationInput, expectedRevision: string | null): Promise<WorkspaceConversation> {
  requireStore(database);
  const id = createHash('sha256').update(JSON.stringify([scope.endpoint.adapter, scope.endpoint.id, scope.ownerId, input.type, input.id])).digest('hex');
  const item: WorkspaceConversation = { ...input, revision: randomUUID(), updatedAt: Date.now() };
  const row = { ...scopeFields(scope), conversation_id: encodeStorageIdentity(item.id), conversation_kind: item.type,
    name: item.name, run_config: JSON.stringify(item.runConfig), revision: item.revision, updated_at: item.updatedAt };
  try {
    await database!.transaction!(async transaction => {
      const model = transaction.model(TABLE);
      const [previous] = await model.select('revision').where({ id });
      if ((previous?.revision ?? null) !== expectedRevision) throw new WorkspaceRevisionConflictError();
      if (!previous) await model.insert({ id, ...row });
      else if (await model.update(row).where({ id, revision: expectedRevision }) !== 1) throw new WorkspaceRevisionConflictError();
    });
  } catch (error) {
    if (isUniqueConflict(error)) throw new WorkspaceRevisionConflictError();
    throw error;
  }
  return item;
}

function requireStore(database: DatabaseHost | undefined): DatabaseHostModel {
  if (!database?.started || !database.transaction || !['sqlite', 'mysql', 'pg'].includes(database.dialect)) throw new WorkspaceStoreUnavailableError();
  const model = database.models.get(TABLE);
  if (!model) throw new WorkspaceStoreUnavailableError();
  return model;
}

function scopeFields(scope: SandboxWorkspaceScope): Record<string, string> {
  return { endpoint_adapter: encodeStorageIdentity(scope.endpoint.adapter), endpoint_id: encodeStorageIdentity(scope.endpoint.id), owner_id: encodeStorageIdentity(scope.ownerId) };
}

function isUniqueConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const failure = error as { code?: string; errno?: number; errcode?: number; cause?: unknown };
  return failure.code === '23505' || failure.code === 'ER_DUP_ENTRY' || failure.errno === 1062
    || failure.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || failure.code === 'SQLITE_CONSTRAINT_UNIQUE'
    || (failure.code === 'ERR_SQLITE_ERROR' && (failure.errcode === 1555 || failure.errcode === 2067))
    || (failure.cause !== undefined && isUniqueConflict(failure.cause));
}
