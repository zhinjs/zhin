import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseDocument } from 'yaml';
import {
  ROOT_CONFIG_FILE_NAMES,
  selectRootConfigFile,
  rootPluginId,
} from '@zhin.js/plugin-runtime';
import { personalSessionOwnerId } from '@zhin.js/agent/personal-session';
import { hostModelOwnerId } from './host-identity.js';
import { normalizeProviderJson, type JsonObject } from '@zhin.js/ai/provider';

export interface LegacyStateSourceRow {
  readonly id: string;
  readonly revision: string;
  readonly value: JsonObject;
  readonly expiresAt: null;
}
export interface LegacyInferenceSources {
  readonly rootId: string;
  readonly configFile: string;
  readonly source: string;
  readonly document: JsonObject;
  readonly database: JsonObject;
  readonly stateRows: readonly LegacyStateSourceRow[];
  readonly stateSource: 'sqlite-read-only' | 'explicit-snapshot' | 'database-not-created';
  /** Private source stamp; not a public hash of credential material. */
  readonly stamp: string;
}
export interface LegacyInferenceReadOptions {
  readonly root: string;
  /** Explicit metadata backup for non-SQLite sources. Never a credential cache or dotenv file. */
  readonly stateSnapshot?: string;
  /** Explicit private database connection document for offline operation, never a dotenv layer. */
  readonly databaseConfig?: string;
  /** Exact original Session state keys for an explicit manual binding preview. */
  readonly selectedSessions?: readonly string[];
}
const digest = (value: unknown): string =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
/** Original PersistentState address format, used only by this offline reader. */
export const legacyPluginStateId = (key: string): string =>
  digest([rootPluginId(), ['plugin'], key]);
export const legacyCatalogStateKey = (ownerId: string): string =>
  `personal-catalog:v1:${digest(ownerId)}`;
export const legacyRuntimePolicyStateKey = (rootId: string, ownerId: string): string =>
  `runtime-model-policy:v1:${digest([rootId, ownerId])}`;
function object(input: unknown): JsonObject {
  const value = normalizeProviderJson(input);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid migration metadata');
  return value as JsonObject;
}
function stateRows(input: unknown): readonly LegacyStateSourceRow[] {
  if (!Array.isArray(input)) throw new Error('Invalid legacy state snapshot');
  const ids = new Set<string>();
  return input.map((raw) => {
    const row = object(raw);
    if (
      typeof row.id !== 'string' ||
      typeof row.revision !== 'string' ||
      row.expiresAt !== null ||
      ids.has(row.id)
    )
      throw new Error('Invalid legacy state source identity');
    ids.add(row.id);
    return {
      id: row.id,
      revision: row.revision,
      value: object(row.value),
      expiresAt: null,
    };
  });
}
/** Reads only declared Root source and old state metadata. No environment or executable plugin is loaded. */
export async function readLegacyInferenceSources(
  options: LegacyInferenceReadOptions
): Promise<LegacyInferenceSources> {
  const rootId = resolve(options.root);
  const selected = selectRootConfigFile(
    (await readdir(rootId)).filter((name) =>
      ROOT_CONFIG_FILE_NAMES.includes(name as (typeof ROOT_CONFIG_FILE_NAMES)[number])
    )
  );
  if (!selected)
    throw new Error('Select a Root YAML/JSON configuration before migrating inference');
  const configFile = join(rootId, selected),
    source = await readFile(configFile, 'utf8');
  const ast = parseDocument(source, { uniqueKeys: true });
  if (ast.errors.length) throw new Error('Root configuration cannot be parsed');
  const document = object(ast.toJS({ maxAliasCount: 100 }));
  if (document.configVersion !== 2)
    throw new Error('Run zhin migrate instances before inference migration');
  let configured = document.database === undefined ? {} : object(document.database);
  let connectionSource = '';
  if (options.databaseConfig) {
    if (/^\.env(?:\.|$)/u.test(basename(options.databaseConfig)))
      throw new Error('Dotenv files are not migration connection documents');
    connectionSource = await readFile(resolve(options.databaseConfig), 'utf8');
    try {
      configured = object(JSON.parse(connectionSource));
    } catch {
      throw new Error('Invalid explicit database connection document');
    }
  }
  const database: Record<string, import('@zhin.js/plugin-runtime').JsonValue> = {
    ...configured,
    dialect: configured.dialect ?? 'sqlite',
  };
  if (database.dialect === 'sqlite') {
    const filename = database.filename ?? join(rootId, '.zhin', 'data.sqlite');
    if (typeof filename !== 'string' || filename.includes('${'))
      throw new Error('Provide a non-environment SQLite source filename');
    database.filename = isAbsolute(filename) ? filename : resolve(rootId, filename);
  }
  const ai =
    document.ai && typeof document.ai === 'object' && !Array.isArray(document.ai)
      ? object(document.ai)
      : {};
  const principals = object(ai.personalPrincipals ?? {}),
    owners = new Set<string>();
  for (const entries of Object.values(principals)) {
    if (!Array.isArray(entries)) throw new Error('Invalid static personal identity binding');
    for (const raw of entries) {
      const owner = object(raw);
      if (owner.rootId !== rootId)
        throw new Error('Static personal identity binding belongs to another Root');
      owners.add(
        personalSessionOwnerId(owner as unknown as Parameters<typeof personalSessionOwnerId>[0])
      );
    }
  }
  const selectedSessionIds = options.selectedSessions
    ? new Set(options.selectedSessions.map(legacyPluginStateId))
    : undefined;
  const selectedIds = new Set([
    legacyPluginStateId(legacyRuntimePolicyStateKey(rootId, hostModelOwnerId(rootId))),
    ...[...owners].map((owner) => legacyPluginStateId(legacyCatalogStateKey(owner))),
  ]);
  const belongsToSelectedRoot = (row: LegacyStateSourceRow, explicit: boolean): boolean => {
    if (selectedIds.has(row.id)) return true;
    const value = row.value;
    if (value.kind === 'runtime-model-policy')
      return value.rootId === rootId || (explicit && value.rootId === undefined);
    if (value.kind === 'personal-catalog') return owners.has(String(value.ownerId)) || explicit;
    if (value.kind === 'personal-session') {
      if (value.version === 2) return false;
      const state = object(value.state ?? {}),
        identity = object(state.identity ?? {}),
        address = object(identity.address ?? {}),
        owner = object(identity.owner ?? {});
      return (
        address.rootId === rootId ||
        owner.rootId === rootId ||
        (explicit && address.rootId === undefined && owner.rootId === undefined)
      );
    }
    return false;
  };
  let rows: readonly LegacyStateSourceRow[] = [],
    stateSource: LegacyInferenceSources['stateSource'];
  if (options.stateSnapshot) {
    if (/^\.env(?:\.|$)/u.test(basename(options.stateSnapshot)))
      throw new Error('Dotenv files are not migration metadata snapshots');
    let snapshot: JsonObject;
    try {
      snapshot = object(JSON.parse(await readFile(resolve(options.stateSnapshot), 'utf8')));
    } catch {
      throw new Error('Invalid explicit state metadata snapshot');
    }
    if (snapshot.version !== 1 || snapshot.rootId !== rootId)
      throw new Error('State snapshot belongs to another Root');
    rows = stateRows(snapshot.rows).filter(
      (row) =>
        belongsToSelectedRoot(row, true) && (!selectedSessionIds || selectedSessionIds.has(row.id))
    );
    stateSource = 'explicit-snapshot';
  } else {
    if (database.dialect !== 'sqlite')
      throw new Error(
        'Non-SQLite migration preview requires an explicit metadata snapshot; no .env or remote database is read'
      );
    const filename = String(database.filename);
    let exists = true;
    try {
      await stat(filename);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') exists = false;
      else throw error;
    }
    if (!exists) stateSource = 'database-not-created';
    else {
      const db = new DatabaseSync(filename, { readOnly: true });
      try {
        const present = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__zhin_persistent_state'"
          )
          .get();
        if (present) {
          const found = db
            .prepare(
              `SELECT id, revision, value, expires_at FROM __zhin_persistent_state
            WHERE (id IN (SELECT value FROM json_each(?))
              OR (CASE WHEN json_valid(value) THEN json_extract(value, '$.kind') END = 'runtime-model-policy'
                AND CASE WHEN json_valid(value) THEN json_extract(value, '$.rootId') END = ?)
              OR (CASE WHEN json_valid(value) THEN json_extract(value, '$.kind') END = 'personal-catalog'
                AND CASE WHEN json_valid(value) THEN json_extract(value, '$.ownerId') END IN (SELECT value FROM json_each(?)))
              OR (CASE WHEN json_valid(value) THEN json_extract(value, '$.kind') END = 'personal-session'
                AND CASE WHEN json_valid(value) THEN json_extract(value, '$.version') END IS NOT 2
                AND (CASE WHEN json_valid(value) THEN json_extract(value, '$.state.identity.address.rootId') END = ?
                  OR CASE WHEN json_valid(value) THEN json_extract(value, '$.state.identity.owner.rootId') END = ?))
            ) ${selectedSessionIds ? 'AND id IN (SELECT value FROM json_each(?))' : ''}
            ORDER BY id`
            )
            .iterate(
              JSON.stringify([...selectedIds]),
              rootId,
              JSON.stringify([...owners]),
              rootId,
              rootId,
              ...(selectedSessionIds ? [JSON.stringify([...selectedSessionIds])] : [])
            );
          const retained: LegacyStateSourceRow[] = [];
          for (const row of found) {
            let parsed: unknown;
            try {
              parsed = JSON.parse(String(row.value));
            } catch {
              throw new Error('Selected legacy state source contains damaged JSON');
            }
            const entry = stateRows([
              {
                id: row.id,
                revision: row.revision,
                value: parsed,
                expiresAt: row.expires_at,
              },
            ])[0];
            if (belongsToSelectedRoot(entry, false)) retained.push(entry);
          }
          rows = retained;
        }
        stateSource = 'sqlite-read-only';
      } finally {
        db.close();
      }
    }
  }
  const stamp = createHash('sha256')
    .update(JSON.stringify([source, connectionSource, rows]))
    .digest('hex');
  return {
    rootId,
    configFile,
    source,
    document,
    database: object(database),
    stateRows: rows,
    stateSource,
    stamp,
  };
}
