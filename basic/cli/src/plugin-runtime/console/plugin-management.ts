import { PluginManagementWorkflow, type PluginManagementOptions } from '../../plugin-management/workflow.js';

/** Console uses the same installation authority as CLI; it does not implement a transaction. */
export function createPluginManagementPort(projectRoot: string, options: PluginManagementOptions = {}) {
  return new PluginManagementWorkflow(projectRoot, options);
}
