import { defineAgentTool } from '@zhin.js/tool';
import { formatProcessStatus } from '../src/monitor.js';

export default defineAgentTool({
  description: '查看进程监控状态，包括 PID、运行时长、内存、重启和崩溃统计',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  approval: 'never',
  execute: () => formatProcessStatus(),
});
