import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootPluginId, Scope, SnapshotStore } from '@zhin.js/plugin-runtime';
import { describe, expect, it, vi } from 'vitest';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';
import {
  WORKROOM_CONTROL_PLANE_ROOT_PRINCIPAL,
  createCatalogWorkroomProfilePublisherAuthority,
  createSnapshotWorkroomProfileGenerationView,
  digestWorkroomProfileCatalogProject,
  installWorkroomProfileAuthorityResources,
} from '../../src/plugin-runtime/workroom-profile-authority-composition.js';
import { digestWorkroomCatalogProjectBinding } from '../../src/workroom/catalog-definition.js';
import { workroomProjectProfileRegistryToken } from '../../src/plugin-runtime/workroom-assignment-authority-provider.js';
import { workroomDynamicPlanningPolicyToken } from '../../src/plugin-runtime/workroom-dynamic-planning-provider.js';
import { createWorkroomProfileOverlay } from '../../src/plugin-runtime/workroom-profile-authority-runtime.js';

const sha = (value: string): string => `sha256:${value.repeat(64).slice(0, 64)}`;

function snapshots() {
  const state = {
    root: rootPluginId(),
    tree: new Map(),
    config: new Map(),
    resources: new Map(),
    capabilities: new Map(),
    projections: new Map(),
  };
  const store = new SnapshotStore(state);
  store.commit(0, { snapshot: state, dispose: () => undefined });
  return store;
}

function generationView() {
  const body = Object.freeze({
    generation: 1,
    tools: Object.freeze([{ id: 'tool:repo', digest: sha('1') }]),
    skills: Object.freeze([{ id: 'skill:code', digest: sha('2') }]),
    agents: Object.freeze([{ id: 'agent:lead', digest: sha('3') }]),
  });
  return Object.freeze({ ...body, digest: digest(body) });
}

const pack = Object.freeze({
  id: 'pack:engineering', version: '1.0.0', kind: 'domain' as const,
  tools: Object.freeze([{ id: 'tool:repo', digest: sha('1') }]),
  skills: Object.freeze([{ id: 'skill:code', digest: sha('2'), requiresTools: ['tool:repo'] }]),
  agents: Object.freeze([{
    id: 'agent:lead', digest: sha('3'), role: 'orchestrator',
    allowedTools: ['tool:repo'], allowedSkills: ['skill:code'],
  }]),
});

describe('Workroom Profile authority production composition', () => {
  it('uses the canonical Catalog Project binding digest for planning authority', () => {
    const definition = Object.freeze({
      name: 'Alpha',
      members: Object.freeze([]),
      sponsors: Object.freeze(['human:alice']),
    });
    expect(digestWorkroomProfileCatalogProject(definition))
      .toBe(digestWorkroomCatalogProjectBinding(definition));
  });

  it('holds one current Snapshot lease for the complete operation and releases it on failure', async () => {
    const store = snapshots();
    const acquire = vi.spyOn(store, 'acquire');
    const view = createSnapshotWorkroomProfileGenerationView({
      generation: 1,
      snapshots: store,
      resolve: () => generationView(),
    });
    await expect(view.withCurrent({
      operationId: 'profile:op', generation: 1, signal: new AbortController().signal,
    }, async () => {
      expect(acquire.mock.results[0]?.value.active).toBe(true);
      throw new Error('operation failed');
    })).rejects.toThrow('operation failed');
    expect(acquire.mock.results[0]?.value.active).toBe(false);

    store.commit(1, {
      snapshot: {
        root: rootPluginId(), tree: new Map(), config: new Map(), resources: new Map(),
        capabilities: new Map(), projections: new Map(),
      },
      dispose: () => undefined,
    });
    await expect(view.withCurrent({
      operationId: 'profile:stale', generation: 1, signal: new AbortController().signal,
    }, async value => value)).rejects.toThrow('no longer current');

    const tampered = createSnapshotWorkroomProfileGenerationView({
      generation: 2,
      snapshots: store,
      resolve: () => ({ ...generationView(), generation: 2, tools: [] }),
    });
    await expect(tampered.withCurrent({
      operationId: 'profile:tampered', generation: 2, signal: new AbortController().signal,
    }, async value => value)).rejects.toThrow('malformed');
  });

  it('publishes only governed readers and makes a saved Profile immediately visible without restart', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-profile-composition-'));
    await mkdir(join(projectRoot, '.zhin'));
    const scope = new Scope(rootPluginId());
    const catalog = Object.freeze({
      read: async () => Object.freeze({
        revision: sha('c'),
        definitions: Object.freeze({
          alpha: Object.freeze({
            name: 'Alpha', members: Object.freeze([]),
            sponsors: Object.freeze([WORKROOM_CONTROL_PLANE_ROOT_PRINCIPAL]),
          }),
        }),
      }),
    });
    const installed = installWorkroomProfileAuthorityResources({
      projectRoot,
      generation: 1,
      signal: new AbortController().signal,
      snapshots: snapshots(),
      resources: scope,
      authority: createCatalogWorkroomProfilePublisherAuthority({
        catalog,
        trustedPackPublishers: [WORKROOM_CONTROL_PLANE_ROOT_PRINCIPAL],
        decisionDirectory: join(projectRoot, '.zhin', 'workroom-profile-authority-decisions'),
        now: () => 100,
      }),
      resolveGenerationView: () => generationView(),
    });
    expect(scope.has(workroomProjectProfileRegistryToken)).toBe(true);
    expect(scope.has(workroomDynamicPlanningPolicyToken)).toBe(true);
    expect(scope.snapshot).not.toHaveProperty('control');

    const publication = await installed.control.publishPack({
      version: 1, operationId: 'pack:1',
      authenticatedPrincipalId: WORKROOM_CONTROL_PLANE_ROOT_PRINCIPAL,
      pack,
    }, new AbortController().signal);
    const overlay = createWorkroomProfileOverlay({
      version: 1, projectId: 'alpha', revisionId: 'profile:r1', charterRevisionId: 'charter:r1',
      packs: [publication.pack], enabledTools: ['tool:repo'], enabledSkills: ['skill:code'],
      enabledAgents: ['agent:lead'], enabledWorkflows: [],
    });
    const saved = await installed.control.publishProfile({
      version: 1, operationId: 'profile:1',
      authenticatedPrincipalId: WORKROOM_CONTROL_PLANE_ROOT_PRINCIPAL,
      projectId: 'alpha', expectedRegistryRevision: -1, overlay,
      source: { kind: 'sponsor_decision', sourceId: 'console:profile:1' }, activate: true,
    }, new AbortController().signal);

    expect((await scope.use(workroomProjectProfileRegistryToken).read('alpha')).active)
      .toEqual(saved.active);

    const { digest: _overlayDigest, ...overlayInput } = overlay;
    const secondOverlay = createWorkroomProfileOverlay({
      ...overlayInput, revisionId: 'profile:r2', parentRevisionId: 'profile:r1',
    });
    const second = await installed.control.publishProfile({
      version: 1, operationId: 'profile:2',
      authenticatedPrincipalId: WORKROOM_CONTROL_PLANE_ROOT_PRINCIPAL,
      projectId: 'alpha', expectedRegistryRevision: saved.registryRevision, overlay: secondOverlay,
      source: { kind: 'sponsor_decision', sourceId: 'console:profile:2' }, activate: true,
    }, new AbortController().signal);
    const rollbackOverlay = createWorkroomProfileOverlay({
      ...overlayInput, revisionId: 'profile:r3', parentRevisionId: 'profile:r2',
    });
    const rolledBack = await installed.control.publishRollback({
      version: 1, operationId: 'profile:rollback:3',
      authenticatedPrincipalId: WORKROOM_CONTROL_PLANE_ROOT_PRINCIPAL,
      projectId: 'alpha', expectedRegistryRevision: second.registryRevision,
      restoredFromRevisionId: 'profile:r1', overlay: rollbackOverlay,
      source: { kind: 'sponsor_decision', sourceId: 'console:profile:rollback:3' }, activate: true,
    }, new AbortController().signal);
    expect(rolledBack.revisions['profile:r3']?.restoredFromRevisionId).toBe('profile:r1');
  });

  it('does not turn authenticated Console scope into Sponsor or Pack publisher authority', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-profile-authority-deny-'));
    await mkdir(join(projectRoot, '.zhin'));
    const catalog = Object.freeze({
      read: async () => Object.freeze({
        revision: sha('c'),
        definitions: Object.freeze({
          alpha: Object.freeze({ name: 'Alpha', members: Object.freeze([]), sponsors: Object.freeze(['human:alice']) }),
        }),
      }),
    });
    const authority = createCatalogWorkroomProfilePublisherAuthority({
      catalog,
      trustedPackPublishers: ['publisher:release'],
      decisionDirectory: join(projectRoot, '.zhin', 'workroom-profile-authority-decisions'),
      now: () => 100,
    });
    const packRequest = Object.freeze({
      version: 1 as const, action: 'publish_pack' as const, operationId: 'pack:forged',
      authenticatedPrincipalId: WORKROOM_CONTROL_PLANE_ROOT_PRINCIPAL,
      candidateDigest: sha('1'), digest: sha('2'),
    });
    expect(await authority.authorize(packRequest)).toEqual(expect.objectContaining({
      approved: false, reason: 'principal_is_not_trusted_pack_publisher',
    }));
    const profileRequest = Object.freeze({
      version: 1 as const, action: 'publish_profile' as const, operationId: 'profile:forged',
      authenticatedPrincipalId: WORKROOM_CONTROL_PLANE_ROOT_PRINCIPAL,
      candidateDigest: sha('1'), projectId: 'alpha', digest: sha('2'),
    });
    expect(await authority.authorize(profileRequest)).toEqual(expect.objectContaining({
      approved: false, reason: 'principal_is_not_project_sponsor',
    }));
  });

  it('verifies the immutable authorization snapshot after Sponsor membership changes', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-profile-authority-history-'));
    await mkdir(join(projectRoot, '.zhin'));
    let sponsors: readonly string[] = ['human:alice'];
    const catalog = Object.freeze({
      read: async () => Object.freeze({
        revision: sha(sponsors.length ? 'c' : 'd'),
        definitions: Object.freeze({
          alpha: Object.freeze({ name: 'Alpha', members: Object.freeze([]), sponsors }),
        }),
      }),
    });
    const directory = join(projectRoot, '.zhin', 'workroom-profile-authority-decisions');
    const authority = createCatalogWorkroomProfilePublisherAuthority({
      catalog, trustedPackPublishers: [], decisionDirectory: directory, now: () => 100,
    });
    const request = Object.freeze({
      version: 1 as const, action: 'publish_profile' as const, operationId: 'profile:authorized',
      authenticatedPrincipalId: 'human:alice', candidateDigest: sha('1'), projectId: 'alpha', digest: sha('2'),
    });
    const decision = await authority.authorize(request);
    expect(decision.approved).toBe(true);
    sponsors = [];
    const restarted = createCatalogWorkroomProfilePublisherAuthority({
      catalog, trustedPackPublishers: [], decisionDirectory: directory, now: () => 200,
    });
    if (!decision.approved) throw new Error('expected approved decision');
    expect(await restarted.verify(request, decision)).toBe(true);

    const neverAuthorized = Object.freeze({
      ...request, operationId: 'profile:never-authorized', digest: sha('3'),
    });
    sponsors = ['human:alice'];
    expect(await restarted.verify(neverAuthorized, decision)).toBe(false);
  });
});
