import type { PluginRegisterHostApi } from '@zhin.js/contract';
import WorkroomRunsPage from './WorkroomRunsPage.js';

/** Read-only Workroom Run/Task/Assignment projection. */
export function registerWorkroomConsole(api: PluginRegisterHostApi): void {
  api.addRoute({
    path: '/console/workroom',
    name: 'Workroom',
    element: api.React.createElement(WorkroomRunsPage),
    meta: { order: 40, group: 'Agent' },
  });
  api.addTool({
    id: 'workroom',
    name: 'Workroom',
    path: '/console/workroom',
  });
}
