import type {
  ConsoleAgentRuntime,
  ConsoleWorkroomKnowledgeControlPort,
  ConsoleWorkroomProfileControlPort,
} from '@zhin.js/host-http';
import type { PortfolioSponsorProjection, WorkroomDefinition } from '@zhin.js/agent';
import type {
  AgentHostWorkroomRunControlPort,
  PortfolioSponsorCommand,
  WorkroomDataLifecycleConsoleControlPort,
  WorkroomEffectSponsorDecisionCommand,
  WorkroomEffectSponsorDecisionRecord,
  WorkroomRuntimeHandle,
} from '@zhin.js/agent/runtime';
import type { RuntimeSnapshot, SnapshotReader, TokenId } from '@zhin.js/plugin-runtime';

/**
 * 新 Runtime 的 agent 门面。Session tree 仍由独立服务端口提供；Agent 本体只从
 * 当前 generation snapshot 的 agentHostToken 解析。模块按请求惰性加载，agent
 * 未安装/未 init 时降级（host-http 返回 503 / 空列表 + note）。
 */
let agentModule: {
  agentHostToken?: { readonly id: TokenId };
} | null | undefined;

void import('@zhin.js/agent/runtime')
  .then((runtime) => { agentModule = runtime as typeof agentModule; })
  .catch(() => { agentModule = null; });

export type AgentIntrospection = {
  listTools(): readonly { name: string; hidden?: boolean; description?: string }[];
  listMcpServers(): readonly { name: string; connected: boolean; toolCount: number }[];
};

export function resolveGenerationAgentIntrospection(
  snapshot: RuntimeSnapshot | undefined,
  token: { readonly id: TokenId } | undefined,
): AgentIntrospection | null {
  if (!snapshot || !token) return null;
  const host = snapshot.resources.get(snapshot.root)?.get(token.id) as {
    introspection?: AgentIntrospection;
  } | undefined;
  return host?.introspection ?? null;
}

export type AgentConsolePort = {
  readonly sessionTree: ConsoleAgentRuntime['sessionTree'];
  readonly workroom: WorkroomRuntimeHandle;
  readonly workroomControl?: AgentHostWorkroomRunControlPort;
  readonly assistant: AssistantRuntime | null;
  readonly workroomCatalog: {
    read(): Promise<Readonly<{
      definitions: Readonly<Record<string, WorkroomDefinition>>;
      revision: string;
    }>>;
    replace(
      definitions: Readonly<Record<string, WorkroomDefinition>>,
      expectedRevision: string,
    ): Promise<Readonly<{ revision: string }>>;
  };
  listBindings(): readonly {
    name: string;
    providerAlias: string;
    model: string;
    nickname?: string;
  }[];
  readonly trace: {
    list(
      sessionKey: string,
      options?: Readonly<{ afterSequence?: number; limit?: number }>,
    ): {
      readonly sessionKey: string;
      readonly events: readonly Record<string, unknown>[];
      readonly latestSequence: number;
      readonly activeTurnIds: readonly string[];
    };
  };
  readonly cancelSession?: (sessionKey: string) => boolean;
  readonly workroomProfiles?: ConsoleWorkroomProfileControlPort;
  readonly workroomKnowledge?: ConsoleWorkroomKnowledgeControlPort;
  readonly portfolioSponsor?: {
    read(
      portfolioId: string,
      authenticatedPrincipal: Readonly<{ principalId: string }>,
    ): Promise<Readonly<{ status: 'ready'; projection: PortfolioSponsorProjection }>
      | Readonly<{ status: 'forbidden' }>>;
    execute(
      portfolioId: string,
      command: PortfolioSponsorCommand,
      authenticatedPrincipal: Readonly<{ principalId: string }>,
    ): Promise<PortfolioSponsorProjection>;
  };
  readonly effectSponsor?: {
    decide(
      command: Omit<WorkroomEffectSponsorDecisionCommand, 'principalId'>,
      authenticatedPrincipal: Readonly<{ principalId: string }>,
    ): Promise<WorkroomEffectSponsorDecisionRecord>;
  };
  readonly dataLifecycle?: WorkroomDataLifecycleConsoleControlPort;
};

export function resolveGenerationAgentConsole(
  snapshot: RuntimeSnapshot | undefined,
  token: { readonly id: TokenId } | undefined,
): AgentConsolePort | null {
  if (!snapshot || !token) return null;
  const host = snapshot.resources.get(snapshot.root)?.get(token.id) as {
    console?: AgentConsolePort;
  } | undefined;
  return host?.console ?? null;
}

export function resolveCurrentAgentIntrospection(
  snapshot: RuntimeSnapshot | undefined,
): AgentIntrospection | null {
  return resolveGenerationAgentIntrospection(snapshot, agentModule?.agentHostToken);
}

export function resolveCurrentAgentConsole(
  snapshot: RuntimeSnapshot | undefined,
): AgentConsolePort | null {
  return resolveGenerationAgentConsole(snapshot, agentModule?.agentHostToken);
}

export function acquireGenerationAgentConsole(snapshots?: SnapshotReader): {
  readonly value: AgentConsolePort | null;
  release(): void;
} | null {
  if (!snapshots) return null;
  try {
    const lease = snapshots.acquire();
    return {
      value: resolveCurrentAgentConsole(lease.value),
      release: () => lease.release(),
    };
  } catch {
    return null;
  }
}

export async function withGenerationAgentConsole(
  snapshots: SnapshotReader | undefined,
  operation: (value: AgentConsolePort) => Promise<void>,
): Promise<boolean> {
  const lease = acquireGenerationAgentConsole(snapshots);
  if (!lease?.value) {
    lease?.release();
    return false;
  }
  try {
    await operation(lease.value);
    return true;
  } finally {
    lease.release();
  }
}

type AssistantRuntime = {
  readonly events: {
    isEnabled(): boolean;
    handle(body: unknown): Promise<{ ok: boolean; deduped?: boolean; error?: string }>;
  };
  readonly jobs: {
    list(): Promise<Record<string, unknown>[]>;
    add(job: Record<string, unknown>): Promise<Record<string, unknown>>;
    remove(id: string): Promise<boolean>;
    pause(id: string): Promise<boolean>;
    resume(id: string): Promise<boolean>;
  };
};
