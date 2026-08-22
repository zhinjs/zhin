import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileOverlayPackPromotionRepository,
  MemoryOverlayPackPromotionRepository,
  WorkroomOverlayPackPromotionRuntime,
} from '../../src/plugin-runtime/workroom-overlay-pack-promotion.js';
import {
  createCapabilityPackManifest,
  createWorkroomProfileOverlay,
  type CapabilityPackPublication,
} from '../../src/plugin-runtime/workroom-profile-authority-runtime.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

const generationView = (current = 7) => ({
  withCurrent: async <T>(input: { generation: number }, use: () => T | Promise<T>): Promise<T> => {
    if (input.generation !== current) throw new Error('Overlay promotion generation is stale');
    return await use();
  },
});

const sourceAuthority = { verify: async () => true };

const publication = (pack: ReturnType<typeof createCapabilityPackManifest>): CapabilityPackPublication => {
  const requestBody = {
    version: 1 as const, action: 'publish_pack' as const, operationId: 'shared-publish',
    authenticatedPrincipalId: 'trusted:promotion', candidateDigest: pack.digest,
  };
  const authorityRequest = Object.freeze({ ...requestBody, digest: digest(requestBody) });
  const body = {
    version: 1 as const, pack, authorityRequest,
    governance: {
      approved: true as const, requestDigest: authorityRequest.digest, decisionId: 'trusted-publish:1',
      decidedBy: 'root', authorizedBy: 'trusted_pack_publisher' as const, decidedAt: 1,
    },
  };
  return Object.freeze({ ...body, digest: digest(body) });
};

describe('Overlay to shared Capability Pack promotion', () => {
  it('retains Project provenance/owner/check/review, publishes once, and never auto-adopts another Project', async () => {
    const published: CapabilityPackPublication[] = [];
    const activePackByProject = new Map([
      ['software', 'software-local@1'], ['content', 'content-local@1'], ['customer-support', 'support-local@1'],
    ]);
    const runtime = new WorkroomOverlayPackPromotionRuntime({
      generation: 7,
      generationView: generationView(),
      repository: new MemoryOverlayPackPromotionRepository(),
      sourceAuthority,
      publisherPrincipalId: 'trusted:promotion',
      authority: {
        authorize: async request => ({
          approved: true, requestDigest: request.digest, decisionId: 'review:1', decidedBy: 'reviewer:software',
          route: request.semanticDiff.authorityExpansion ? 'sponsor' : 'reviewer',
        }),
        verify: async (request, decision) => decision.requestDigest === request.digest,
      },
      sharedPacks: {
        read: async () => undefined,
        publish: async (command) => {
          const result = publication(createCapabilityPackManifest(command.pack));
          published.push(result);
          return result;
        },
      },
    });
    const overlay = createWorkroomProfileOverlay({
      version: 1, projectId: 'software', revisionId: 'software-overlay@4', charterRevisionId: 'charter@1',
      packs: [], enabledTools: ['github.read'], enabledSkills: ['review'], enabledAgents: [], enabledWorkflows: [],
    });
    const pack = createCapabilityPackManifest({
      id: 'software-reviewed', version: '1', kind: 'competency', requires: [],
      tools: [{ id: 'github.read', digest: digest({ tool: 'github.read' }) }],
      skills: [{ id: 'review', digest: digest({ skill: 'review' }), requiresTools: ['github.read'] }],
      agents: [], workflows: [],
    });
    const sourceBody = { kind: 'acceptance_record' as const, projectId: 'software', sourceId: 'acceptance:42' };
    const result = await runtime.promote({
      version: 1, generation: 7, operationId: 'promote:software:1', promotionId: 'promotion:software:1',
      projectId: 'software', overlayRevisionId: overlay.revisionId, overlayDigest: overlay.digest,
      ownerPrincipalId: 'owner:software', sources: [{ ...sourceBody, digest: digest(sourceBody) }],
      checks: [{ id: 'tests', revision: 'ci@42', status: 'passed', digest: digest({ tests: 'passed' }) }],
      review: { reviewerPrincipalId: 'reviewer:software', decisionId: 'review:42', status: 'approved', digest: digest({ review: 42 }) },
      pack,
    }, new AbortController().signal);

    expect(result.status).toBe('published');
    expect(result.projectId).toBe('software');
    expect(result.ownerPrincipalId).toBe('owner:software');
    expect(result.overlayDigest).toBe(overlay.digest);
    expect(result.checks).toHaveLength(1);
    expect(result.review.status).toBe('approved');
    expect(published).toHaveLength(1);
    expect(activePackByProject.get('content')).toBe('content-local@1');
    expect(activePackByProject.get('customer-support')).toBe('support-local@1');
    activePackByProject.set('content', `${result.packRef.id}@${result.packRef.version}`); // explicit adoption
    expect(activePackByProject.get('content')).toBe('software-reviewed@1');
  });

  it('rejects untrusted sources, missing checks/review, stale HMR, and policy expansion without Sponsor', async () => {
    const repository = new MemoryOverlayPackPromotionRepository();
    const make = (route: 'reviewer' | 'sponsor', generation = 7) => new WorkroomOverlayPackPromotionRuntime({
      generation,
      generationView: generationView(), repository,
      sourceAuthority,
      publisherPrincipalId: 'trusted:promotion',
      authority: {
        authorize: async request => ({
          approved: true, requestDigest: request.digest, decisionId: `${route}:1`, decidedBy: `${route}:principal`, route,
        }),
        verify: async (request, decision) => decision.requestDigest === request.digest,
      },
      sharedPacks: { read: async () => undefined, publish: async command => publication(createCapabilityPackManifest(command.pack)) },
    });
    const pack = createCapabilityPackManifest({
      id: 'support-export', version: '1', kind: 'integration', requires: [],
      tools: [{ id: 'crm.export', digest: digest({ tool: 'crm.export' }) }], skills: [], agents: [], workflows: [],
    });
    const base = {
      version: 1 as const, generation: 7, operationId: 'promote:support', promotionId: 'promotion:support:1',
      projectId: 'customer-support', overlayRevisionId: 'support-overlay@2', overlayDigest: digest({ overlay: 2 }),
      ownerPrincipalId: 'owner:support',
      sources: [{
        kind: 'sponsor_decision' as const, projectId: 'customer-support', sourceId: 'sponsor:support:1',
        digest: digest({ kind: 'sponsor_decision', projectId: 'customer-support', sourceId: 'sponsor:support:1' }),
      }],
      checks: [{ id: 'privacy', revision: 'privacy@8', status: 'passed' as const, digest: digest({ privacy: 'passed' }) }],
      review: { reviewerPrincipalId: 'reviewer:privacy', decisionId: 'review:privacy:8', status: 'approved' as const, digest: digest({ review: 'privacy:8' }) },
      pack,
    };
    await expect(make('reviewer').promote(base, new AbortController().signal))
      .rejects.toThrow(/Sponsor/u);
    await expect(make('sponsor', 6).promote({ ...base, generation: 6 }, new AbortController().signal))
      .rejects.toThrow(/generation is stale/u);
    await expect(make('sponsor').promote({
      ...base,
      sources: [{ kind: 'discussion', projectId: 'customer-support', sourceId: 'chat:pii', digest: digest({ pii: true }) }] as never,
    }, new AbortController().signal)).rejects.toThrow(/source kind/u);
    await expect(make('sponsor').promote({ ...base, checks: [] }, new AbortController().signal))
      .rejects.toThrow(/check/u);
    expect(JSON.stringify(await repository.list('software'))).not.toContain('ticket-pii');
    expect(JSON.stringify(await repository.list('content'))).not.toContain('ticket-pii');
  });

  it('replays the durable published receipt after restart without publishing the shared Pack twice', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'zhin-pack-promotion-'));
    await mkdir(join(parent, '.zhin'));
    const directory = join(parent, '.zhin', 'promotions');
    let publications = 0;
    const pack = createCapabilityPackManifest({
      id: 'content-style', version: '1', kind: 'competency', requires: [], tools: [], skills: [], agents: [], workflows: [],
    });
    const sourceBody = { kind: 'trusted_pack_publication' as const, projectId: 'content', sourceId: 'pack:content:seed', packRef: { id: 'content-seed', version: '1', digest: digest({ seed: true }) } };
    const command = {
      version: 1 as const, generation: 7, operationId: 'promotion:restart', promotionId: 'promotion:content:restart',
      projectId: 'content', overlayRevisionId: 'content-overlay@2', overlayDigest: digest({ contentOverlay: 2 }),
      ownerPrincipalId: 'owner:content', sources: [{ ...sourceBody, digest: digest(sourceBody) }],
      checks: [{ id: 'editorial', revision: 'editorial@2', status: 'passed' as const, digest: digest({ editorial: 2 }) }],
      review: { reviewerPrincipalId: 'reviewer:content', decisionId: 'review:content:2', status: 'approved' as const, digest: digest({ review: 'content:2' }) },
      pack,
    };
    const make = () => new WorkroomOverlayPackPromotionRuntime({
      generation: 7, generationView: generationView(),
      repository: new FileOverlayPackPromotionRepository(directory), sourceAuthority,
      publisherPrincipalId: 'trusted:promotion',
      authority: {
        authorize: async request => ({ approved: true, requestDigest: request.digest, decisionId: 'sponsor:content:2', decidedBy: 'sponsor:content', route: 'sponsor' }),
        verify: async (request, decision) => request.digest === decision.requestDigest,
      },
      sharedPacks: {
        read: async () => undefined,
        publish: async input => {
          publications += 1;
          return publication(createCapabilityPackManifest(input.pack));
        },
      },
    });
    const first = await make().promote(command, new AbortController().signal);
    const replay = await make().promote(command, new AbortController().signal);
    expect(replay.digest).toBe(first.digest);
    expect(publications).toBe(1);
  });
});
