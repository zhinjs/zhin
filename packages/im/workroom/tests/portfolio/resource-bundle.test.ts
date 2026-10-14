import {
  createAtomicResourceBundleProfileCeiling,
  createResourcePoolCatalogSnapshot,
  validateAtomicResourceBundle,
  type AtomicResourceBundleProfileAuthority,
  type AtomicResourceBundleProfileCeiling,
  type AtomicResourceBundleProfileCeilingSource,
  type AtomicResourceBundleRequest,
  type ResourcePoolCatalogEntry,
} from '../../src/portfolio/resource-bundle.js';

const POOLS: readonly ResourcePoolCatalogEntry[] = [
  {
    kind: 'model',
    poolId: 'model:reasoning',
    tenantId: 'tenant-a',
    region: 'ap-southeast-1',
    trustDomain: 'internal',
    compatibilityGroup: 'linux-amd64-v1',
    capacityUnits: 8,
    maxCapacityUnitsPerBundle: 2,
    rateUnitsPerWindow: 100_000,
    maxRateUnitsPerBundle: 20_000,
    priceMicrosPerUsageUnit: 3,
    maxUsageUnitsPerBundle: 20_000,
    providerId: 'provider-trusted',
    modelTier: 'reasoning',
  },
  {
    kind: 'executor',
    poolId: 'executor:sandbox',
    tenantId: 'tenant-a',
    region: 'ap-southeast-1',
    trustDomain: 'internal',
    compatibilityGroup: 'linux-amd64-v1',
    capacityUnits: 4,
    maxCapacityUnitsPerBundle: 1,
    rateUnitsPerWindow: 100,
    maxRateUnitsPerBundle: 10,
    priceMicrosPerUsageUnit: 25,
    maxUsageUnitsPerBundle: 60,
    executorPoolId: 'local-linux',
    sandboxId: 'sandbox-v2',
    workspaceProviderId: 'worktree-v1',
  },
];

function catalog(overrides: Partial<{
  generationId: string;
  revision: number;
  tenantId: string;
  pools: readonly ResourcePoolCatalogEntry[];
}> = {}) {
  return createResourcePoolCatalogSnapshot({
    generationId: 'generation-7',
    revision: 11,
    tenantId: 'tenant-a',
    pools: POOLS,
    ...overrides,
  });
}

function request(overrides: Partial<AtomicResourceBundleRequest> = {}): AtomicResourceBundleRequest {
  const snapshot = catalog();
  return {
    tenantId: 'tenant-a',
    catalogRevision: snapshot.revision,
    catalogDigest: snapshot.digest,
    capacityRequest: {
      requestId: 'request-1',
      projectId: 'project-a',
      workRef: {
        runId: 'run-1',
        profileRevisionId: 'profile-3',
        profileDigest: 'sha256:profile-3',
      },
      schedulerRevision: 'scheduler-2',
      schedulerSequence: 4,
      localOrder: 1,
      projectPolicyRevision: 6,
      opaqueHeadId: 'head-4',
      payloadDigest: 'sha256:opaque-payload',
      resourceBundle: {
        demands: [
          { poolId: 'executor:sandbox', capacityUnits: 1, rateUnits: 2, budgetUnits: 20 },
          { poolId: 'model:reasoning', capacityUnits: 1, rateUnits: 5_000, budgetUnits: 10_000 },
        ],
      },
      preemptibility: 'checkpointable',
      deadlineAt: 2_000,
      starvationAt: 1_500,
    },
    ...overrides,
  };
}

function ceiling(
  overrides: Partial<AtomicResourceBundleProfileCeilingSource> = {},
): AtomicResourceBundleProfileCeiling {
  return createAtomicResourceBundleProfileCeiling({
    tenantId: 'tenant-a',
    projectId: 'project-a',
    profileRevisionId: 'profile-3',
    profileDigest: 'sha256:profile-3',
    catalogRevision: 11,
    catalogDigest: catalog().digest,
    allowedPoolIds: ['executor:sandbox', 'model:reasoning'],
    poolLimits: [
      { poolId: 'executor:sandbox', maxCapacityUnits: 1, maxRateUnits: 3, maxUsageUnits: 30 },
      { poolId: 'model:reasoning', maxCapacityUnits: 1, maxRateUnits: 10_000, maxUsageUnits: 12_000 },
    ],
    maxWorstCaseCostMicros: 40_000,
    ...overrides,
  });
}

function profileAuthority(
  profileCeiling: AtomicResourceBundleProfileCeiling = ceiling(),
): AtomicResourceBundleProfileAuthority {
  return {
    tenantId: profileCeiling.tenantId,
    projectId: profileCeiling.projectId,
    profileRevisionId: profileCeiling.profileRevisionId,
    profileDigest: profileCeiling.profileDigest,
    resourceCeilingDigest: profileCeiling.ceilingDigest,
  };
}

function validationInput(overrides: Partial<{
  request: AtomicResourceBundleRequest;
  catalog: ReturnType<typeof catalog>;
  profileCeiling: AtomicResourceBundleProfileCeiling;
  profileAuthority: AtomicResourceBundleProfileAuthority;
}> = {}) {
  const profileCeiling = overrides.profileCeiling ?? ceiling();
  return {
    request: overrides.request ?? request(),
    catalog: overrides.catalog ?? catalog(),
    profileCeiling,
    profileAuthority: overrides.profileAuthority ?? profileAuthority(profileCeiling),
  };
}

describe('atomic Portfolio Resource Bundle validation', () => {
  it('resolves one deterministic immutable model + Executor bundle only from the trusted catalog', () => {
    const snapshot = catalog();
    const trustedCeiling = ceiling();
    const bundle = validateAtomicResourceBundle(validationInput({
      catalog: snapshot,
      profileCeiling: trustedCeiling,
    }));

    expect(bundle).toEqual({
      requestId: 'request-1',
      projectId: 'project-a',
      workRef: {
        runId: 'run-1',
        profileRevisionId: 'profile-3',
        profileDigest: 'sha256:profile-3',
      },
      catalogRef: {
        generationId: 'generation-7',
        revision: 11,
        digest: snapshot.digest,
      },
      profileAuthorityRef: profileAuthority(trustedCeiling),
      region: 'ap-southeast-1',
      trustDomain: 'internal',
      compatibilityGroup: 'linux-amd64-v1',
      model: {
        poolId: 'model:reasoning',
        providerId: 'provider-trusted',
        modelTier: 'reasoning',
        capacityUnits: 1,
        rateUnits: 5_000,
        worstCaseUsageUnits: 10_000,
        worstCaseCostMicros: 30_000,
      },
      executor: {
        poolId: 'executor:sandbox',
        executorPoolId: 'local-linux',
        sandboxId: 'sandbox-v2',
        workspaceProviderId: 'worktree-v1',
        capacityUnits: 1,
        rateUnits: 2,
        worstCaseUsageUnits: 20,
        worstCaseCostMicros: 500,
      },
      rateReservations: [
        { poolId: 'executor:sandbox', units: 2 },
        { poolId: 'model:reasoning', units: 5_000 },
      ],
      totalWorstCaseCostMicros: 30_500,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.pools)).toBe(true);
    expect(Object.isFrozen(ceiling())).toBe(true);
    expect(Object.isFrozen(ceiling().poolLimits)).toBe(true);
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.model)).toBe(true);
    expect(Object.isFrozen(bundle.rateReservations)).toBe(true);
  });

  it('canonicalizes catalog pool ordering and verifies the catalog content digest', () => {
    const forward = catalog();
    const reversed = catalog({ pools: [...POOLS].reverse() });
    expect(reversed).toEqual(forward);

    expect(() => validateAtomicResourceBundle(validationInput({
      catalog: { ...forward, pools: [{ ...forward.pools[0]!, priceMicrosPerUsageUnit: 1 }, forward.pools[1]!] },
    }))).toThrow('catalog digest');
  });

  it('content-addresses the complete Profile ceiling and rejects retained-digest drift', () => {
    const trusted = ceiling();
    const { ceilingDigest: _ceilingDigest, ...trustedSource } = trusted;
    const equivalent = createAtomicResourceBundleProfileCeiling({
      ...trustedSource,
      allowedPoolIds: [...trusted.allowedPoolIds].reverse(),
      poolLimits: [...trusted.poolLimits].reverse(),
    });
    expect(equivalent).toEqual(trusted);

    for (const drift of [
      { maxWorstCaseCostMicros: trusted.maxWorstCaseCostMicros + 1 },
      { allowedPoolIds: ['executor:sandbox', 'model:reasoning', 'model:untrusted'] },
      {
        poolLimits: trusted.poolLimits.map((limit) => limit.poolId === 'model:reasoning'
          ? { ...limit, maxUsageUnits: limit.maxUsageUnits + 1 }
          : limit),
      },
    ]) {
      expect(() => validateAtomicResourceBundle(validationInput({
        profileCeiling: { ...trusted, ...drift },
        profileAuthority: profileAuthority(trusted),
      }))).toThrow('ceiling digest');
    }
  });

  it('rejects a freshly recomputed relaxed ceiling when trusted Profile authority is unchanged', () => {
    const trusted = ceiling();
    const authority = profileAuthority(trusted);
    const relaxed = ceiling({
      maxWorstCaseCostMicros: trusted.maxWorstCaseCostMicros + 1_000_000,
      poolLimits: trusted.poolLimits.map((limit) => ({
        ...limit,
        maxCapacityUnits: limit.maxCapacityUnits + 10,
        maxRateUnits: limit.maxRateUnits + 100_000,
        maxUsageUnits: limit.maxUsageUnits + 100_000,
      })),
    });
    expect(relaxed.ceilingDigest).not.toBe(trusted.ceilingDigest);

    expect(() => validateAtomicResourceBundle(validationInput({
      profileCeiling: relaxed,
      profileAuthority: authority,
    }))).toThrow('Profile authority resource ceiling digest');
  });

  it('requires an exact generation/compiled-Profile-owned authority binding', () => {
    const trusted = ceiling();
    const authority = profileAuthority(trusted);
    for (const drift of [
      { tenantId: 'tenant-b' },
      { projectId: 'project-b' },
      { profileRevisionId: 'profile-4' },
      { profileDigest: 'sha256:profile-4' },
      { resourceCeilingDigest: 'sha256:other-ceiling' },
    ]) {
      expect(() => validateAtomicResourceBundle(validationInput({
        profileCeiling: trusted,
        profileAuthority: { ...authority, ...drift },
      }))).toThrow('Profile authority');
    }
    expect(() => validateAtomicResourceBundle(validationInput({
      profileCeiling: trusted,
      profileAuthority: { ...authority, agent: 'self-issued' } as AtomicResourceBundleProfileAuthority,
    }))).toThrow('agent');
  });

  it('rejects unknown Profile ceiling metadata even when the trusted digest is retained', () => {
    const trusted = ceiling();
    expect(() => validateAtomicResourceBundle(validationInput({
      profileCeiling: { ...trusted, agent: 'self-reported' } as AtomicResourceBundleProfileCeiling,
      profileAuthority: profileAuthority(trusted),
    }))).toThrow('agent');
    expect(() => validateAtomicResourceBundle(validationInput({
      profileCeiling: {
        ...trusted,
        poolLimits: [{ ...trusted.poolLimits[0]!, priceMicrosPerUsageUnit: 0 }, trusted.poolLimits[1]!],
      } as AtomicResourceBundleProfileCeiling,
      profileAuthority: profileAuthority(trusted),
    }))).toThrow('priceMicrosPerUsageUnit');
  });

  it.each([
    ['request catalog revision', (value: AtomicResourceBundleRequest) => ({ ...value, catalogRevision: 12 })],
    ['request catalog digest', (value: AtomicResourceBundleRequest) => ({ ...value, catalogDigest: 'sha256:stale' })],
    ['tenant', (value: AtomicResourceBundleRequest) => ({ ...value, tenantId: 'tenant-b' })],
    ['Project', (value: AtomicResourceBundleRequest) => ({
      ...value,
      capacityRequest: { ...value.capacityRequest, projectId: 'project-b' },
    })],
    ['Profile revision', (value: AtomicResourceBundleRequest) => ({
      ...value,
      capacityRequest: {
        ...value.capacityRequest,
        workRef: { ...value.capacityRequest.workRef, profileRevisionId: 'profile-4' },
      },
    })],
    ['Profile digest', (value: AtomicResourceBundleRequest) => ({
      ...value,
      capacityRequest: {
        ...value.capacityRequest,
        workRef: { ...value.capacityRequest.workRef, profileDigest: 'sha256:other-profile' },
      },
    })],
  ])('fails closed on %s binding drift', (_name, mutate) => {
    expect(() => validateAtomicResourceBundle(validationInput({
      request: mutate(request()),
    }))).toThrow();
  });

  it('rejects a partial bundle and never returns a partial reservation', () => {
    const value = request();
    expect(() => validateAtomicResourceBundle(validationInput({
      request: {
        ...value,
        capacityRequest: {
          ...value.capacityRequest,
          resourceBundle: { demands: [value.capacityRequest.resourceBundle.demands[0]!] },
        },
      },
    }))).toThrow('model');

    expect(() => validateAtomicResourceBundle(validationInput({
      request: {
        ...value,
        capacityRequest: {
          ...value.capacityRequest,
          resourceBundle: { demands: [value.capacityRequest.resourceBundle.demands[1]!] },
        },
      },
    }))).toThrow('Executor');
  });

  it.each([
    ['unapproved pool', ceiling({
      allowedPoolIds: ['model:reasoning'],
      poolLimits: [
        { poolId: 'model:reasoning', maxCapacityUnits: 1, maxRateUnits: 10_000, maxUsageUnits: 12_000 },
      ],
    })],
    ['capacity ceiling', ceiling({ poolLimits: [
      { poolId: 'executor:sandbox', maxCapacityUnits: 1, maxRateUnits: 3, maxUsageUnits: 30 },
      { poolId: 'model:reasoning', maxCapacityUnits: 0, maxRateUnits: 10_000, maxUsageUnits: 12_000 },
    ] })],
    ['rate ceiling', ceiling({ poolLimits: [
      { poolId: 'executor:sandbox', maxCapacityUnits: 1, maxRateUnits: 3, maxUsageUnits: 30 },
      { poolId: 'model:reasoning', maxCapacityUnits: 1, maxRateUnits: 4_999, maxUsageUnits: 12_000 },
    ] })],
    ['usage ceiling', ceiling({ poolLimits: [
      { poolId: 'executor:sandbox', maxCapacityUnits: 1, maxRateUnits: 3, maxUsageUnits: 30 },
      { poolId: 'model:reasoning', maxCapacityUnits: 1, maxRateUnits: 10_000, maxUsageUnits: 9_999 },
    ] })],
    ['cost ceiling', ceiling({ maxWorstCaseCostMicros: 30_499 })],
  ])('enforces the Profile %s', (_name, profileCeiling) => {
    expect(() => validateAtomicResourceBundle(validationInput({
      profileCeiling,
    }))).toThrow();
  });

  it('rejects catalog pool capacity/rate/usage limits before any bundle is produced', () => {
    const value = request();
    const demand = value.capacityRequest.resourceBundle.demands;
    for (const resourceBundle of [
      { demands: [{ ...demand[0]!, capacityUnits: 2 }, demand[1]!] },
      { demands: [demand[0]!, { ...demand[1]!, rateUnits: 100_001 }] },
      { demands: [demand[0]!, { ...demand[1]!, budgetUnits: 20_001 }] },
    ]) {
      const profileCeiling = ceiling({
        poolLimits: [
          { poolId: 'executor:sandbox', maxCapacityUnits: 10, maxRateUnits: 100_000, maxUsageUnits: 100_000 },
          { poolId: 'model:reasoning', maxCapacityUnits: 10, maxRateUnits: 200_000, maxUsageUnits: 200_000 },
        ],
        maxWorstCaseCostMicros: 1_000_000,
      });
      expect(() => validateAtomicResourceBundle(validationInput({
        request: {
          ...value,
          capacityRequest: { ...value.capacityRequest, resourceBundle },
        },
        profileCeiling,
      }))).toThrow();
    }
  });

  it.each([
    ['region', { region: 'us-east-1' }],
    ['trust domain', { trustDomain: 'external' }],
    ['compatibility', { compatibilityGroup: 'darwin-arm64-v1' }],
  ])('requires model and Executor components to share one %s', (_name, drift) => {
    const executor = { ...POOLS[1]!, ...drift } as ResourcePoolCatalogEntry;
    const mismatchedCatalog = catalog({ pools: [POOLS[0]!, executor] });
    const profileCeiling = ceiling({ catalogDigest: mismatchedCatalog.digest });
    expect(() => validateAtomicResourceBundle(validationInput({
      request: request({
        catalogDigest: mismatchedCatalog.digest,
        catalogRevision: mismatchedCatalog.revision,
      }),
      catalog: mismatchedCatalog,
      profileCeiling,
    }))).toThrow();
  });

  it('rejects requester-supplied resource, Agent, Task, Plan, or Context metadata', () => {
    for (const field of [
      'providerId',
      'modelTier',
      'region',
      'trustDomain',
      'executorPoolId',
      'sandboxId',
      'workspaceProviderId',
      'priceMicrosPerUsageUnit',
      'capacityUnits',
      'agent',
      'task',
      'plan',
      'context',
    ]) {
      expect(() => validateAtomicResourceBundle(validationInput({
        request: { ...request(), [field]: 'untrusted' },
      }))).toThrow(field);
    }
  });
});
