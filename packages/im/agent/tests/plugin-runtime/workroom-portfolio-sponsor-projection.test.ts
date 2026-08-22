import {
  createGovernedPortfolioSponsorProjectionReader,
  createPortfolioSponsorHumanIngressControlPort,
  portfolioSponsorCommandAuthorityToken,
  portfolioSponsorCommandToken,
} from '../../src/plugin-runtime/workroom-portfolio-sponsor.js';
import {
  Scope,
  childPluginId,
  rootPluginId,
} from '@zhin.js/plugin-runtime';
import type { PortfolioSponsorProjection } from '../../src/portfolio/sponsor-projection.js';

describe('governed Portfolio Sponsor projection', () => {
  it('revalidates every current Project against the token principal on every read', async () => {
    let allowedProjects = new Set(['alpha']);
    const authorizations: string[] = [];
    const reader = createGovernedPortfolioSponsorProjectionReader({
      source: { read: async () => projection() },
      authority: {
        authorize: async input => {
          authorizations.push(`${input.recipientPrincipalId}:${input.projectId}`);
          return allowedProjects.has(input.projectId)
            ? { catalogRevision: 'catalog:1', projectDigest: 'sha256:project',
                governanceDigest: 'sha256:governance', bindingDigest: `sha256:${input.projectId}` }
            : null;
        },
      },
    });

    await expect(reader.read('portfolio-main', { principalId: 'human:alice' }))
      .resolves.toEqual({ status: 'forbidden' });
    expect(authorizations).toEqual(['human:alice:alpha', 'human:alice:beta']);

    allowedProjects = new Set(['alpha', 'beta']);
    await expect(reader.read('portfolio-main', { principalId: 'human:alice' }))
      .resolves.toEqual({ status: 'ready', projection: projection() });

    allowedProjects = new Set();
    await expect(reader.read('portfolio-main', { principalId: 'human:alice' }))
      .resolves.toEqual({ status: 'forbidden' });
  });

  it('fails closed for empty Portfolio membership and malformed principals', async () => {
    const reader = createGovernedPortfolioSponsorProjectionReader({
      source: { read: async () => ({ ...projection(), projects: {} }) },
      authority: { authorize: async () => ({ catalogRevision: 'catalog:1', projectDigest: 'sha256:p',
        governanceDigest: 'sha256:g', bindingDigest: 'sha256:b' }) },
    });
    await expect(reader.read('portfolio-main', { principalId: '' }))
      .resolves.toEqual({ status: 'forbidden' });
    await expect(reader.read('portfolio-main', { principalId: 'human:alice' }))
      .resolves.toEqual({ status: 'forbidden' });
  });

  it('keeps raw Sponsor command and authority capabilities private to Root composition', () => {
    const rootId = rootPluginId();
    const root = new Scope(rootId);
    const plugin = new Scope(childPluginId(rootId, 'untrusted-feature'), root);
    const command = { read: async () => projection(), execute: async () => projection() };
    const authority = { authorize: async () => undefined };
    root.provide(portfolioSponsorCommandToken, command);
    root.provide(portfolioSponsorCommandAuthorityToken, authority);

    expect(root.use(portfolioSponsorCommandToken)).toBe(command);
    expect(root.use(portfolioSponsorCommandAuthorityToken)).toBe(authority);
    expect(plugin.has(portfolioSponsorCommandToken)).toBe(false);
    expect(plugin.has(portfolioSponsorCommandAuthorityToken)).toBe(false);
    expect(() => plugin.use(portfolioSponsorCommandToken)).toThrow('Missing resource');
    expect(() => plugin.use(portfolioSponsorCommandAuthorityToken)).toThrow('Missing resource');

    root.seal();
    plugin.seal();
    expect(root.snapshot().has(portfolioSponsorCommandToken.id)).toBe(false);
    expect(root.snapshot().has(portfolioSponsorCommandAuthorityToken.id)).toBe(false);
  });

  it('accepts only explicit Project-scoped typed Portfolio commands in Sponsor Room ingress', async () => {
    const execute = vi.fn(async () => projection());
    const port = createPortfolioSponsorHumanIngressControlPort({
      resolve: () => ({ execute, read: async () => projection() }),
      generationSignal: new AbortController().signal,
    });
    const base = {
      version: 1 as const,
      operationId: 'operation-1', projectId: 'alpha', projectRevision: 'catalog-1',
      projectDigest: `sha256:${'a'.repeat(64)}`,
      orchestratorAgentDefinitionId: 'orchestrator',
      orchestratorAuthorityDigest: `sha256:${'b'.repeat(64)}`,
      principalId: 'human:alice', authorityRequirement: 'typed_sponsor_control' as const,
      source: { version: 1 as const, ref: 'event:1', digest: `sha256:${'c'.repeat(64)}`,
        sequence: 1, conversationKey: 'sponsor-room', eventId: 'event-1', text: '', event: {} as never },
    };
    await expect(port.apply({ ...base,
      text: '/control portfolio portfolio-main project alpha lane 1 urgent command-1',
    })).resolves.toMatchObject({ status: 'authorized' });
    expect(execute).toHaveBeenCalledWith('portfolio-main', {
      kind: 'set_lane', commandId: 'command-1', projectId: 'alpha',
      expectedProjectRevision: 1, lane: 'urgent',
    }, { principalId: 'human:alice' });
    await expect(port.apply({ ...base,
      text: '/control portfolio portfolio-main status 1 paused command-no-selector',
    })).resolves.toMatchObject({ status: 'clarification_required', reason: 'missing_control_target' });
    await expect(port.apply({ ...base,
      projectionReply: {
        version: 1, projectionId: 'projection-card', projectId: 'alpha', bindingRevision: 1,
        messageKey: 'sponsor-room:portfolio-card', targetDigest: `sha256:${'d'.repeat(64)}`,
      },
      text: '/control portfolio portfolio-main status 1 paused command-reply',
    })).resolves.toMatchObject({ status: 'authorized' });
    expect(execute).toHaveBeenLastCalledWith('portfolio-main', {
      kind: 'set_status', commandId: 'command-reply', projectId: 'alpha',
      expectedProjectRevision: 1, status: 'paused',
    }, { principalId: 'human:alice' });
    await expect(port.apply({ ...base,
      source: { ...base.source, event: { type: 'message.created',
        message: { replyTo: { id: 'ordinary-human-message' } } } as never },
      text: '/control portfolio portfolio-main status 1 paused command-forged-reply',
    })).resolves.toMatchObject({ status: 'clarification_required', reason: 'missing_control_target' });
    await expect(port.apply({ ...base,
      text: '/control portfolio portfolio-main project beta lane 1 urgent command-2',
    })).resolves.toMatchObject({ status: 'clarification_required', reason: 'missing_control_target' });
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

function projection(): PortfolioSponsorProjection {
  return {
    version: 1,
    portfolioId: 'portfolio-main',
    sourceSequence: 4,
    clock: { now: 10, sequence: 4, digest: 'sha256:clock' },
    policy: { revision: 1, digest: 'sha256:policy' },
    globalBudget: { limitMicros: 10, reservedMicros: 0, spentMicros: 0, availableMicros: 10 },
    projects: {
      alpha: project('alpha'),
      beta: project('beta'),
    },
    digest: 'sha256:projection',
  };
}

function project(projectId: string): PortfolioSponsorProjection['projects'][string] {
  return {
    projectId,
    policyRevision: 1,
    lane: 'normal',
    status: 'active',
    weight: 1,
    grants: [],
    reclaims: [],
    budget: { limitMicros: 5, reservedMicros: 0, spentMicros: 0, availableMicros: 5 },
    rate: {},
    blockers: [],
    fairness: { normalizedService: 0, weight: 1, weightedService: 0, normalizedAtSequence: 4 },
  };
}
