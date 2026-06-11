/**
 * watch — 连接运行中 Host API，展示 runtime / bots / assistant jobs（TTY 定时刷新）
 */
import { Command } from 'commander';
import { hostGet, loadHostHttpConfig } from '../utils/host-http.js';
import {
  jobRowsFromApi,
  renderWatchText,
  systemInfoFromApi,
  type WatchEndpointRow,
  type WatchStats,
  type WatchSystemInfo,
} from './watch-format.js';

interface StatsApiData {
  uptime?: number;
  memory?: number;
  endpoints?: { total?: number; online?: number };
  plugins?: { total?: number; active?: number };
  commands?: number;
  components?: number;
  runtime?: string;
}

interface SystemStatusApiData {
  uptime?: number;
  memory?: Record<string, number>;
  osMemory?: { freeMem?: number; totalMem?: number };
  pid?: number;
  nodeVersion?: string;
  platform?: string;
  runtime?: string;
}

interface EndpointsApiData {
  name: string;
  adapter: string;
  status: 'online' | 'offline';
}

interface AssistantJobsApiData {
  jobs: unknown[];
  eventsActive?: boolean;
}

export interface WatchSnapshot {
  baseUrl: string;
  fetchedAt: string;
  ok: boolean;
  error?: string;
  stats?: WatchStats;
  system?: WatchSystemInfo;
  endpoints?: WatchEndpointRow[];
  assistant?: {
    enabled: boolean;
    eventsActive?: boolean;
    jobs: ReturnType<typeof jobRowsFromApi>;
  };
}

export async function fetchWatchSnapshot(http: { baseUrl: string; token: string }): Promise<WatchSnapshot> {
  const fetchedAt = new Date().toISOString();
  const [statsRes, systemRes] = await Promise.all([
    hostGet<StatsApiData>(http, '/stats'),
    hostGet<SystemStatusApiData>(http, '/system/status'),
  ]);

  if (!statsRes.ok) {
    return {
      baseUrl: http.baseUrl,
      fetchedAt,
      ok: false,
      error: statsRes.error,
    };
  }

  const system = systemInfoFromApi(
    systemRes.ok && systemRes.data
      ? (systemRes.data as Record<string, unknown>)
      : undefined,
  );

  const endpointsRes = await hostGet<EndpointsApiData[]>(http, '/endpoints');
  const endpoints: WatchEndpointRow[] = Array.isArray(endpointsRes.data)
    ? endpointsRes.data.map((b) => ({
        name: b.name,
        adapter: b.adapter,
        status: b.status,
      }))
    : [];

  const jobsRes = await hostGet<AssistantJobsApiData>(http, '/assistant/jobs');
  let assistant: WatchSnapshot['assistant'];
  if (jobsRes.status === 404) {
    assistant = { enabled: false, jobs: [] };
  } else if (jobsRes.ok && jobsRes.data) {
    assistant = {
      enabled: true,
      eventsActive: jobsRes.data.eventsActive,
      jobs: jobRowsFromApi(jobsRes.data.jobs ?? []),
    };
  }

  return {
    baseUrl: http.baseUrl,
    fetchedAt,
    ok: true,
    stats: statsRes.data,
    system,
    endpoints,
    assistant,
  };
}

function snapshotToScreen(snapshot: WatchSnapshot): string {
  return renderWatchText({
    baseUrl: snapshot.baseUrl,
    fetchedAt: new Date(snapshot.fetchedAt),
    stats: snapshot.stats,
    system: snapshot.system,
    endpoints: snapshot.endpoints,
    assistantEnabled: snapshot.assistant?.enabled,
    eventsActive: snapshot.assistant?.eventsActive,
    jobs: snapshot.assistant?.jobs,
    error: snapshot.error,
  });
}

export const watchCommand = new Command('watch')
  .description('监视运行中实例（Host API：stats / bots / assistant jobs）')
  .option('-i, --interval <seconds>', '刷新间隔（秒）', '3')
  .option('--once', '拉取一次后退出')
  .option('--json', 'JSON 输出（适合脚本）')
  .option('--no-clear', '不清屏（便于重定向到文件）')
  .action(async (opts: { interval: string; once?: boolean; json?: boolean; clear?: boolean }) => {
    const http = await loadHostHttpConfig();
    if (!http) {
      console.error('未找到 zhin.config，无法确定 Host API 地址');
      process.exit(1);
    }

    const intervalSec = Math.max(1, Number.parseInt(opts.interval, 10) || 3);
    const once = opts.once === true || !process.stdout.isTTY || opts.json === true;
    const useClear = opts.clear !== false && process.stdout.isTTY && !opts.json;

    const tick = async () => {
      const snapshot = await fetchWatchSnapshot(http);
      if (opts.json) {
        console.log(JSON.stringify(snapshot, null, 2));
        return;
      }
      if (useClear) {
        process.stdout.write('\x1Bc');
      }
      console.log(snapshotToScreen(snapshot));
    };

    await tick();
    if (once) return;

    const timer = setInterval(() => {
      void tick();
    }, intervalSec * 1000);

    const stop = () => {
      clearInterval(timer);
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
