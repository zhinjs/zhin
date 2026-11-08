import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applyModelCapabilityDefaults, builtinAiProviders } from '@zhin.js/ai/providers';
import {
  normalizeProviderGraph,
  normalizeProviderJson,
  providerPlanFingerprint,
  type JsonObject,
  type ProviderService,
  type ProviderDefinition,
} from '@zhin.js/ai/provider';
import {
  createHostDocumentCipher,
  hostModelOwnerId,
  normalizeDeliveryTarget,
  readPrivateDocument,
  rootPluginId,
} from '@zhin.js/plugin-runtime';
import {
  compileLegacyInferenceMigration,
  type LegacyInferenceMigration,
  type LegacyServiceResolution,
} from '../../migration/index.js';
import {
  personalSessionIdentity,
  personalSessionOwnerId,
} from '../../personal-session/index.js';
import type {
  SessionMigrationLegacySources,
  SessionMigrationReadOptions,
} from './migration-session-bindings.js';
import { inferencePolicyKeys } from './turn-context.js';

const digest = (value: unknown): string =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');

export const legacyPluginStateId = (key: string): string =>
  digest([rootPluginId(), ['plugin'], key]);

export const legacyCatalogStateKey = (ownerId: string): string =>
  `personal-catalog:v1:${digest(ownerId)}`;

export const legacyRuntimePolicyStateKey = (rootId: string, ownerId: string): string =>
  `runtime-model-policy:v1:${digest([rootId, ownerId])}`;

export interface InferenceMigrationResolution {
  readonly driver: string;
  readonly options?: JsonObject;
  readonly models: JsonObject;
  readonly authentication: 'none' | 'api-key';
}

export interface InferenceMigrationMapping {
  readonly version: 1;
  /** Source unit id → original connection id → explicitly selected official Driver and model declarations. */
  readonly services: Readonly<
    Record<string, Readonly<Record<string, InferenceMigrationResolution>>>
  >;
  readonly sessions?: Readonly<Record<string, Readonly<{ unitId: string; profileAlias: string }>>>;
  readonly harnessTargets?: Readonly<
    Record<
      string,
      Readonly<Record<string, readonly Readonly<{ serviceAlias: string; model?: string }>[]>>
    >
  >;
}

export interface InferenceMigrationPreview {
  readonly version: 1;
  readonly id: string;
  readonly rootId: string;
  readonly sourceFile: string;
  readonly retiredFields: readonly string[];
  readonly stateSource: SessionMigrationLegacySources['stateSource'];
  readonly units: readonly Readonly<{
    id: string;
    ownerId: string;
    migration: LegacyInferenceMigration;
  }>[];
  readonly sessions: readonly Readonly<{
    sourceId: string;
    sourceRevision: string;
    identity: JsonObject;
    selection: JsonObject;
    target?: Readonly<{ unitId: string; profileAlias: string }>;
  }>[];
  readonly blocked: readonly Readonly<{ path: string; code: string }>[];
  readonly fingerprint: string;
  /** Encrypted private source stamp, never raw config/key values or a public credential hash. */
  readonly proof: JsonObject;
}

function object(value: unknown): JsonObject {
  const data = normalizeProviderJson(value);
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Invalid migration metadata');
  return data as JsonObject;
}

const hash = (value: unknown) => providerPlanFingerprint(normalizeProviderJson(value));

function mergePolicy(baseline: unknown, override: unknown): JsonObject {
  const base = object(baseline ?? {}),
    patch = object(override);
  const maps = (left: unknown, right: unknown) => {
    const previous = object(left ?? {}),
      current = object(right ?? {});
    return Object.fromEntries(
      [...new Set([...Object.keys(previous), ...Object.keys(current)])].map((key) => [
        key,
        { ...object(previous[key] ?? {}), ...object(current[key] ?? {}) },
      ]),
    );
  };
  const entries = (left: unknown, right: unknown) => {
    const merged = new Map<string, JsonObject>();
    for (const raw of [
      ...(Array.isArray(left) ? left : []),
      ...(Array.isArray(right) ? right : []),
    ]) {
      const entry = object(raw),
        key = hash(entry.address),
        previous = merged.get(key);
      merged.set(key, {
        ...entry,
        models: {
          ...object(previous?.models ?? {}),
          ...object(entry.models ?? {}),
        },
      });
    }
    return [...merged.values()];
  };
  return object({
    defaults: {
      ...object(base.defaults ?? {}),
      ...object(patch.defaults ?? {}),
    },
    adapters: maps(base.adapters, patch.adapters),
    endpoints: entries(base.endpoints, patch.endpoints),
    scenes: entries(base.scenes, patch.scenes),
  });
}

function serviceResolver(
  mapping: Readonly<Record<string, InferenceMigrationResolution>> | undefined,
  rootId: string,
  ownerId: string,
) {
  return (
    input: Parameters<Parameters<typeof compileLegacyInferenceMigration>[0]['resolveService']>[0],
  ): LegacyServiceResolution | undefined => {
    const selected = mapping?.[input.sourceId];
    if (!selected) return undefined;
    // Only the reviewed built-in declaration array is imported, never a project plugin's executable entry.
    const definitions: readonly ProviderDefinition<unknown, unknown>[] = builtinAiProviders;
    const definition = definitions.find((value) => value.id === selected.driver);
    if (
      !definition ||
      !['none', 'api-key'].includes(selected.authentication) ||
      !definition.authentication.methods.includes(selected.authentication)
    )
      return undefined;
    const reference = {
      id: definition.id,
      owner: 'root',
      contractVersion: definition.contractVersion,
    };
    const candidate = normalizeProviderGraph({
      rootId,
      revision: 0,
      services: {
        candidate: {
          id: 'candidate',
          rootId,
          ownerId,
          revision: 1,
          driver: reference,
          options: selected.options ?? input.options,
          models: selected.models,
        },
      },
      accounts: {},
      profiles: {},
      purposes: { defaults: {} },
    });
    const raw = candidate.services.candidate;
    const enrichedModels = Object.fromEntries(
      Object.entries(raw.models).map(([id, model]) => [
        id,
        applyModelCapabilityDefaults(model),
      ]),
    );
    const service: ProviderService = {
      ...raw,
      options: object(definition.serviceSchema.parse(raw.options)),
      models: enrichedModels,
    };
    return {
      driver: reference,
      options: service.options,
      models: definition.models(service),
      authentication: selected.authentication,
      parameters: ({ model, parameters }) =>
        object(definition.profileSchema?.({ service, model }).parse(parameters) ?? parameters),
    };
  };
}

export async function previewInferenceMigrationFromSources<
  TSources extends SessionMigrationLegacySources = SessionMigrationLegacySources,
>(
  options: SessionMigrationReadOptions & Readonly<{ mapping?: InferenceMigrationMapping }>,
  readLegacySources: (options: SessionMigrationReadOptions) => Promise<TSources>,
): Promise<InferenceMigrationPreview> {
  const source = await readLegacySources(options),
    id = randomUUID(),
    hostOwnerId = hostModelOwnerId(source.rootId);
  const ai = object(source.document.ai ?? {}),
    blocked: { path: string; code: string }[] = [];
  let deployment = ai;
  const units: InferenceMigrationPreview['units'][number][] = [],
    sessions: InferenceMigrationPreview['sessions'][number][] = [];
  const sourceUnit = (unitId: string, ownerId: string, config: JsonObject, revision: string) => {
    const migration = compileLegacyInferenceMigration({
      source: { id: unitId, revision, rootId: source.rootId },
      target: { rootId: source.rootId, hostOwnerId, ownerId },
      config,
      resolveService: serviceResolver(options.mapping?.services[unitId], source.rootId, ownerId),
      harnessTargets: options.mapping?.harnessTargets?.[unitId],
      scopeKey: ({ kind, address }) => {
        if (
          address.rootId !== source.rootId ||
          typeof address.platform !== 'string' ||
          typeof address.endpoint !== 'string'
        )
          return undefined;
        if (kind === 'endpoint')
          return typeof address.adapterId === 'string'
            ? JSON.stringify([source.rootId, address.platform, address.endpoint, address.adapterId])
            : undefined;
        try {
          return inferencePolicyKeys({
            rootId: source.rootId,
            platform: address.platform,
            endpoint: address.endpoint,
            conversation: normalizeDeliveryTarget(address.conversation),
          }).sceneKey;
        } catch {
          return undefined;
        }
      },
    });
    units.push({ id: unitId, ownerId, migration });
  };
  const allowedOwners = new Set<string>();
  for (const owners of Object.values(object(ai.personalPrincipals ?? {}))) {
    if (!Array.isArray(owners)) throw new Error('Invalid static personal identity binding');
    for (const raw of owners) {
      const owner = object(raw);
      if (owner.rootId !== source.rootId)
        throw new Error('Personal identity binding belongs to another Root');
      allowedOwners.add(
        personalSessionOwnerId(owner as unknown as Parameters<typeof personalSessionOwnerId>[0]),
      );
    }
  }
  for (const row of source.stateRows) {
    if (row.value.kind === 'runtime-model-policy') {
      if (
        row.value.version !== 1 ||
        row.id !== legacyPluginStateId(legacyRuntimePolicyStateKey(source.rootId, hostOwnerId)) ||
        row.value.rootId !== source.rootId ||
        row.value.hostOwnerId !== hostOwnerId
      ) {
        blocked.push({ path: row.id, code: 'root-owner-mapping-required' });
        continue;
      }
      deployment = {
        ...deployment,
        modelPolicy: mergePolicy(deployment.modelPolicy, row.value.refsOverride),
      };
    } else if (row.value.kind === 'personal-catalog') {
      const ownerId = row.value.ownerId;
      if (
        row.value.version !== 1 ||
        typeof ownerId !== 'string' ||
        !allowedOwners.has(ownerId) ||
        row.id !== legacyPluginStateId(legacyCatalogStateKey(ownerId))
      ) {
        blocked.push({ path: row.id, code: 'personal-owner-binding-required' });
        continue;
      }
      sourceUnit(
        `catalog:${ownerId}`,
        ownerId,
        { modelCatalog: object(row.value.catalog) },
        row.revision,
      );
    } else if (row.value.kind === 'personal-session') {
      const state = object(row.value.state),
        identity = object(state.identity),
        owner = object(identity.owner);
      if (
        row.value.version !== 1 ||
        owner.rootId !== source.rootId ||
        !allowedOwners.has(
          personalSessionOwnerId(owner as unknown as Parameters<typeof personalSessionOwnerId>[0]),
        )
      ) {
        blocked.push({ path: row.id, code: 'session-owner-mapping-required' });
        continue;
      }
      try {
        const canonical = personalSessionIdentity(
          object(identity.address) as unknown as Parameters<typeof personalSessionIdentity>[0],
        );
        if (
          canonical.key !== identity.key ||
          canonical.sceneKey !== identity.sceneKey ||
          row.id !== legacyPluginStateId(canonical.key) ||
          providerPlanFingerprint(canonical.owner) !== providerPlanFingerprint(owner) ||
          !Number.isSafeInteger(state.revision) ||
          Number(state.revision) < 1
        )
          throw new Error('Invalid Session identity');
        sessions.push({
          sourceId: row.id,
          sourceRevision: row.revision,
          identity,
          selection: object(state.selection),
        });
      } catch {
        blocked.push({ path: row.id, code: 'session-source-integrity' });
      }
    }
  }
  sourceUnit('deployment', hostOwnerId, deployment, id);
  for (const session of sessions) {
    if (session.selection.kind === 'inherit') continue;
    if (session.selection.kind !== 'preset' || typeof session.selection.presetId !== 'string') {
      blocked.push({
        path: session.sourceId,
        code: 'session-profile-mapping-required',
      });
      continue;
    }
    const ownerId = personalSessionOwnerId(
      object(session.identity.owner) as unknown as Parameters<typeof personalSessionOwnerId>[0],
    );
    const candidates = units
      .filter((unit) => unit.ownerId === ownerId || unit.ownerId === hostOwnerId)
      .flatMap((unit) =>
        unit.migration.profileMappings
          .filter((mapping) => mapping.legacyPresetId === session.selection.presetId)
          .map((mapping) => ({
            unitId: unit.id,
            profileAlias: mapping.profileAlias,
          })),
      );
    const selected = options.mapping?.sessions?.[String(session.identity.key)];
    const target = selected
      ? candidates.find(
          (candidate) =>
            candidate.unitId === selected.unitId && candidate.profileAlias === selected.profileAlias,
        )
      : candidates.length === 1
        ? candidates[0]
        : undefined;
    if (!target)
      blocked.push({
        path: session.sourceId,
        code: 'session-profile-mapping-required',
      });
    else Object.assign(session, { target });
  }

  const vaultStamps: Record<string, string> = {};
  for (const unit of units)
    for (const reference of unit.migration.credentials) {
      if (reference.source.kind !== 'legacy-vault') continue;
      const ref = reference.source.reference;
      if (!/^personal-model-secret:v1:[a-f0-9]{48}$/u.test(ref)) {
        blocked.push({ path: unit.id, code: 'credential-reference-invalid' });
        continue;
      }
      try {
        vaultStamps[ref] = hash(
          await readPrivateDocument(
            resolve(
              source.rootId,
              '.zhin',
              'personal-model-credentials',
              `${createHash('sha256').update(ref).digest('hex')}.json`,
            ),
          ),
        );
      } catch {
        blocked.push({ path: unit.id, code: 'credential-source-unavailable' });
      }
    }
  const publicPart = {
    version: 1 as const,
    id,
    rootId: source.rootId,
    sourceFile: source.configFile,
    retiredFields: Object.hasOwn(
      object(object(ai.agent ?? {}).providerResilience ?? {}),
      'fallback',
    )
      ? ['ai.agent.providerResilience.fallback']
      : [],
    stateSource: source.stateSource,
    units,
    sessions,
    blocked,
  };
  const fingerprint = hash(publicPart),
    cipher = createHostDocumentCipher(resolve(source.rootId, '.zhin', 'inference'));
  const envelope = await cipher.seal(
    JSON.stringify({
      rootId: source.rootId,
      stamp: source.stamp,
      fingerprint,
      vaultStamps,
      databaseConfig: options.databaseConfig ? resolve(options.databaseConfig) : null,
      stateSnapshot: options.stateSnapshot ? resolve(options.stateSnapshot) : null,
      mapping: options.mapping ?? { version: 1, services: {} },
    }),
    Buffer.from(JSON.stringify(['inference-migration', 1, source.rootId, id])),
  );
  return { ...publicPart, fingerprint, proof: { ...envelope } };
}

export async function verifyInferenceMigrationPreviewFromSources<
  TSources extends SessionMigrationLegacySources = SessionMigrationLegacySources,
>(
  preview: InferenceMigrationPreview,
  readLegacySources: (options: SessionMigrationReadOptions) => Promise<TSources>,
): Promise<TSources> {
  const cipher = createHostDocumentCipher(resolve(preview.rootId, '.zhin', 'inference'));
  const proof = object(
    JSON.parse(
      await cipher.open(
        preview.proof,
        Buffer.from(JSON.stringify(['inference-migration', 1, preview.rootId, preview.id])),
      ),
    ),
  );
  const { proof: _proof, fingerprint: _fingerprint, ...publicPart } = preview;
  if (
    proof.rootId !== preview.rootId ||
    proof.fingerprint !== preview.fingerprint ||
    hash(publicPart) !== preview.fingerprint
  )
    throw new Error('Migration preview changed; create and review a new preview');
  const source = await readLegacySources({
    root: preview.rootId,
    ...(typeof proof.stateSnapshot === 'string' ? { stateSnapshot: proof.stateSnapshot } : {}),
    ...(typeof proof.databaseConfig === 'string' ? { databaseConfig: proof.databaseConfig } : {}),
  });
  if (source.stamp !== proof.stamp)
    throw new Error('Migration source changed; create and review a new preview');
  for (const [reference, stamp] of Object.entries(object(proof.vaultStamps ?? {}))) {
    const file = resolve(
      source.rootId,
      '.zhin',
      'personal-model-credentials',
      `${createHash('sha256').update(reference).digest('hex')}.json`,
    );
    if (hash(await readPrivateDocument(file)) !== stamp)
      throw new Error('Private migration source changed; create and review a new preview');
  }
  return source;
}

export async function readInferenceMigrationPreview(
  file: string,
): Promise<InferenceMigrationPreview> {
  const input = object(JSON.parse(await readFile(file, 'utf8')));
  if (
    input.version !== 1 ||
    typeof input.rootId !== 'string' ||
    typeof input.id !== 'string' ||
    !Array.isArray(input.units) ||
    !Array.isArray(input.sessions) ||
    !Array.isArray(input.blocked)
  )
    throw new Error('Invalid migration preview');
  return input as unknown as InferenceMigrationPreview;
}
