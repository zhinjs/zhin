import type { ImRuntime } from '@zhin.js/core/runtime';
import type { RuntimeConsoleRpcContext } from '@zhin.js/host-http';
import type { WorkroomDefinition } from '@zhin.js/agent';
import type { AgentConsolePort } from './agent-console.js';

type WorkroomCatalogRpcContext = Required<Pick<
  RuntimeConsoleRpcContext,
  'readWorkroomCatalog' | 'setWorkroomCatalog'
>>;

export function createWorkroomCatalogRpcContext(
  agent: AgentConsolePort | null,
  im: ImRuntime | undefined,
  principal: Readonly<{ principalId: string }> | undefined,
): WorkroomCatalogRpcContext {
  return Object.freeze({
    readWorkroomCatalog: () => readWorkroomCatalog(agent, principal),
    setWorkroomCatalog: (workrooms: unknown, expectedRevision: string) =>
      setWorkroomCatalog(agent, im, workrooms, expectedRevision),
  });
}

async function readWorkroomCatalog(
  agent: AgentConsolePort | null,
  principal: Readonly<{ principalId: string }> | undefined,
): Promise<Readonly<{
  agents: Readonly<Record<string, unknown>>;
  workrooms: Readonly<Record<string, unknown>>;
  revision: string;
  principalId?: string;
}>> {
  const catalog = agent?.workroomCatalog;
  if (!catalog) throw new Error('Workroom Catalog Runtime 未就绪');
  const snapshot = await catalog.read();
  return Object.freeze({
    agents: Object.fromEntries(agent.listBindings().map(binding => [binding.name, Object.freeze({
      provider: binding.providerAlias,
      model: binding.model,
      ...(binding.nickname ? { nickname: binding.nickname } : {}),
    })])),
    workrooms: snapshot.definitions,
    revision: snapshot.revision,
    ...(principal ? { principalId: principal.principalId } : {}),
  });
}

async function setWorkroomCatalog(
  agent: AgentConsolePort | null,
  im: ImRuntime | undefined,
  workrooms: unknown,
  expectedRevision: string,
): Promise<Readonly<{ revision: string; restartRequired: false }>> {
  const catalog = agent?.workroomCatalog;
  if (!catalog) throw new Error('Workroom Catalog Runtime 未就绪');
  const { validateWorkroomDefinitions } = await import('@zhin.js/agent');
  const errors = validateWorkroomDefinitions(
    workrooms,
    agent.listBindings().map(binding => binding.name),
    new Set((im?.listEndpoints() ?? []).map(endpoint => `${endpoint.adapter}:${endpoint.name}`)),
  );
  if (errors.length > 0) throw new Error(`Invalid Workroom Catalog: ${errors.join('; ')}`);
  const snapshot = await catalog.replace(
    recordValue(workrooms) as Record<string, WorkroomDefinition>,
    expectedRevision,
  );
  return Object.freeze({ revision: snapshot.revision, restartRequired: false as const });
}

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value as Record<string, unknown> };
}
