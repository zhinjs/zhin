import { definePage, createDeclarativePage } from '@zhin.js/console-contract';
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
      label: {
        $map: {
          path: 'healthy',
          cases: {
            true: { zh: '健康', en: 'Healthy' },
            false: { zh: '降级', en: 'Degraded' },
          },
          default: { zh: '降级', en: 'Degraded' },
        },
      },
      tone: {
        $map: {
          path: 'healthy',
          cases: {
            true: 'success',
            false: 'warning',
          },
          default: 'warning',
        },
      },
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
      entries: [
        { label: 'PID', dataKey: 'pid' },
        { label: 'RSS (MB)', value: { $format: '{0} MB', args: ['rssMb'] } },
        { label: 'Heap Used (MB)', value: { $format: '{0} MB', args: ['heapUsedMb'] } },
        { label: 'Heap Total (MB)', value: { $format: '{0} MB', args: ['heapTotalMb'] } },
        { label: 'Uptime', dataKey: 'uptime' },
        { label: 'Total Uptime', value: { $path: 'totalUptime', fallback: '-' } },
        { label: 'Restart Count', dataKey: 'restartCount' },
        { label: 'Crash Count', value: { $path: 'crashCount', fallback: 0 } },
        { label: 'Hostname', value: { $path: 'hostname', fallback: '-' } },
        { label: 'Platform', value: { $path: 'platform', fallback: '-' } },
        { label: 'Node Version', value: { $path: 'nodeVersion', fallback: '-' } },
        {
          label: 'Healthy',
          value: {
            $map: {
              path: 'healthy',
              cases: { true: 'Yes', false: 'No' },
              default: 'No',
            },
          },
        },
      ],
    },
  ],
});
