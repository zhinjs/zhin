import {
  definePlugin,
  definePluginCapabilityGraph,
  pluginConsoleRpcToken,
} from 'zhin.js';
import { createProcessMonitorConsoleRpc } from './src/console.js';
import {
  ProcessMonitor,
  processMonitorStore,
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
    displayNameI18n: { 'zh-CN': '进程监控', en: 'Process Monitor' },
  },
  capabilityGraph: definePluginCapabilityGraph({
    provides: [processMonitorStore, pluginConsoleRpcToken],
    features: {
      commands: ['process-status'],
      skills: ['process-monitor'],
      tools: ['skill/process-monitor/process-status'],
      pages: ['index'],
    },
  }),
  setup(context) {
    const monitor = new ProcessMonitor(context.config.get());
    processMonitorStore.provide(context, monitor);
    monitor.start();
    return {
      consoleRpc: createProcessMonitorConsoleRpc(monitor),
    };
  },
});
