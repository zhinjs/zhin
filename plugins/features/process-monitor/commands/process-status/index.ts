import { defineCommand } from 'zhin.js/command';
import { processMonitorToken, type ProcessMonitorConfig } from '../../src/monitor.js';

export default defineCommand<ProcessMonitorConfig>({
  description: '查看进程监控状态（PID、运行时长、重启统计）',
  execute(context) {
    return context.use(processMonitorToken).formatStatus();
  },
});
