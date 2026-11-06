import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  normalizeProviderJson,
  providerPlanFingerprint,
  resolveProviderProfile,
  type JsonObject,
  type ProviderGraph,
} from "@zhin.js/ai/provider";
import {
  freezePersonalSessionSelection,
  personalSessionIdentity,
  personalSessionOwnerId,
  type PersonalSessionIdentity,
  type PersonalSessionSelection,
  type PersonalSessionOwner,
} from "../../personal-session/index.js";
import {
  normalizeDatabaseHostConfig,
  type DatabaseHostConfig,
} from "@zhin.js/core/runtime";
import { readPrivateDocument, rootPluginId } from "@zhin.js/plugin-runtime";
import { openHeadlessInferenceHost } from "./headless-host.js";
import { readStoredInferenceGraph } from "./repository.js";
import { hostModelOwnerId } from "./host-identity.js";
import { writePrivateMigrationRecord } from "./migration-record.js";
import {
  applyMigrationSessionJournal,
  type MigrationSessionJournal,
} from "./migration-session-journal.js";

export interface SessionMigrationStateSourceRow {
  readonly id: string;
  readonly revision: string;
  readonly value: JsonObject;
  readonly expiresAt: null;
}
export interface SessionMigrationLegacySources {
  readonly rootId: string;
  readonly configFile: string;
  readonly source: string;
  readonly document: JsonObject;
  readonly database: JsonObject;
  readonly stateRows: readonly SessionMigrationStateSourceRow[];
  readonly stateSource: "sqlite-read-only" | "explicit-snapshot" | "database-not-created";
  readonly stamp: string;
}
export interface SessionMigrationReadOptions {
  readonly root: string;
  readonly stateSnapshot?: string;
  readonly databaseConfig?: string;
  readonly selectedSessions?: readonly string[];
}
const legacyPluginStateId = (key: string): string =>
  createHash("sha256")
    .update(JSON.stringify([rootPluginId(), ["plugin"], key]))
    .digest("hex");

export interface SessionBindingsMapping {
  readonly version: 1;
  /** Exact original identity.key, never a display alias or a new Session key. */
  readonly sessions: Readonly<
    Record<
      string,
      Readonly<{ sourceRevision: string; selection: PersonalSessionSelection }>
    >
  >;
}
export interface SessionBindingsPreview {
  readonly version: 1;
  readonly mode: "sessions";
  readonly id: string;
  readonly rootId: string;
  readonly stateSource: SessionMigrationLegacySources["stateSource"];
  readonly targetValidation: "verified-local" | "deferred-until-apply";
  /** File locators only; database credentials and Root-content hashes are not public. */
  readonly source: Readonly<{
    stateSnapshot?: string;
    databaseConfig?: string;
  }>;
  readonly sessions: readonly Readonly<
    Omit<MigrationSessionJournal, "status">
  >[];
  readonly fingerprint: string;
}
export interface PreviewSessionBindingsOptions
  extends Omit<SessionMigrationReadOptions, "selectedSessions"> {
  readonly mapping: unknown;
}
export interface ApplySessionBindingsOptions {
  readonly preview: SessionBindingsPreview;
  readonly maintenance: boolean;
  readonly backupConfirmed: boolean;
}
export interface SessionBindingsRunView {
  readonly id: string;
  readonly phase: "committed" | "unknown" | "conflict";
  readonly migratedSessions: number;
}
interface SessionJournal {
  readonly version: 1;
  readonly mode: "sessions";
  readonly id: string;
  readonly rootId: string;
  readonly fingerprint: string;
  /** Private connection consistency evidence. Never returned in the public preview. */
  readonly databaseFingerprint: string;
  readonly sessions: MigrationSessionJournal[];
}
function object(value: unknown): JsonObject {
  const normalized = normalizeProviderJson(value);
  if (
    !normalized ||
    typeof normalized !== "object" ||
    Array.isArray(normalized)
  )
    throw new Error("Invalid Session binding metadata");
  return normalized as JsonObject;
}
function exact(value: JsonObject, keys: readonly string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error("Unknown Session binding field");
}
function identity(value: unknown, rootId: string): PersonalSessionIdentity {
  const raw = object(value);
  const canonical = personalSessionIdentity(
    object(raw.address) as unknown as Parameters<
      typeof personalSessionIdentity
    >[0]
  );
  if (
    canonical.address.rootId !== rootId ||
    providerPlanFingerprint(canonical) !== providerPlanFingerprint(raw)
  )
    throw new Error("Session source identity does not match its Root/address");
  return canonical;
}
function selection(value: unknown): PersonalSessionSelection {
  const raw = object(value);
  const selected = freezePersonalSessionSelection(
    raw as unknown as PersonalSessionSelection
  );
  if (providerPlanFingerprint(raw) !== providerPlanFingerprint(selected))
    throw new Error("Incomplete or unknown Session Profile identity");
  return selected;
}
function staticOwners(
  source: SessionMigrationLegacySources
): readonly PersonalSessionOwner[] {
  const owners: PersonalSessionOwner[] = [];
  const bindings = object(
    object(source.document.ai ?? {}).personalPrincipals ?? {}
  );
  for (const entries of Object.values(bindings)) {
    if (!Array.isArray(entries))
      throw new Error("Invalid static personal identity binding");
    for (const value of entries) {
      const owner = object(value) as unknown as PersonalSessionOwner;
      if (owner.rootId !== source.rootId)
        throw new Error("Static personal owner belongs to another Root");
      personalSessionOwnerId(owner);
      owners.push(owner);
    }
  }
  return owners;
}
function authorizeTarget(
  input: Readonly<{
    source: SessionMigrationLegacySources;
    graph: ProviderGraph | undefined;
    identity: PersonalSessionIdentity;
    selection: PersonalSessionSelection;
    deferTarget?: boolean;
  }>
): void {
  const ownerId = personalSessionOwnerId(input.identity.owner);
  if (
    !staticOwners(input.source).some(
      (owner) => personalSessionOwnerId(owner) === ownerId
    )
  )
    throw new Error("Session owner is not statically bound in this Root");
  if (input.selection.kind === "inherit") return;
  if (input.selection.profile.rootId !== input.source.rootId)
    throw new Error("Target Profile belongs to another Root");
  if (input.deferTarget) return;
  if (!input.graph)
    throw new Error(
      "Configure the target Profile before binding a legacy Session"
    );
  resolveProviderProfile({
    graph: input.graph,
    kind: "language",
    purpose: "chat",
    context: {
      rootId: input.source.rootId,
      hostOwnerId: hostModelOwnerId(input.source.rootId),
      ownerId,
      operationId: "offline-session-binding",
      sessionKey: input.identity.key,
      sessionChat: input.selection.profile,
    },
  });
}
function originalSession(
  value: unknown,
  rootId: string
): Readonly<{
  identity: PersonalSessionIdentity;
  revision: number;
  before: JsonObject;
}> {
  const raw = object(value),
    state = object(raw.state),
    canonical = identity(state.identity, rootId),
    oldSelection = object(state.selection);
  if (
    raw.kind !== "personal-session" ||
    raw.version !== 1 ||
    !Number.isSafeInteger(state.revision) ||
    Number(state.revision) < 1 ||
    Number(state.revision) >= Number.MAX_SAFE_INTEGER
  )
    throw new Error("Expected a version-1 Session selection");
  if (oldSelection.kind === "inherit") exact(oldSelection, ["kind"]);
  else if (
    oldSelection.kind === "preset" &&
    typeof oldSelection.presetId === "string" &&
    oldSelection.presetId.trim()
  )
    exact(oldSelection, ["kind", "presetId"]);
  else throw new Error("Invalid legacy Session selection");
  const before = object({
    version: 1,
    kind: "personal-session",
    state: {
      identity: canonical,
      revision: state.revision,
      selection: oldSelection,
    },
  });
  if (providerPlanFingerprint(raw) !== providerPlanFingerprint(before))
    throw new Error("Unexpected legacy Session state fields");
  return { identity: canonical, revision: Number(state.revision), before };
}
function previewFingerprint(
  preview: Omit<SessionBindingsPreview, "fingerprint">
): string {
  return providerPlanFingerprint(preview);
}
function checkedPreview(input: unknown): SessionBindingsPreview {
  const raw = object(input);
  exact(raw, [
    "version",
    "mode",
    "id",
    "rootId",
    "stateSource",
    "targetValidation",
    "source",
    "sessions",
    "fingerprint",
  ]);
  if (
    raw.version !== 1 ||
    raw.mode !== "sessions" ||
    typeof raw.id !== "string" ||
    !/^[a-f0-9-]{36}$/u.test(raw.id) ||
    typeof raw.rootId !== "string" ||
    resolve(raw.rootId) !== raw.rootId ||
    typeof raw.fingerprint !== "string" ||
    !["verified-local", "deferred-until-apply"].includes(
      String(raw.targetValidation)
    ) ||
    !["sqlite-read-only", "explicit-snapshot", "database-not-created"].includes(
      String(raw.stateSource)
    ) ||
    !Array.isArray(raw.sessions) ||
    !raw.sessions.length
  )
    throw new Error("Invalid Session binding preview");
  const source = object(raw.source);
  exact(source, ["stateSnapshot", "databaseConfig"]);
  for (const value of Object.values(source))
    if (typeof value !== "string" || resolve(value) !== value)
      throw new Error("Invalid Session source locator");
  const keys = new Set<string>();
  for (const item of raw.sessions) {
    const entry = object(item);
    exact(entry, ["sourceId", "key", "sourceRevision", "before", "after"]);
    const old = originalSession(entry.before, raw.rootId),
      after = object(entry.after),
      state = object(after.state);
    if (
      typeof entry.key !== "string" ||
      entry.key !== old.identity.key ||
      entry.sourceId !== legacyPluginStateId(entry.key) ||
      typeof entry.sourceRevision !== "string" ||
      !entry.sourceRevision ||
      keys.has(entry.key)
    )
      throw new Error("Invalid original Session locator");
    keys.add(entry.key);
    const target = object({
      version: 2,
      kind: "personal-session",
      state: {
        identity: old.identity,
        revision: old.revision + 1,
        selection: selection(state.selection),
      },
    });
    if (providerPlanFingerprint(after) !== providerPlanFingerprint(target))
      throw new Error("Invalid target Session content");
  }
  const { fingerprint, ...publicData } = raw;
  if (
    previewFingerprint(
      publicData as unknown as Omit<SessionBindingsPreview, "fingerprint">
    ) !== fingerprint
  )
    throw new Error("Session preview changed; review the exact mapping again");
  return raw as unknown as SessionBindingsPreview;
}
export interface SessionBindingsApplyHooks {
  readonly readLegacySources: (
    options: SessionMigrationReadOptions
  ) => Promise<SessionMigrationLegacySources>;
  readonly assertStopped: (root: string) => Promise<void>;
  readonly withProjectLock: <T>(
    root: string,
    operation: () => Promise<T>
  ) => Promise<T>;
  readonly openHeadlessInferenceHost?: typeof openHeadlessInferenceHost;
  readonly applyMigrationSessionJournal?: typeof applyMigrationSessionJournal;
}

/** Reads only explicitly selected v1 state. No credential vault, Driver or plugin is opened. */
export async function previewSessionBindingsFromSources(
  options: PreviewSessionBindingsOptions,
  readLegacySources: (
    options: SessionMigrationReadOptions
  ) => Promise<SessionMigrationLegacySources>
): Promise<SessionBindingsPreview> {
  const mapping = object(options.mapping);
  exact(mapping, ["version", "sessions"]);
  if (mapping.version !== 1)
    throw new Error("Unsupported Session bindings version");
  const requested = object(mapping.sessions),
    keys = Object.keys(requested);
  if (!keys.length) throw new Error("Select at least one original Session key");
  const source = await readLegacySources({
    ...options,
    selectedSessions: keys,
  });
  if (source.stateSource === "database-not-created")
    throw new Error("An existing Session database is required");
  const targetValidation =
    source.database.dialect === "sqlite"
      ? "verified-local"
      : "deferred-until-apply";
  const graph =
    targetValidation === "verified-local"
      ? readStoredInferenceGraph({
          database: source.database,
          rootId: source.rootId,
        })
      : undefined;
  const sessions: SessionBindingsPreview["sessions"][number][] = [];
  for (const key of keys) {
    const item = object(requested[key]);
    exact(item, ["sourceRevision", "selection"]);
    const row = source.stateRows.find(
      (value) => value.id === legacyPluginStateId(key)
    );
    if (!row || item.sourceRevision !== row.revision)
      throw new Error("Original Session revision is missing or changed");
    const old = originalSession(row.value, source.rootId);
    if (old.identity.key !== key)
      throw new Error(
        "Selected Session key does not match its canonical identity"
      );
    const selected = selection(item.selection);
    authorizeTarget({
      source,
      graph,
      identity: old.identity,
      selection: selected,
      deferTarget: targetValidation === "deferred-until-apply",
    });
    sessions.push({
      sourceId: row.id,
      key,
      sourceRevision: row.revision,
      before: old.before,
      after: object({
        version: 2,
        kind: "personal-session",
        state: {
          identity: old.identity,
          revision: old.revision + 1,
          selection: selected,
        },
      }),
    });
  }
  const data: Omit<SessionBindingsPreview, "fingerprint"> = {
    version: 1,
    mode: "sessions",
    id: randomUUID(),
    rootId: source.rootId,
    stateSource: source.stateSource,
    targetValidation,
    source: {
      ...(options.stateSnapshot
        ? { stateSnapshot: resolve(options.stateSnapshot) }
        : {}),
      ...(options.databaseConfig
        ? { databaseConfig: resolve(options.databaseConfig) }
        : {}),
    },
    sessions,
  };
  return checkedPreview({ ...data, fingerprint: previewFingerprint(data) });
}
export async function readSessionBindingsPreview(
  file: string
): Promise<SessionBindingsPreview> {
  return checkedPreview(JSON.parse(await readFile(file, "utf8")));
}
/** Maintenance-only state migration. A durable intent precedes every CAS; unknown
 * writes are read back on resume and never replayed with another operation id. */
export async function applySessionBindingsWithSources(
  options: ApplySessionBindingsOptions,
  hooks: SessionBindingsApplyHooks
): Promise<SessionBindingsRunView> {
  const preview = checkedPreview(options.preview);
  if (!options.maintenance || !options.backupConfirmed)
    throw new Error(
      "Confirm maintenance and an operator database/configuration backup"
    );
  await hooks.assertStopped(preview.rootId);
  return hooks.withProjectLock(preview.rootId, async () => {
    const directory = join(
        preview.rootId,
        ".zhin",
        "inference-session-bindings",
        preview.id
      ),
      filename = "journal.json";
    let journal: SessionJournal | undefined;
    try {
      journal = (await readPrivateDocument(
        join(directory, filename)
      )) as SessionJournal;
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        throw error;
    }
    if (
      journal &&
      (journal.version !== 1 ||
        journal.mode !== "sessions" ||
        journal.id !== preview.id ||
        journal.rootId !== preview.rootId ||
        journal.fingerprint !== preview.fingerprint ||
        !Array.isArray(journal.sessions) ||
        journal.sessions.some(entry => !entry || !['prepared', 'unknown', 'conflict', 'committed'].includes(entry.status)) ||
        providerPlanFingerprint(
          journal.sessions.map(({ status: _status, ...entry }) => entry)
        ) !== providerPlanFingerprint(preview.sessions))
    )
      throw new Error("Session migration journal does not match this preview");
    if (
      journal &&
      journal.sessions.every((entry) => entry.status === "committed")
    ) {
      return {
        id: preview.id,
        phase: "committed",
        migratedSessions: journal.sessions.length,
      };
    }
    const source = await hooks.readLegacySources({
      root: preview.rootId,
      ...preview.source,
      selectedSessions: preview.sessions.map((entry) => entry.key),
    });
    const databaseFingerprint = providerPlanFingerprint(source.database);
    if (journal && journal.databaseFingerprint !== databaseFingerprint)
      throw new Error("Session migration database connection changed");
    const openHost = hooks.openHeadlessInferenceHost ?? openHeadlessInferenceHost;
    const environment = await openHost({
      projectRoot: source.rootId,
      database: normalizeDatabaseHostConfig(
        source.database as unknown as DatabaseHostConfig
      ),
      resolveSource: () => {
        throw new Error("Session binding cannot read credentials");
      },
      officialDrivers: false,
    });
    try {
      const graph = await environment.host.repository.readGraph({
        rootId: source.rootId,
      });
      const pending =
        journal?.sessions ??
        preview.sessions.map((entry) => ({
          ...entry,
          status: "prepared" as const,
        }));
      // Authorize all not-yet-settled selections before the first state mutation.
      for (const entry of pending) {
        if (entry.status === "committed" || entry.status === "unknown")
          continue;
        const old = originalSession(entry.before, source.rootId),
          selected = selection(object(entry.after.state).selection);
        authorizeTarget({
          source,
          graph,
          identity: old.identity,
          selection: selected,
        });
        const row = source.stateRows.find(
          (value) => value.id === entry.sourceId
        );
        if (
          !row ||
          row.revision !== entry.sourceRevision ||
          providerPlanFingerprint(row.value) !==
            providerPlanFingerprint(entry.before)
        )
          throw new Error("Original Session changed after preview");
      }
      journal ??= {
        version: 1,
        mode: "sessions",
        id: preview.id,
        rootId: preview.rootId,
        fingerprint: preview.fingerprint,
        databaseFingerprint,
        sessions: pending,
      };
      const current = journal;
      const checkpoint = () =>
        writePrivateMigrationRecord({ directory, filename, document: current });
      await checkpoint();
      const state = environment.database.state;
      if (!state) throw new Error("Session persistence is unavailable");
      const applyJournal = hooks.applyMigrationSessionJournal ?? applyMigrationSessionJournal;
      const phase = await applyJournal({
        state,
        sessions: current.sessions,
        checkpoint,
      });
      return {
        id: preview.id,
        phase,
        migratedSessions: current.sessions.filter(
          (entry) => entry.status === "committed"
        ).length,
      };
    } finally {
      await environment.close();
    }
  });
}
