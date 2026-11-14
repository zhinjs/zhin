import { definePage, createDeclarativePage } from '@zhin.js/console-contract';
import type { ProcessMonitorStatusSnapshot } from '../../src/monitor.js';

export const meta = definePage({
  title: '进程监控',
  titleI18n: { en: 'Process Monitor' },
  icon: 'Activity',
  order: 56,
  requiredPermissions: ['process-monitor:read'],
});

/** "自 2026-01-01 起累计" — the cumulative counters come from `data/process-state.json`. */
const sinceHint = {
  $format: { zh: '自 {0} 起累计', en: 'Since {0}' },
  args: ['trackingSince'],
} as const;

export default createDeclarativePage<ProcessMonitorStatusSnapshot>({
  title: { zh: '进程监控', en: 'Process Monitor' },
  description: {
    zh: '本次运行的状态与内存占用，以及自统计开始以来的累计重启 / 崩溃次数',
    en: 'This run’s health and memory, plus restart / crash totals since tracking began',
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
      key: 'uptime',
      label: { zh: '本次运行时长', en: 'This run' },
      value: { $i18n: 'uptimeI18n' },
    },
    {
      key: 'crashesLast24h',
      label: { zh: '近 24 小时崩溃', en: 'Crashes (24 h)' },
      value: 'crashesLast24h',
      hint: { $format: { zh: '同期重启 {0} 次', en: '{0} restarts in the same window' }, args: ['restartsLast24h'] },
    },
    {
      key: 'restartCount',
      label: { zh: '累计重启', en: 'Restarts (total)' },
      value: 'restartCount',
      hint: sinceHint,
    },
    {
      key: 'crashCount',
      label: { zh: '累计崩溃', en: 'Crashes (total)' },
      value: 'crashCount',
      hint: sinceHint,
    },
    {
      key: 'rssMb',
      label: { zh: 'RSS 内存', en: 'RSS Memory' },
      value: 'rssMb',
      unit: 'MB',
    },
    {
      key: 'heapUsedMb',
      label: { zh: '已用堆内存', en: 'Heap Used' },
      value: 'heapUsedMb',
      unit: 'MB',
    },
  ],
  sections: [
    {
      id: 'current-run',
      title: { zh: '本次运行', en: 'This run' },
      entries: [
        { label: { zh: '进程 ID', en: 'PID' }, dataKey: 'pid' },
        { label: { zh: '启动时间', en: 'Started at' }, value: { $path: 'startedAt', fallback: '-' } },
        {
          label: { zh: '启动原因', en: 'Start reason' },
          value: {
            $map: {
              path: 'startReason',
              cases: {
                start: { zh: '首次启动 / 热重载', en: 'Fresh start / hot reload' },
                restart: { zh: '正常重启', en: 'Restart' },
                crash: { zh: '崩溃后重启', en: 'Restart after a crash' },
              },
              default: { zh: '未知', en: 'Unknown' },
            },
          },
        },
        { label: { zh: '运行时长', en: 'Uptime' }, value: { $i18n: 'uptimeI18n', fallback: '-' } },
        { label: { zh: 'RSS 内存', en: 'RSS memory' }, value: { $format: '{0} MB', args: ['rssMb'] } },
        { label: { zh: '已用堆内存', en: 'Heap used' }, value: { $format: '{0} MB', args: ['heapUsedMb'] } },
        { label: { zh: '堆内存总量', en: 'Heap total' }, value: { $format: '{0} MB', args: ['heapTotalMb'] } },
        { label: { zh: '主机名', en: 'Hostname' }, value: { $path: 'hostname', fallback: '-' } },
        { label: { zh: '平台', en: 'Platform' }, value: { $path: 'platform', fallback: '-' } },
        { label: { zh: 'Node 版本', en: 'Node version' }, value: { $path: 'nodeVersion', fallback: '-' } },
        {
          label: { zh: '健康状态', en: 'Healthy' },
          value: {
            $map: {
              path: 'healthy',
              cases: { true: { zh: '是', en: 'Yes' }, false: { zh: '否', en: 'No' } },
              default: { zh: '否', en: 'No' },
            },
          },
        },
      ],
    },
    {
      id: 'cumulative',
      title: { zh: '累计统计', en: 'Totals' },
      description: {
        zh: '来自 data/process-state.json，跨多次启动累计；旧状态文件的起点按文件创建时间估算。',
        en: 'From data/process-state.json, accumulated across starts; older state files estimate the start from the file’s creation time.',
      },
      entries: [
        { label: { zh: '统计起点', en: 'Tracking since' }, value: { $path: 'trackingSince', fallback: '-' } },
        {
          label: { zh: '起点来源', en: 'Start source' },
          value: {
            $map: {
              path: 'trackingSinceEstimated',
              cases: {
                true: { zh: '按状态文件创建时间估算', en: 'Estimated from the state file' },
                false: { zh: '已记录', en: 'Recorded' },
              },
              default: { zh: '已记录', en: 'Recorded' },
            },
          },
        },
        { label: { zh: '累计重启', en: 'Restarts' }, dataKey: 'restartCount' },
        { label: { zh: '累计崩溃', en: 'Crashes' }, dataKey: 'crashCount' },
        { label: { zh: '累计运行时长', en: 'Total uptime' }, value: { $i18n: 'totalUptimeI18n', fallback: '-' } },
        { label: { zh: '近 24 小时崩溃', en: 'Crashes, last 24 h' }, dataKey: 'crashesLast24h' },
        { label: { zh: '近 24 小时重启', en: 'Restarts, last 24 h' }, dataKey: 'restartsLast24h' },
        {
          label: { zh: '24 小时数据', en: '24 h window' },
          value: {
            $map: {
              path: 'last24hComplete',
              cases: {
                true: { zh: '完整', en: 'Complete' },
                false: { zh: '不足 24 小时（刚开始记录时间戳）', en: 'Partial (timestamps recorded recently)' },
              },
              default: { zh: '不足 24 小时', en: 'Partial' },
            },
          },
        },
      ],
    },
  ],
});
