import { definePlugin } from 'zhin.js';
import {
  ProcessMonitor,
  processMonitorToken,
  type ProcessMonitorConfig,
} from './src/monitor.js';

/**
 * Process monitor Plugin Runtime cutover:
 * - setup() owns file-backed restart detection + signal cleanup
 * - commands/process-status for chat status
 * - tools/process-status kept as agent tool surface
 */
export default definePlugin<ProcessMonitorConfig>({
  name: 'process-monitor',
  metadata: {
    displayName: 'Process Monitor',
  },
  setup(context) {
    const monitor = new ProcessMonitor(context.config.get());
    context.resources.provide(processMonitorToken, monitor);
    monitor.start();
    context.lifecycle.add(() => monitor.dispose());
  },
});
