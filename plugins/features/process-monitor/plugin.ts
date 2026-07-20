import { definePlugin } from '@zhin.js/plugin-runtime';
import {
  resolveProcessMonitorConfig,
  startProcessMonitor,
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
    const config = resolveProcessMonitorConfig(context.config.get());
    const dispose = startProcessMonitor(config);
    context.lifecycle.add(dispose);
  },
});
