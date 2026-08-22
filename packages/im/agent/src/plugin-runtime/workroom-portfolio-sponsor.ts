import { createRootPrivateToken } from '@zhin.js/plugin-runtime';
import {
  PortfolioAdmissionApplication,
  type PortfolioAdmissionState,
} from '../portfolio/portfolio-admission.js';
import {
  parsePortfolioProjectPolicy,
  type PortfolioGovernanceProof,
  type PortfolioJournalRepository,
  type PortfolioLane,
  type PortfolioProjectPolicy,
  type PortfolioProjectStatus,
} from '../portfolio/portfolio-journal.js';
import {
  createPortfolioSponsorProjection,
  type PortfolioSponsorProjection,
} from '../portfolio/sponsor-projection.js';
export type { PortfolioSponsorProjection } from '../portfolio/sponsor-projection.js';
import {
  compareCanonicalWorkroomText,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import type { WorkroomCatalog } from '../workroom/catalog.js';
import type { WorkroomProjectionReadAuthorityPort } from '../workroom/runtime.js';
import type {
  HumanIngressTypedControlDecision,
  HumanIngressTypedControlInput,
  HumanIngressTypedControlPort,
} from '../workroom/human-ingress-orchestrator.js';

export interface PortfolioSponsorAuthenticatedPrincipal {
  readonly principalId: string;
}

export type PortfolioSponsorCommand =
  | Readonly<{
      kind: 'set_lane'; commandId: string; projectId: string;
      expectedProjectRevision: number; lane: PortfolioLane;
    }>
  | Readonly<{
      kind: 'set_status'; commandId: string; projectId: string;
      expectedProjectRevision: number; status: PortfolioProjectStatus;
    }>
  | Readonly<{
      kind: 'transfer_budget'; commandId: string; fromProjectId: string; toProjectId: string;
      amountMicros: number; expectedFromRevision: number; expectedToRevision: number;
    }>;

export interface PortfolioSponsorCommandAuthorization {
  readonly commandDigest: string;
  readonly sourceSequence: number;
  readonly authorizedBy: string;
  readonly projectProofs: Readonly<Record<string, PortfolioGovernanceProof>>;
}

export interface PortfolioSponsorCommandAuthorityPort {
  authorize(input: Readonly<{
    generation: number;
    portfolioId: string;
    sourceSequence: number;
    command: PortfolioSponsorCommand;
    commandDigest: string;
    projectCandidates: readonly PortfolioProjectPolicy[];
    authenticatedPrincipal: PortfolioSponsorAuthenticatedPrincipal;
  }>): Promise<PortfolioSponsorCommandAuthorization | undefined>;
}

export interface PortfolioSponsorCommandPort {
  execute(
    portfolioId: string,
    command: PortfolioSponsorCommand,
    authenticatedPrincipal: PortfolioSponsorAuthenticatedPrincipal,
  ): Promise<PortfolioSponsorProjection>;
  read(portfolioId: string): Promise<PortfolioSponsorProjection>;
}

export type PortfolioSponsorProjectionReadResult =
  | Readonly<{ status: 'ready'; projection: PortfolioSponsorProjection }>
  | Readonly<{ status: 'forbidden' }>;

/** Authenticated, per-request Portfolio projection; raw Portfolio reads stay Root-internal. */
export interface PortfolioSponsorProjectionReadPort {
  read(
    portfolioId: string,
    authenticatedPrincipal: PortfolioSponsorAuthenticatedPrincipal,
  ): Promise<PortfolioSponsorProjectionReadResult>;
}

/**
 * Joins the exact Portfolio Project set to the current Catalog/P12 Console authority.
 * A principal must remain authorized for every Project because the aggregate budget and
 * fairness fields disclose cross-Project state even though the payload is content-free.
 */
export function createGovernedPortfolioSponsorProjectionReader(options: Readonly<{
  source: Pick<PortfolioSponsorCommandPort, 'read'>;
  authority: WorkroomProjectionReadAuthorityPort;
}>): PortfolioSponsorProjectionReadPort {
  return Object.freeze({
    async read(
      portfolioId: string,
      authenticatedPrincipal: PortfolioSponsorAuthenticatedPrincipal,
    ): Promise<PortfolioSponsorProjectionReadResult> {
      const principalId = authenticatedPrincipal?.principalId?.trim();
      if (!principalId || principalId !== authenticatedPrincipal.principalId) {
        return Object.freeze({ status: 'forbidden' as const });
      }
      const projection = await options.source.read(portfolioId);
      const projectIds = Object.keys(projection.projects).sort();
      if (projectIds.length === 0) return Object.freeze({ status: 'forbidden' as const });
      for (const projectId of projectIds) {
        const authorization = await options.authority.authorize({
          destination: 'console',
          projectId,
          recipientPrincipalId: principalId,
          requestedMode: 'metadata_only',
        });
        if (!authorization) return Object.freeze({ status: 'forbidden' as const });
      }
      return Object.freeze({ status: 'ready' as const, projection });
    },
  });
}

export const portfolioSponsorCommandAuthorityToken = createRootPrivateToken<PortfolioSponsorCommandAuthorityPort>(
  'zhin.agent.portfolio-sponsor-command-authority',
  'Authenticated exact Sponsor authority for typed Portfolio policy commands',
);

export const portfolioSponsorCommandToken = createRootPrivateToken<PortfolioSponsorCommandPort>(
  'zhin.agent.portfolio-sponsor-command',
  'Generation-owned typed Portfolio Sponsor command application',
);

/** Strict Sponsor Room adapter; Portfolio/Project/principal come from authenticated ingress. */
export function createPortfolioSponsorHumanIngressControlPort(options: Readonly<{
  resolve: () => PortfolioSponsorCommandPort | undefined;
  generationSignal: AbortSignal;
  fallback?: HumanIngressTypedControlPort;
}>): HumanIngressTypedControlPort {
  return Object.freeze({
    async apply(input: HumanIngressTypedControlInput): Promise<HumanIngressTypedControlDecision> {
      options.generationSignal.throwIfAborted();
      if (!/^\/control\s+portfolio(?:\s|$)/iu.test(input.text.trim())) {
        return options.fallback
          ? await options.fallback.apply(input)
          : controlClarification('missing_control_target');
      }
      if (input.authorityRequirement !== 'typed_sponsor_control') {
        return controlClarification('unauthorized_control');
      }
      const parsed = parsePortfolioHumanIngressCommand(input);
      if (!parsed) return controlClarification('missing_control_target');
      const port = options.resolve();
      if (!port) return controlClarification('unauthorized_control');
      const projection = await port.execute(parsed.portfolioId, parsed.command, {
        principalId: required(input.principalId, 'authenticatedPrincipal.principalId'),
      });
      options.generationSignal.throwIfAborted();
      const receiptRef = `portfolio-sponsor:${digest({
        operationId: input.operationId,
        commandId: parsed.command.commandId,
      })}`;
      return deepFreeze({
        status: 'authorized' as const,
        receiptRef,
        receiptDigest: digest({
          version: 1,
          kind: 'portfolio_sponsor_control',
          operationDigest: digest({ operationId: input.operationId }),
          portfolioId: parsed.portfolioId,
          projectId: input.projectId,
          commandDigest: digest(parsed.command),
          projectionDigest: projection.digest,
        }),
      });
    },
  });
}

export class WorkroomPortfolioSponsorRuntime implements PortfolioSponsorCommandPort {
  readonly #applications = new Map<string, PortfolioAdmissionApplication>();

  constructor(readonly options: Readonly<{
    generation: number;
    repository: PortfolioJournalRepository;
    authority: PortfolioSponsorCommandAuthorityPort;
  }>) {
    positive(options.generation, 'generation');
  }

  async execute(
    portfolioId: string,
    input: PortfolioSponsorCommand,
    authenticatedPrincipal: PortfolioSponsorAuthenticatedPrincipal,
  ): Promise<PortfolioSponsorProjection> {
    const id = required(portfolioId, 'portfolioId');
    const command = parseCommand(input);
    const application = this.#application(id);
    const state = await application.read();
    const candidates = commandCandidates(state, command);
    const commandDigest = digest(command);
    const authorization = await this.options.authority.authorize({
      generation: this.options.generation,
      portfolioId: id,
      sourceSequence: state.sequence,
      command,
      commandDigest,
      projectCandidates: candidates,
      authenticatedPrincipal: Object.freeze({
        principalId: required(authenticatedPrincipal?.principalId, 'authenticatedPrincipal.principalId'),
      }),
    });
    assertAuthorization(authorization, state.sequence, commandDigest, candidates);
    await application.updateProjectPolicies(candidates, authorization.projectProofs);
    return createPortfolioSponsorProjection(await application.read());
  }

  async read(portfolioId: string): Promise<PortfolioSponsorProjection> {
    return createPortfolioSponsorProjection(await this.#application(required(portfolioId, 'portfolioId')).read());
  }

  #application(portfolioId: string): PortfolioAdmissionApplication {
    let application = this.#applications.get(portfolioId);
    if (!application) {
      application = new PortfolioAdmissionApplication({
        portfolioId,
        repository: this.options.repository,
        ids: { eventId: (type, identity) => `${type}:${encodeURIComponent(identity)}` },
      });
      this.#applications.set(portfolioId, application);
    }
    return application;
  }
}

/** Current Catalog membership is re-read for every command; full HTTP scope alone grants nothing. */
export function createCatalogPortfolioSponsorCommandAuthority(
  catalog: Pick<WorkroomCatalog, 'read'>,
): PortfolioSponsorCommandAuthorityPort {
  return Object.freeze({
    async authorize(input: Parameters<PortfolioSponsorCommandAuthorityPort['authorize']>[0]) {
      const snapshot = await catalog.read();
      const principalId = required(input.authenticatedPrincipal.principalId, 'authenticatedPrincipal.principalId');
      for (const candidate of input.projectCandidates) {
        const definition = snapshot.definitions[candidate.projectId];
        if (!definition || definition.enabled === false || !definition.sponsors?.includes(principalId)) {
          return undefined;
        }
      }
      const authorizedBy = [
        'workroom-catalog-portfolio-sponsor:v1', snapshot.revision, principalId,
      ].map(encodeURIComponent).join(':');
      const reasonDigest = digest({
        version: 1, portfolioId: input.portfolioId, sourceSequence: input.sourceSequence,
        commandDigest: input.commandDigest, catalogRevision: snapshot.revision, principalId,
      });
      return Object.freeze({
        commandDigest: input.commandDigest,
        sourceSequence: input.sourceSequence,
        authorizedBy,
        projectProofs: Object.freeze(Object.fromEntries(input.projectCandidates.map((candidate: PortfolioProjectPolicy) => [
          candidate.projectId,
          Object.freeze({
            principalId,
            authorizedBy,
            reasonDigest,
            targetDigest: digest(candidate),
            expectedRevision: candidate.revision - 1,
          }),
        ]))),
      });
    },
  });
}

function parseCommand(value: PortfolioSponsorCommand): PortfolioSponsorCommand {
  const common = ['kind', 'commandId'];
  if (value.kind === 'set_lane') {
    exactKeys(value, [...common, 'projectId', 'expectedProjectRevision', 'lane']);
    if (!['urgent', 'high', 'normal', 'low'].includes(value.lane)) throw new Error('Sponsor lane is invalid');
    return Object.freeze({ ...value, commandId: required(value.commandId, 'commandId'),
      projectId: required(value.projectId, 'projectId'),
      expectedProjectRevision: positive(value.expectedProjectRevision, 'expectedProjectRevision') });
  }
  if (value.kind === 'set_status') {
    exactKeys(value, [...common, 'projectId', 'expectedProjectRevision', 'status']);
    if (!['active', 'paused', 'reclaim_checkpointable'].includes(value.status)) {
      throw new Error('Sponsor Project status is invalid');
    }
    return Object.freeze({ ...value, commandId: required(value.commandId, 'commandId'),
      projectId: required(value.projectId, 'projectId'),
      expectedProjectRevision: positive(value.expectedProjectRevision, 'expectedProjectRevision') });
  }
  if (value.kind === 'transfer_budget') {
    exactKeys(value, [...common, 'fromProjectId', 'toProjectId', 'amountMicros',
      'expectedFromRevision', 'expectedToRevision']);
    const fromProjectId = required(value.fromProjectId, 'fromProjectId');
    const toProjectId = required(value.toProjectId, 'toProjectId');
    if (fromProjectId === toProjectId) throw new Error('Budget transfer Projects must differ');
    return Object.freeze({ ...value, commandId: required(value.commandId, 'commandId'),
      fromProjectId, toProjectId, amountMicros: positive(value.amountMicros, 'amountMicros'),
      expectedFromRevision: positive(value.expectedFromRevision, 'expectedFromRevision'),
      expectedToRevision: positive(value.expectedToRevision, 'expectedToRevision') });
  }
  throw new Error('Portfolio Sponsor command exact schema is invalid');
}

function parsePortfolioHumanIngressCommand(input: HumanIngressTypedControlInput): Readonly<{
  portfolioId: string;
  command: PortfolioSponsorCommand;
}> | undefined {
  const prefix = /^\/control\s+portfolio\s+(\S+)\s+(.+)$/iu.exec(input.text.trim());
  if (!prefix) return undefined;
  const portfolioId = required(prefix[1], 'portfolioId');
  let commandText = required(prefix[2], 'Portfolio command');
  const scoped = /^project\s+(\S+)\s+(.+)$/iu.exec(commandText);
  if (scoped) {
    if (scoped[1] !== input.projectId) return undefined;
    commandText = required(scoped[2], 'Portfolio command');
  } else if (input.projectionReply?.projectId !== input.projectId) {
    return undefined;
  }
  let match = /^lane\s+(\d+)\s+(urgent|high|normal|low)\s+(\S+)$/iu.exec(commandText);
  if (match) {
    return deepFreeze({
      portfolioId,
      command: {
        kind: 'set_lane', commandId: required(match[3], 'commandId'),
        projectId: required(input.projectId, 'projectId'),
        expectedProjectRevision: positive(Number(match[1]), 'expectedProjectRevision'),
        lane: match[2]!.toLowerCase() as PortfolioLane,
      },
    });
  }
  match = /^status\s+(\d+)\s+(active|paused|reclaim_checkpointable)\s+(\S+)$/iu.exec(commandText);
  if (match) {
    return deepFreeze({
      portfolioId,
      command: {
        kind: 'set_status', commandId: required(match[3], 'commandId'),
        projectId: required(input.projectId, 'projectId'),
        expectedProjectRevision: positive(Number(match[1]), 'expectedProjectRevision'),
        status: match[2]!.toLowerCase() as PortfolioProjectStatus,
      },
    });
  }
  match = /^transfer-budget\s+(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)$/iu.exec(commandText);
  if (!match) return undefined;
  return deepFreeze({
    portfolioId,
    command: {
      kind: 'transfer_budget', commandId: required(match[5], 'commandId'),
      fromProjectId: required(input.projectId, 'fromProjectId'),
      toProjectId: required(match[1], 'toProjectId'),
      amountMicros: positive(Number(match[2]), 'amountMicros'),
      expectedFromRevision: positive(Number(match[3]), 'expectedFromRevision'),
      expectedToRevision: positive(Number(match[4]), 'expectedToRevision'),
    },
  });
}

function controlClarification(
  reason: 'missing_control_target' | 'unauthorized_control',
): HumanIngressTypedControlDecision {
  return deepFreeze({ status: 'clarification_required' as const, reason, candidateRefs: [] });
}

function commandCandidates(
  state: PortfolioAdmissionState,
  command: PortfolioSponsorCommand,
): readonly PortfolioProjectPolicy[] {
  const policy = state.policy;
  if (!policy) throw new Error('Portfolio Sponsor command requires pinned Policy');
  if (command.kind === 'set_lane' || command.kind === 'set_status') {
    const current = requireProject(policy.projects[command.projectId], command.projectId);
    if (current.revision !== command.expectedProjectRevision) throw new Error('Sponsor command Project revision is stale');
    return Object.freeze([parsePortfolioProjectPolicy({
      ...current,
      revision: current.revision + 1,
      ...(command.kind === 'set_lane' ? { lane: command.lane } : { status: command.status }),
    })]);
  }
  const from = requireProject(policy.projects[command.fromProjectId], command.fromProjectId);
  const to = requireProject(policy.projects[command.toProjectId], command.toProjectId);
  if (from.revision !== command.expectedFromRevision || to.revision !== command.expectedToRevision) {
    throw new Error('Sponsor Budget transfer Project revision is stale');
  }
  if (from.hardBudgetMicros < command.amountMicros) throw new Error('Sponsor Budget transfer exceeds source allocation');
  return Object.freeze([
    parsePortfolioProjectPolicy({ ...from, revision: from.revision + 1,
      hardBudgetMicros: from.hardBudgetMicros - command.amountMicros }),
    parsePortfolioProjectPolicy({ ...to, revision: to.revision + 1,
      hardBudgetMicros: to.hardBudgetMicros + command.amountMicros }),
  ].sort((left, right) => compareCanonicalWorkroomText(left.projectId, right.projectId)));
}

function assertAuthorization(
  value: PortfolioSponsorCommandAuthorization | undefined,
  sourceSequence: number,
  commandDigest: string,
  candidates: readonly PortfolioProjectPolicy[],
): asserts value is PortfolioSponsorCommandAuthorization {
  if (!value || value.sourceSequence !== sourceSequence || value.commandDigest !== commandDigest
    || !required(value.authorizedBy, 'authorizedBy')) {
    throw new Error('Portfolio Sponsor command authority is unavailable or stale');
  }
  exactKeys(value, ['commandDigest', 'sourceSequence', 'authorizedBy', 'projectProofs']);
  const projectIds = candidates.map(candidate => candidate.projectId).sort();
  if (Object.keys(value.projectProofs).sort().join('\0') !== projectIds.join('\0')) {
    throw new Error('Portfolio Sponsor command authority Project scope drift');
  }
}

function requireProject(value: PortfolioProjectPolicy | undefined, projectId: string): PortfolioProjectPolicy {
  if (!value) throw new Error(`Unknown Portfolio Project ${projectId}`);
  return value;
}

function exactKeys(value: object, requiredKeys: readonly string[]): void {
  const actual = Object.keys(value);
  if (actual.length !== requiredKeys.length || requiredKeys.some(key => !Object.hasOwn(value, key))) {
    throw new Error('Portfolio Sponsor command exact schema is invalid');
  }
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${label} is invalid`);
  return value;
}

function positive(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} is invalid`);
  return Number(value);
}
