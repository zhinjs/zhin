import {
  definePlugin,
  definePluginCapabilityGraph,
  pluginConsoleRpcToken,
} from 'zhin.js';
import { createProcessMonitorConsoleRpc } from './src/console.js';
import {
  ProcessMonitor,
  processMonitorToken,
  type ProcessMonitorConfig,
} from './src/monitor.js';

/**
 * Process monitor Plugin Runtime cutover:
 * - setup() owns file-backed restart detection + signal cleanup
 * - commands/process-status for chat status
 * - skills/process-monitor owns the deferred process-status Tool
 * - pages/index + pluginConsoleRpcToken for Console status
 */
export default definePlugin<ProcessMonitorConfig>({
  name: 'process-monitor',
  metadata: {
    displayName: 'Process Monitor',
  },
  capabilityGraph: definePluginCapabilityGraph({
    provides: [processMonitorToken, pluginConsoleRpcToken],
    features: {
      commands: ['process-status'],
      skills: ['process-monitor'],
      tools: ['process-status'],
      pages: ['index'],
    },
  }),
  setup(context) {
    const monitor = new ProcessMonitor(context.config.get());
    context.resources.provide(processMonitorToken, monitor);
    context.resources.provide(pluginConsoleRpcToken, createProcessMonitorConsoleRpc(monitor));
    monitor.start();
    context.lifecycle.add(() => monitor.dispose());
  },
});
