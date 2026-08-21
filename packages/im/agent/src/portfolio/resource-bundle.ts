import {
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import {
  parsePortfolioCapacityRequest,
  type PortfolioCapacityRequest,
  type PortfolioResourceDemand,
  type PortfolioWorkRef,
} from './portfolio-journal.js';

export type ResourcePoolKind = 'model' | 'executor';

interface ResourcePoolCatalogEntryBase {
  readonly kind: ResourcePoolKind;
  readonly poolId: string;
  readonly tenantId: string;
  readonly region: string;
  readonly trustDomain: string;
  readonly compatibilityGroup: string;
  readonly capacityUnits: number;
  readonly maxCapacityUnitsPerBundle: number;
  readonly rateUnitsPerWindow: number;
  readonly maxRateUnitsPerBundle: number;
  readonly priceMicrosPerUsageUnit: number;
  readonly maxUsageUnitsPerBundle: number;
}

export interface ModelResourcePoolCatalogEntry extends ResourcePoolCatalogEntryBase {
  readonly kind: 'model';
  readonly providerId: string;
  readonly modelTier: string;
}

export interface ExecutorResourcePoolCatalogEntry extends ResourcePoolCatalogEntryBase {
  readonly kind: 'executor';
  readonly executorPoolId: string;
  readonly sandboxId: string;
  readonly workspaceProviderId: string;
}

/** Trusted generation-owned resources. Requesters may select only a poolId. */
export type ResourcePoolCatalogEntry =
  | ModelResourcePoolCatalogEntry
  | ExecutorResourcePoolCatalogEntry;

export interface ResourcePoolCatalogSnapshot {
  readonly version: 1;
  readonly generationId: string;
  readonly revision: number;
  readonly tenantId: string;
  readonly pools: readonly ResourcePoolCatalogEntry[];
  readonly digest: string;
}

export type ResourcePoolCatalogSnapshotSource = Omit<ResourcePoolCatalogSnapshot, 'version' | 'digest'>;

export interface AtomicResourceBundleRequest {
  readonly tenantId: string;
  readonly catalogRevision: number;
  readonly catalogDigest: string;
  readonly capacityRequest: PortfolioCapacityRequest;
}

export interface ResourcePoolProfileLimit {
  readonly poolId: string;
  readonly maxCapacityUnits: number;
  readonly maxRateUnits: number;
  readonly maxUsageUnits: number;
}

/** Exact Project Profile ceiling; this can narrow but never expand the catalog. */
export interface AtomicResourceBundleProfileCeiling {
  readonly tenantId: string;
  readonly projectId: string;
  readonly profileRevisionId: string;
  readonly profileDigest: string;
  readonly catalogRevision: number;
  readonly catalogDigest: string;
  readonly allowedPoolIds: readonly string[];
  readonly poolLimits: readonly ResourcePoolProfileLimit[];
  readonly maxWorstCaseCostMicros: number;
  /** Content address of every ceiling field above; independent from the compiled Profile digest. */
  readonly ceilingDigest: string;
}

export type AtomicResourceBundleProfileCeilingSource = Omit<
  AtomicResourceBundleProfileCeiling,
  'ceilingDigest'
>;

/**
 * Trusted authority emitted by the generation/compiled-Profile owner. There is
 * intentionally no public constructor: requesters and Executors cannot issue
 * authority merely by hashing a different ceiling.
 */
export interface AtomicResourceBundleProfileAuthority {
  readonly tenantId: string;
  readonly projectId: string;
  readonly profileRevisionId: string;
  readonly profileDigest: string;
  readonly resourceCeilingDigest: string;
}

export interface ValidatedModelResourceReservation {
  readonly poolId: string;
  readonly providerId: string;
  readonly modelTier: string;
  readonly capacityUnits: number;
  readonly rateUnits: number;
  readonly worstCaseUsageUnits: number;
  readonly worstCaseCostMicros: number;
}

export interface ValidatedExecutorResourceReservation {
  readonly poolId: string;
  readonly executorPoolId: string;
  readonly sandboxId: string;
  readonly workspaceProviderId: string;
  readonly capacityUnits: number;
  readonly rateUnits: number;
  readonly worstCaseUsageUnits: number;
  readonly worstCaseCostMicros: number;
}

export interface AtomicRateReservation {
  readonly poolId: string;
  readonly units: number;
}

/** Pure validation result. It describes one atomic reservation but writes no ledger or Journal. */
export interface ValidatedAtomicResourceBundle {
  readonly requestId: string;
  readonly projectId: string;
  readonly workRef: PortfolioWorkRef;
  readonly catalogRef: Readonly<{
    generationId: string;
    revision: number;
    digest: string;
  }>;
  readonly profileAuthorityRef: AtomicResourceBundleProfileAuthority;
  readonly region: string;
  readonly trustDomain: string;
  readonly compatibilityGroup: string;
  readonly model: ValidatedModelResourceReservation;
  readonly executor: ValidatedExecutorResourceReservation;
  readonly rateReservations: readonly AtomicRateReservation[];
  readonly totalWorstCaseCostMicros: number;
}

const CATALOG_KEYS = new Set(['version', 'generationId', 'revision', 'tenantId', 'pools', 'digest']);
const CATALOG_SOURCE_KEYS = new Set(['generationId', 'revision', 'tenantId', 'pools']);
const COMMON_POOL_KEYS = [
  'kind',
  'poolId',
  'tenantId',
  'region',
  'trustDomain',
  'compatibilityGroup',
  'capacityUnits',
  'maxCapacityUnitsPerBundle',
  'rateUnitsPerWindow',
  'maxRateUnitsPerBundle',
  'priceMicrosPerUsageUnit',
  'maxUsageUnitsPerBundle',
];
const MODEL_POOL_KEYS = new Set([...COMMON_POOL_KEYS, 'providerId', 'modelTier']);
const EXECUTOR_POOL_KEYS = new Set([
  ...COMMON_POOL_KEYS,
  'executorPoolId',
  'sandboxId',
  'workspaceProviderId',
]);
const BUNDLE_REQUEST_KEYS = new Set(['tenantId', 'catalogRevision', 'catalogDigest', 'capacityRequest']);
const PROFILE_CEILING_KEYS = new Set([
  'tenantId',
  'projectId',
  'profileRevisionId',
  'profileDigest',
  'catalogRevision',
  'catalogDigest',
  'allowedPoolIds',
  'poolLimits',
  'maxWorstCaseCostMicros',
  'ceilingDigest',
]);
const PROFILE_CEILING_SOURCE_KEYS = new Set(
  [...PROFILE_CEILING_KEYS].filter((key) => key !== 'ceilingDigest'),
);
const PROFILE_AUTHORITY_KEYS = new Set([
  'tenantId',
  'projectId',
  'profileRevisionId',
  'profileDigest',
  'resourceCeilingDigest',
]);
const POOL_LIMIT_KEYS = new Set([
  'poolId',
  'maxCapacityUnits',
  'maxRateUnits',
  'maxUsageUnits',
]);

/** Constructs the immutable snapshot that a generation owner publishes. */
export function createResourcePoolCatalogSnapshot(
  source: ResourcePoolCatalogSnapshotSource,
): ResourcePoolCatalogSnapshot {
  const record = exactRecord(source, CATALOG_SOURCE_KEYS, 'Resource Pool catalog source');
  const normalized = normalizeCatalogBody(record);
  return deepFreeze({ ...normalized, digest: digest(normalized) });
}

/** Constructs a canonical immutable Profile resource ceiling snapshot. */
export function createAtomicResourceBundleProfileCeiling(
  source: AtomicResourceBundleProfileCeilingSource,
): AtomicResourceBundleProfileCeiling {
  const record = exactRecord(source, PROFILE_CEILING_SOURCE_KEYS, 'Atomic Resource Bundle Profile ceiling source');
  const normalized = normalizeProfileCeilingBody(record);
  return deepFreeze({ ...normalized, ceilingDigest: digest(normalized) });
}

/**
 * Resolves and validates a whole bundle without acquiring anything. Any failure
 * throws before a reservation descriptor exists, so callers cannot retain a
 * model, Executor, rate, or budget fragment independently.
 */
export function validateAtomicResourceBundle(input: Readonly<{
  request: AtomicResourceBundleRequest;
  catalog: ResourcePoolCatalogSnapshot;
  profileCeiling: AtomicResourceBundleProfileCeiling;
  profileAuthority: AtomicResourceBundleProfileAuthority;
}>): ValidatedAtomicResourceBundle {
  const inputRecord = exactRecord(
    input,
    new Set(['request', 'catalog', 'profileCeiling', 'profileAuthority']),
    'Resource Bundle input',
  );
  const request = normalizeBundleRequest(inputRecord.request);
  const catalog = normalizeAndVerifyCatalog(inputRecord.catalog);
  const ceiling = normalizeProfileCeiling(inputRecord.profileCeiling);
  const authority = normalizeProfileAuthority(inputRecord.profileAuthority);

  bindEqual(request.tenantId, catalog.tenantId, 'request tenant and catalog tenant');
  bindEqual(request.tenantId, ceiling.tenantId, 'request tenant and Profile ceiling tenant');
  bindEqual(authority.tenantId, request.tenantId, 'Profile authority tenant and request tenant');
  bindEqual(authority.tenantId, ceiling.tenantId, 'Profile authority tenant and ceiling tenant');
  bindEqual(request.catalogRevision, catalog.revision, 'request catalog revision');
  bindEqual(request.catalogDigest, catalog.digest, 'request catalog digest');
  bindEqual(ceiling.catalogRevision, catalog.revision, 'Profile ceiling catalog revision');
  bindEqual(ceiling.catalogDigest, catalog.digest, 'Profile ceiling catalog digest');
  bindEqual(request.capacityRequest.projectId, ceiling.projectId, 'Capacity Request Project');
  bindEqual(
    authority.projectId,
    request.capacityRequest.projectId,
    'Profile authority Project and Capacity Request Project',
  );
  bindEqual(authority.projectId, ceiling.projectId, 'Profile authority Project and ceiling Project');
  bindEqual(
    request.capacityRequest.workRef.profileRevisionId,
    ceiling.profileRevisionId,
    'Capacity Request Profile revision',
  );
  bindEqual(
    authority.profileRevisionId,
    request.capacityRequest.workRef.profileRevisionId,
    'Profile authority revision and Capacity Request Profile revision',
  );
  bindEqual(
    authority.profileRevisionId,
    ceiling.profileRevisionId,
    'Profile authority revision and ceiling Profile revision',
  );
  bindEqual(
    request.capacityRequest.workRef.profileDigest,
    ceiling.profileDigest,
    'Capacity Request Profile digest',
  );
  bindEqual(
    authority.profileDigest,
    request.capacityRequest.workRef.profileDigest,
    'Profile authority digest and Capacity Request Profile digest',
  );
  bindEqual(
    authority.profileDigest,
    ceiling.profileDigest,
    'Profile authority digest and ceiling Profile digest',
  );
  bindEqual(
    authority.resourceCeilingDigest,
    ceiling.ceilingDigest,
    'Profile authority resource ceiling digest',
  );

  const pools = new Map(catalog.pools.map((pool) => [pool.poolId, pool]));
  const allowedPools = new Set(ceiling.allowedPoolIds);
  const profileLimits = new Map(ceiling.poolLimits.map((limit) => [limit.poolId, limit]));
  const resolved = request.capacityRequest.resourceBundle.demands.map((demand) => {
    const pool = pools.get(demand.poolId);
    if (!pool) throw new Error(`Unknown Resource Pool: ${demand.poolId}`);
    if (!allowedPools.has(pool.poolId)) {
      throw new Error(`Project Profile does not allow Resource Pool ${pool.poolId}`);
    }
    const limit = profileLimits.get(pool.poolId);
    if (!limit) throw new Error(`Project Profile has no limit for Resource Pool ${pool.poolId}`);
    validateDemand(demand, pool, limit);
    return { demand, pool, costMicros: checkedProduct(demand.budgetUnits, pool.priceMicrosPerUsageUnit) };
  });

  const models = resolved.filter(
    (item): item is typeof item & { pool: ModelResourcePoolCatalogEntry } => item.pool.kind === 'model',
  );
  const executors = resolved.filter(
    (item): item is typeof item & { pool: ExecutorResourcePoolCatalogEntry } => item.pool.kind === 'executor',
  );
  if (models.length !== 1) throw new Error('Atomic Resource Bundle requires exactly one model component');
  if (executors.length !== 1) throw new Error('Atomic Resource Bundle requires exactly one Executor component');
  if (resolved.length !== 2) throw new Error('Atomic Resource Bundle contains unsupported extra components');

  const model = models[0]!;
  const executor = executors[0]!;
  for (const [field, modelValue, executorValue] of [
    ['region', model.pool.region, executor.pool.region],
    ['trust domain', model.pool.trustDomain, executor.pool.trustDomain],
    ['compatibility group', model.pool.compatibilityGroup, executor.pool.compatibilityGroup],
  ] as const) {
    bindEqual(modelValue, executorValue, `Resource Bundle ${field}`);
  }

  const totalWorstCaseCostMicros = checkedSum(model.costMicros, executor.costMicros);
  if (totalWorstCaseCostMicros > ceiling.maxWorstCaseCostMicros) {
    throw new Error('Resource Bundle worst-case cost exceeds Project Profile ceiling');
  }

  return deepFreeze({
    requestId: request.capacityRequest.requestId,
    projectId: request.capacityRequest.projectId,
    workRef: { ...request.capacityRequest.workRef },
    catalogRef: {
      generationId: catalog.generationId,
      revision: catalog.revision,
      digest: catalog.digest,
    },
    profileAuthorityRef: { ...authority },
    region: model.pool.region,
    trustDomain: model.pool.trustDomain,
    compatibilityGroup: model.pool.compatibilityGroup,
    model: {
      poolId: model.pool.poolId,
      providerId: model.pool.providerId,
      modelTier: model.pool.modelTier,
      capacityUnits: model.demand.capacityUnits,
      rateUnits: model.demand.rateUnits,
      worstCaseUsageUnits: model.demand.budgetUnits,
      worstCaseCostMicros: model.costMicros,
    },
    executor: {
      poolId: executor.pool.poolId,
      executorPoolId: executor.pool.executorPoolId,
      sandboxId: executor.pool.sandboxId,
      workspaceProviderId: executor.pool.workspaceProviderId,
      capacityUnits: executor.demand.capacityUnits,
      rateUnits: executor.demand.rateUnits,
      worstCaseUsageUnits: executor.demand.budgetUnits,
      worstCaseCostMicros: executor.costMicros,
    },
    rateReservations: resolved
      .map((item) => ({ poolId: item.pool.poolId, units: item.demand.rateUnits }))
      .sort((left, right) => left.poolId.localeCompare(right.poolId)),
    totalWorstCaseCostMicros,
  });
}

function normalizeAndVerifyCatalog(value: unknown): ResourcePoolCatalogSnapshot {
  const record = exactRecord(value, CATALOG_KEYS, 'Resource Pool catalog snapshot');
  if (record.version !== 1) throw new Error('Unsupported Resource Pool catalog version');
  const normalized = normalizeCatalogBody(record);
  const claimedDigest = contentDigest(record.digest, 'catalog digest');
  const actualDigest = digest(normalized);
  if (claimedDigest !== actualDigest) {
    throw new Error(`Resource Pool catalog digest mismatch: expected ${claimedDigest}, actual ${actualDigest}`);
  }
  return deepFreeze({ ...normalized, digest: claimedDigest });
}

function normalizeCatalogBody(value: Record<string, unknown>): Omit<ResourcePoolCatalogSnapshot, 'digest'> {
  if (!Array.isArray(value.pools) || value.pools.length === 0) {
    throw new Error('Resource Pool catalog requires pools');
  }
  const tenantId = identifier(value.tenantId, 'catalog tenantId');
  const pools = value.pools.map((pool, index) => normalizePool(pool, index, tenantId))
    .sort((left, right) => left.poolId.localeCompare(right.poolId));
  assertUnique(pools.map((pool) => pool.poolId), 'Resource Pool catalog poolId');
  return deepFreeze({
    version: 1 as const,
    generationId: identifier(value.generationId, 'catalog generationId'),
    revision: positiveSafeInteger(value.revision, 'catalog revision'),
    tenantId,
    pools,
  });
}

function normalizePool(value: unknown, index: number, catalogTenantId: string): ResourcePoolCatalogEntry {
  const base = exactRecord(value, new Set(COMMON_POOL_KEYS), `Resource Pool ${index}`, true);
  const kind = base.kind;
  if (kind !== 'model' && kind !== 'executor') throw new Error(`Invalid Resource Pool kind at ${index}`);
  const record = exactRecord(value, kind === 'model' ? MODEL_POOL_KEYS : EXECUTOR_POOL_KEYS, `Resource Pool ${index}`);
  const tenantId = identifier(record.tenantId, `Resource Pool ${index} tenantId`);
  bindEqual(tenantId, catalogTenantId, `Resource Pool ${index} tenant`);
  const common = {
    kind,
    poolId: identifier(record.poolId, `Resource Pool ${index} poolId`),
    tenantId,
    region: identifier(record.region, `Resource Pool ${index} region`),
    trustDomain: identifier(record.trustDomain, `Resource Pool ${index} trustDomain`),
    compatibilityGroup: identifier(record.compatibilityGroup, `Resource Pool ${index} compatibilityGroup`),
    capacityUnits: positiveSafeInteger(record.capacityUnits, `Resource Pool ${index} capacityUnits`),
    maxCapacityUnitsPerBundle: positiveSafeInteger(
      record.maxCapacityUnitsPerBundle,
      `Resource Pool ${index} maxCapacityUnitsPerBundle`,
    ),
    rateUnitsPerWindow: positiveSafeInteger(record.rateUnitsPerWindow, `Resource Pool ${index} rateUnitsPerWindow`),
    maxRateUnitsPerBundle: positiveSafeInteger(
      record.maxRateUnitsPerBundle,
      `Resource Pool ${index} maxRateUnitsPerBundle`,
    ),
    priceMicrosPerUsageUnit: nonNegativeSafeInteger(
      record.priceMicrosPerUsageUnit,
      `Resource Pool ${index} priceMicrosPerUsageUnit`,
    ),
    maxUsageUnitsPerBundle: positiveSafeInteger(
      record.maxUsageUnitsPerBundle,
      `Resource Pool ${index} maxUsageUnitsPerBundle`,
    ),
  };
  if (common.maxCapacityUnitsPerBundle > common.capacityUnits) {
    throw new Error(`Resource Pool ${common.poolId} per-bundle capacity exceeds pool capacity`);
  }
  if (common.maxRateUnitsPerBundle > common.rateUnitsPerWindow) {
    throw new Error(`Resource Pool ${common.poolId} per-bundle rate exceeds pool rate`);
  }
  return kind === 'model'
    ? deepFreeze({
      ...common,
      kind,
      providerId: identifier(record.providerId, `Resource Pool ${index} providerId`),
      modelTier: identifier(record.modelTier, `Resource Pool ${index} modelTier`),
    })
    : deepFreeze({
      ...common,
      kind,
      executorPoolId: identifier(record.executorPoolId, `Resource Pool ${index} executorPoolId`),
      sandboxId: identifier(record.sandboxId, `Resource Pool ${index} sandboxId`),
      workspaceProviderId: identifier(record.workspaceProviderId, `Resource Pool ${index} workspaceProviderId`),
    });
}

function normalizeBundleRequest(value: unknown): AtomicResourceBundleRequest {
  const record = exactRecord(value, BUNDLE_REQUEST_KEYS, 'Atomic Resource Bundle request');
  return deepFreeze({
    tenantId: identifier(record.tenantId, 'request tenantId'),
    catalogRevision: positiveSafeInteger(record.catalogRevision, 'request catalogRevision'),
    catalogDigest: contentDigest(record.catalogDigest, 'request catalogDigest'),
    capacityRequest: parsePortfolioCapacityRequest(record.capacityRequest),
  });
}

function normalizeProfileCeiling(value: unknown): AtomicResourceBundleProfileCeiling {
  const record = exactRecord(value, PROFILE_CEILING_KEYS, 'Atomic Resource Bundle Profile ceiling');
  const normalized = normalizeProfileCeilingBody(record);
  const claimedDigest = contentDigest(record.ceilingDigest, 'Profile ceiling digest');
  const actualDigest = digest(normalized);
  if (claimedDigest !== actualDigest) {
    throw new Error(`Profile ceiling digest mismatch: expected ${claimedDigest}, actual ${actualDigest}`);
  }
  return deepFreeze({ ...normalized, ceilingDigest: claimedDigest });
}

function normalizeProfileAuthority(value: unknown): AtomicResourceBundleProfileAuthority {
  const record = exactRecord(value, PROFILE_AUTHORITY_KEYS, 'Atomic Resource Bundle Profile authority');
  return deepFreeze({
    tenantId: identifier(record.tenantId, 'Profile authority tenantId'),
    projectId: identifier(record.projectId, 'Profile authority projectId'),
    profileRevisionId: identifier(record.profileRevisionId, 'Profile authority profileRevisionId'),
    profileDigest: contentDigest(record.profileDigest, 'Profile authority profileDigest'),
    resourceCeilingDigest: contentDigest(
      record.resourceCeilingDigest,
      'Profile authority resourceCeilingDigest',
    ),
  });
}

function normalizeProfileCeilingBody(
  record: Record<string, unknown>,
): AtomicResourceBundleProfileCeilingSource {
  if (!Array.isArray(record.allowedPoolIds) || record.allowedPoolIds.length === 0) {
    throw new Error('Project Profile ceiling requires allowed pools');
  }
  if (!Array.isArray(record.poolLimits) || record.poolLimits.length === 0) {
    throw new Error('Project Profile ceiling requires pool limits');
  }
  const allowedPoolIds = record.allowedPoolIds.map((item, index) => identifier(item, `allowedPoolIds[${index}]`))
    .sort((left, right) => left.localeCompare(right));
  assertUnique(allowedPoolIds, 'Project Profile allowed pool');
  const poolLimits = record.poolLimits.map((item, index): ResourcePoolProfileLimit => {
    const limit = exactRecord(item, POOL_LIMIT_KEYS, `Project Profile pool limit ${index}`);
    return {
      poolId: identifier(limit.poolId, `poolLimits[${index}].poolId`),
      maxCapacityUnits: nonNegativeSafeInteger(limit.maxCapacityUnits, `poolLimits[${index}].maxCapacityUnits`),
      maxRateUnits: nonNegativeSafeInteger(limit.maxRateUnits, `poolLimits[${index}].maxRateUnits`),
      maxUsageUnits: nonNegativeSafeInteger(limit.maxUsageUnits, `poolLimits[${index}].maxUsageUnits`),
    };
  }).sort((left, right) => left.poolId.localeCompare(right.poolId));
  assertUnique(poolLimits.map((limit) => limit.poolId), 'Project Profile pool limit');
  for (const limit of poolLimits) {
    if (!allowedPoolIds.includes(limit.poolId)) {
      throw new Error(`Project Profile has a limit for unapproved Resource Pool ${limit.poolId}`);
    }
  }
  return deepFreeze({
    tenantId: identifier(record.tenantId, 'Profile ceiling tenantId'),
    projectId: identifier(record.projectId, 'Profile ceiling projectId'),
    profileRevisionId: identifier(record.profileRevisionId, 'Profile ceiling profileRevisionId'),
    profileDigest: contentDigest(record.profileDigest, 'Profile ceiling profileDigest'),
    catalogRevision: positiveSafeInteger(record.catalogRevision, 'Profile ceiling catalogRevision'),
    catalogDigest: contentDigest(record.catalogDigest, 'Profile ceiling catalogDigest'),
    allowedPoolIds,
    poolLimits,
    maxWorstCaseCostMicros: nonNegativeSafeInteger(
      record.maxWorstCaseCostMicros,
      'Profile ceiling maxWorstCaseCostMicros',
    ),
  });
}

function validateDemand(
  demand: PortfolioResourceDemand,
  pool: ResourcePoolCatalogEntry,
  limit: ResourcePoolProfileLimit,
): void {
  if (demand.capacityUnits > pool.capacityUnits
    || demand.capacityUnits > pool.maxCapacityUnitsPerBundle) {
    throw new Error(`Resource Pool ${pool.poolId} capacity demand exceeds catalog limit`);
  }
  if (demand.rateUnits > pool.rateUnitsPerWindow
    || demand.rateUnits > pool.maxRateUnitsPerBundle) {
    throw new Error(`Resource Pool ${pool.poolId} rate demand exceeds catalog limit`);
  }
  if (demand.budgetUnits > pool.maxUsageUnitsPerBundle) {
    throw new Error(`Resource Pool ${pool.poolId} worst-case usage exceeds catalog limit`);
  }
  if (demand.capacityUnits > limit.maxCapacityUnits) {
    throw new Error(`Resource Pool ${pool.poolId} capacity demand exceeds Project Profile ceiling`);
  }
  if (demand.rateUnits > limit.maxRateUnits) {
    throw new Error(`Resource Pool ${pool.poolId} rate demand exceeds Project Profile ceiling`);
  }
  if (demand.budgetUnits > limit.maxUsageUnits) {
    throw new Error(`Resource Pool ${pool.poolId} worst-case usage exceeds Project Profile ceiling`);
  }
}

function exactRecord(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
  allowMissingKnownKeys = false,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !allowed.has(key)).sort();
  if (unknown.length > 0 && !allowMissingKnownKeys) {
    throw new Error(`${label} cannot carry requester metadata or unknown fields: ${unknown.join(', ')}`);
  }
  return record;
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new Error(`Invalid ${path}`);
  }
  return value;
}

function contentDigest(value: unknown, path: string): string {
  const result = identifier(value, path);
  if (!result.startsWith('sha256:')) throw new Error(`Invalid ${path}`);
  return result;
}

function positiveSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`${path} must be a positive safe integer`);
  }
  return Number(value);
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${path} must be a non-negative safe integer`);
  }
  return Number(value);
}

function bindEqual(left: string | number, right: string | number, label: string): void {
  if (left !== right) throw new Error(`${label} binding mismatch`);
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function checkedProduct(left: number, right: number): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) throw new Error('Resource Bundle worst-case cost exceeds safe integer range');
  return result;
}

function checkedSum(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error('Resource Bundle total worst-case cost exceeds safe integer range');
  return result;
}
