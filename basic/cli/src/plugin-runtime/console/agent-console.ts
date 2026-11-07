import type {
  ConsoleAgentRuntime,
} from '@zhin.js/host-http';
import { tokenId, type RuntimeSnapshot, type SnapshotReader, type TokenId } from '@zhin.js/plugin-runtime';
import type { ScheduleExecutionHistoryPort } from '@zhin.js/agent/runtime';
import type { BoardEntry, EngagementEvent, EngagementSummary } from '@zhin.js/harness';
import type { VenueDefinition } from '@zhin.js/core';

/**
 * 新 Runtime 的 agent 门面。Session tree 仍由独立服务端口提供；Agent 本体只从
 * 当前 generation snapshot 的 agentHostToken 解析。模块按请求惰性加载，agent
 * 未安装/未 init 时降级（host-http 返回 503 / 空列表 + note）。
 */
const defaultAgentHostToken = Object.freeze({ id: tokenId('zhin.host.agent') });

let agentModule: {
  agentHostToken?: { readonly id: TokenId };
} | null | undefined;

type AgentConsoleModule = NonNullable<typeof agentModule>;

/**
 * Resolves the Console's token module. Returns null when the Agent package is
 * absent.
 */
export async function loadAgentConsoleModule(
  importAgent: () => Promise<{ agentHostToken: { readonly id: TokenId } }>,
): Promise<AgentConsoleModule | null> {
  try {
    const { agentHostToken } = await importAgent();
    return { agentHostToken };
  } catch {
    return null;
  }
}

let agentModuleReady: Promise<AgentConsoleModule | null> | undefined;

function getAgentConsoleModule(): Promise<AgentConsoleModule | null> {
  return (agentModuleReady ??= loadAgentConsoleModule(
    () => import('@zhin.js/agent/runtime'),
  ).then(module => {
    agentModule = module;
    return module;
  }));
}

function currentAgentHostToken(): { readonly id: TokenId } | undefined {
  if (agentModule === null) return undefined;
  return agentModule?.agentHostToken ?? defaultAgentHostToken;
}

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
  readonly assistant: AssistantRuntime | null;
  readonly scheduleExecutions?: ScheduleExecutionHistoryPort;
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
  readonly engagements?: {
    list(limit?: number): Promise<readonly EngagementSummary[]>;
    get(id: string): Promise<Readonly<{
      summary: EngagementSummary;
      events: readonly EngagementEvent[];
      board: readonly BoardEntry[];
    }> | null>;
  };
  readonly venues?: {
    list(): readonly VenueDefinition[];
  };
};

/**
 * Resolves the Agent Console port from the root generation resource.
 */
export function resolveGenerationAgentConsole(
  snapshot: RuntimeSnapshot | undefined,
  agentToken: { readonly id: TokenId } | undefined,
): AgentConsolePort | null {
  if (!snapshot || !agentToken) return null;
  const rootResources = snapshot.resources.get(snapshot.root);
  const agentConsole = (rootResources?.get(agentToken.id) as { console?: object } | undefined)?.console;
  if (!agentConsole) return null;
  return Object.freeze(Object.defineProperties({}, Object.getOwnPropertyDescriptors(agentConsole))) as AgentConsolePort;
}

export function resolveCurrentAgentIntrospection(
  snapshot: RuntimeSnapshot | undefined,
): AgentIntrospection | null {
  return resolveGenerationAgentIntrospection(snapshot, currentAgentHostToken());
}

export function resolveCurrentAgentConsole(
  snapshot: RuntimeSnapshot | undefined,
): AgentConsolePort | null {
  return resolveGenerationAgentConsole(
    snapshot,
    currentAgentHostToken(),
  );
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
  if (agentModule === undefined) {
    await getAgentConsoleModule();
  }
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
