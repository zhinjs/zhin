import type { PluginRegisterHostApi } from '@zhin.js/contract';
import OrchestrationRunsPage from './OrchestrationRunsPage.js';

/** Remote Console v1.1 — OrchestrationKernel Run/Task/Event 投影页 */
export function registerOrchestrationConsole(api: PluginRegisterHostApi): void {
  api.addRoute({
    path: '/console/orchestration',
    name: '编排',
    element: api.React.createElement(OrchestrationRunsPage),
    meta: { order: 40, group: 'Agent' },
  });
  api.addTool({
    id: 'orchestration',
    name: '编排',
    path: '/console/orchestration',
  });
}
