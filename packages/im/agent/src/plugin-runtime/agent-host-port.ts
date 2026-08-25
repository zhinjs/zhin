import { createToken } from '@zhin.js/plugin-runtime';
import type { AssistantRuntimeHandle } from '../assistant/runtime-contract.js';
import type { WorkroomRuntimeHandle } from '../workroom/runtime.js';
import type { SessionTreeRuntimeHandle } from '../session-tree-runtime.js';
import type { AgentTraceRuntimeHandle } from './agent-trace-runtime.js';
import type { ResolvedAgentBinding } from '../config/types.js';
import type { TurnOutcome, TurnRequest } from '../turn/turn-ingress.js';
import type { WorkroomCatalog } from '../workroom/catalog.js';
import type {
  PublishCapabilityPackCommand,
  PublishPlanningPolicyCommand,
  PublishProjectProfileCommand,
  PublishProjectProfileRollbackCommand,
  WorkroomProfileControlPort,
} from './workroom-profile-authority-runtime.js';
import type {
  PortfolioSponsorCommandPort,
  PortfolioSponsorProjectionReadPort,
} from './workroom-portfolio-sponsor.js';
import type {
  WorkroomEffectSponsorDecisionCommand,
  WorkroomEffectSponsorDecisionRecord,
} from './workroom-acceptance-production-composition.js';
import type {
  ProjectKnowledgeEntry,
  ProjectKnowledgeSnapshot,
} from '../workroom/project-knowledge-registry.js';
import type { WorkroomDataLifecycleConsoleControlPort } from './workroom-data-lifecycle-console.js';
import type {
  WorkroomRunControlCommand,
  WorkroomRunControlReceipt,
} from '../workroom/workroom-run-control.js';

/**
 * Stable Host boundary for protocols that expose Agent capabilities externally.
 * Consumers must not reach into CLI installer state or the legacy Plugin graph.
 */
export interface AgentHostPort {
  readonly protocol: AgentHostProtocolPort;
  readonly introspection: AgentHostIntrospectionPort;
  readonly console: AgentHostConsolePort;
}

/**
 * Canonical protocol seam. A2A/HTTP adapters may enumerate configured
 * bindings and submit a TurnRequest, but concrete AIService/ZhinAgent objects
 * never escape the Agent Host.
 */
export interface AgentHostProtocolPort {
  listBindings(): readonly ResolvedAgentBinding[];
  execute(bindingName: string, request: TurnRequest): Promise<TurnOutcome>;
}

export interface AgentHostToolSummary {
  readonly name: string;
  readonly description?: string;
  readonly hidden?: boolean;
}

export interface AgentHostMcpSummary {
  readonly name: string;
  readonly connected: boolean;
  readonly toolCount: number;
}

/** Read-only projection for Console; no concrete ZhinAgent may escape through it. */
export interface AgentHostIntrospectionPort {
  listTools(): readonly AgentHostToolSummary[];
  listMcpServers(): readonly AgentHostMcpSummary[];
}

export interface AgentHostConsolePort {
  readonly sessionTree: SessionTreeRuntimeHandle;
  readonly workroom: WorkroomRuntimeHandle;
  /** Sponsor-authorized Run mutation plane; identity is injected from the Host token. */
  readonly workroomControl?: AgentHostWorkroomRunControlPort;
  /** Persistent topology SSOT; edits take effect without rebuilding the generation. */
  readonly workroomCatalog: WorkroomCatalog;
  /** Bindings from this exact generation, used for Catalog display and validation. */
  listBindings(): readonly ResolvedAgentBinding[];
  readonly assistant: AssistantRuntimeHandle | null;
  readonly trace: AgentTraceRuntimeHandle;
  /** Authenticated Host-only mutations; identity is injected by the Root and absent from caller DTOs. */
  readonly workroomProfiles?: AgentHostWorkroomProfileControlPort;
  /** Content-free Knowledge registry; identity and Sponsor authority are Host-injected. */
  readonly workroomKnowledge?: AgentHostWorkroomKnowledgeControlPort;
  /** Content-free Sponsor projection and typed commands; HTTP injects the authenticated principal. */
  readonly portfolioSponsor?: AgentHostPortfolioSponsorControlPort;
  /** Root-private Effect approval plane; HTTP injects identity and discussion has no ingress. */
  readonly effectSponsor?: AgentHostEffectSponsorControlPort;
  /** Root-role + current P12 authorized, content-free Payload Lifecycle plane. */
  readonly dataLifecycle?: WorkroomDataLifecycleConsoleControlPort;
}

export interface AgentHostWorkroomRunControlPort {
  execute(
    command: WorkroomRunControlCommand,
    authenticatedPrincipal: Readonly<{ principalId: string }>,
  ): Promise<WorkroomRunControlReceipt>;
}

export interface AgentHostPortfolioSponsorControlPort
  extends Pick<PortfolioSponsorCommandPort, 'execute'>, PortfolioSponsorProjectionReadPort {}

export interface AgentHostEffectSponsorControlPort {
  decide(
    command: Omit<WorkroomEffectSponsorDecisionCommand, 'principalId'>,
    authenticatedPrincipal: Readonly<{ principalId: string }>,
  ): Promise<WorkroomEffectSponsorDecisionRecord>;
}

export interface AgentHostWorkroomProfileControlPort {
  getPlanningStatus(
    projectId: string,
    authenticatedPrincipal?: Readonly<{ principalId: string }>,
  ): Promise<WorkroomPlanningSetupStatus>;
  bootstrapPlanning(command: WorkroomPlanningBootstrapCommand,
    authenticatedPrincipal: Readonly<{ principalId: string }>): Promise<WorkroomPlanningSetupStatus>;
  publishPack(command: Omit<PublishCapabilityPackCommand, 'version' | 'authenticatedPrincipalId'>,
    authenticatedPrincipal: Readonly<{ principalId: string }>):
    ReturnType<WorkroomProfileControlPort['publishPack']>;
  publishProfile(command: Omit<PublishProjectProfileCommand, 'version' | 'authenticatedPrincipalId' | 'source'>,
    authenticatedPrincipal: Readonly<{ principalId: string }>):
    ReturnType<WorkroomProfileControlPort['publishProfile']>;
  publishRollback(command: Omit<PublishProjectProfileRollbackCommand,
    'version' | 'authenticatedPrincipalId' | 'source'>,
    authenticatedPrincipal: Readonly<{ principalId: string }>):
    ReturnType<WorkroomProfileControlPort['publishRollback']>;
  publishPlanningPolicy(command: Omit<PublishPlanningPolicyCommand,
    'version' | 'authenticatedPrincipalId' | 'catalogRevision' | 'projectDigest' | 'profileDigest'>,
    authenticatedPrincipal: Readonly<{ principalId: string }>):
    ReturnType<WorkroomProfileControlPort['publishPlanningPolicy']>;
}

export interface WorkroomPlanningBootstrapCommand {
  readonly operationId: string;
  readonly projectId: string;
  readonly expectedRegistryRevision: number;
  readonly includeTools?: readonly string[];
  readonly includeSkills?: readonly string[];
}

export interface WorkroomPlanningSetupStatus {
  readonly projectId: string;
  readonly ready: boolean;
  readonly principalId?: string;
  readonly trustedPackPublisher: boolean;
  readonly projectSponsor: boolean;
  readonly catalogReady: boolean;
  readonly registryRevision: number;
  readonly activeProfile?: Readonly<{ revisionId: string; digest: string }>;
  readonly planningPolicyReady: boolean;
  readonly availableAgents: readonly string[];
  readonly availableTools: readonly string[];
  readonly availableSkills: readonly string[];
  readonly diagnostics: readonly string[];
}

export interface AgentHostWorkroomKnowledgeControlPort {
  read(projectId: string): Promise<ProjectKnowledgeSnapshot>;
  publish(command: Readonly<{
    operationId: string;
    projectId: string;
    expectedRevision: number;
    entries: readonly ProjectKnowledgeEntry[];
  }>, authenticatedPrincipal: Readonly<{ principalId: string }>): Promise<ProjectKnowledgeSnapshot>;
  rollback(command: Readonly<{
    operationId: string;
    projectId: string;
    expectedRevision: number;
    restoreRevision: number;
  }>, authenticatedPrincipal: Readonly<{ principalId: string }>): Promise<ProjectKnowledgeSnapshot>;
}

export const agentHostToken = createToken<AgentHostPort>(
  'zhin.host.agent',
  'Canonical Agent protocol and operational projections owned by the Root generation',
);
