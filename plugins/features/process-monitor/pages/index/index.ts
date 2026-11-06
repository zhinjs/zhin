import { definePage } from '@zhin.js/console-contract';
import { createDeclarativePage } from '@zhin.js/client';
import type { ProcessMonitorStatusSnapshot } from '../../src/monitor.js';

export const meta = definePage({
  title: '进程监控',
  titleI18n: { en: 'Process Monitor' },
  icon: 'Activity',
  order: 56,
  requiredPermissions: ['process-monitor:read'],
});

export default createDeclarativePage<ProcessMonitorStatusSnapshot>({
  title: { zh: '进程监控', en: 'Process Monitor' },
  description: {
    zh: '实时查看 Zhin 进程的运行状态、内存占用与重启统计',
    en: 'Real-time process health, memory usage, and restart statistics',
  },
  badges: [
    {
      key: 'healthy',
      label: (data) => (data.healthy ? 'Healthy' : 'Degraded'),
      tone: (data) => (data.healthy ? 'success' : 'warning'),
    },
  ],
  stats: [
    {
      key: 'rssMb',
      label: { zh: 'RSS 内存 (MB)', en: 'RSS Memory (MB)' },
      value: 'rssMb',
    },
    {
      key: 'heapUsedMb',
      label: { zh: '已用堆内存 (MB)', en: 'Heap Used (MB)' },
      value: 'heapUsedMb',
    },
    {
      key: 'uptime',
      label: { zh: '运行时长', en: 'Uptime' },
      value: 'uptime',
    },
    {
      key: 'restartCount',
      label: { zh: '重启次数', en: 'Restart Count' },
      value: 'restartCount',
    },
  ],
  sections: [
    {
      id: 'details',
      title: { zh: '进程详情', en: 'Process Details' },
      entries: (data) => ({
        PID: String(data.pid),
        'RSS (MB)': `${data.rssMb} MB`,
        'Heap Used (MB)': `${data.heapUsedMb} MB`,
        'Heap Total (MB)': `${data.heapTotalMb} MB`,
        Uptime: data.uptime,
        'Total Uptime': data.totalUptime ?? '-',
        'Restart Count': String(data.restartCount),
        'Crash Count': String(data.crashCount ?? 0),
        Hostname: data.hostname ?? '-',
        Platform: data.platform ?? '-',
        'Node Version': data.nodeVersion ?? '-',
        Healthy: data.healthy ? 'Yes' : 'No',
      }),
    },
  ],
});
