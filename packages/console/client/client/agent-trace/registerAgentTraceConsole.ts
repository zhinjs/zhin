import type { PluginRegisterHostApi } from '@zhin.js/contract';
import TraceArchivePage from './TraceArchivePage.js';

/** Read-only page over the persisted Agent turn traces (#728). */
export function registerAgentTraceConsole(api: PluginRegisterHostApi): void {
  api.addRoute({
    path: '/console/agent-trace',
    name: 'Agent Trace',
    element: api.React.createElement(TraceArchivePage),
    meta: { order: 41, group: 'Agent' },
  });
  api.addTool({
    id: 'agent-trace',
    name: 'Agent Trace',
    path: '/console/agent-trace',
  });
}
