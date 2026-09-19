import type {
  ConsoleRpcExtendedCtx,
  ConsoleScheduleEngine,
} from '@zhin.js/host-http';
import type { AgentConsolePort } from './agent-console.js';
import type { ConsoleRpcComposition } from './rpc-composition.js';

export function createExtendedConsoleRpcContext(
  composition: ConsoleRpcComposition,
  agent: AgentConsolePort | null,
  principal: Readonly<{ principalId: string }> | undefined,
): Omit<ConsoleRpcExtendedCtx, 'fullScope'> {
  const { projectRoot, scheduleHost, im, databaseHost } = composition;
  const withEndpointManagement: ConsoleRpcExtendedCtx['withEndpointManagement'] = im
    ? (adapter, endpointKey, run) => im.withEndpointManagement(adapter, endpointKey, run)
    : undefined;
  return Object.freeze({
    projectRoot,
    scheduleHost,
    withEndpointManagement,
    databaseHost: databaseHost ? { models: databaseHost.models } : undefined,
    resolveScheduleEngine: () => resolveScheduleEngine(agent),
    loginAssist: im?.loginAssist,
    authenticatedPrincipal: principal,
    workroomProfileControl: agent?.workroomProfiles,
    workroomKnowledgeControl: agent?.workroomKnowledge,
  });
}

function resolveScheduleEngine(agent: AgentConsolePort | null): ConsoleScheduleEngine | null {
  const jobs = agent?.assistant?.jobs;
  if (!jobs) return null;
  return {
    listJobs: async () => [...await jobs.list()],
    addJob: job => jobs.add(job),
    removeJob: id => jobs.remove(id),
    pauseJob: id => jobs.pause(id),
    resumeJob: id => jobs.resume(id),
  };
}
