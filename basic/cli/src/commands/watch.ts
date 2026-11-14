/**
 * watch — 连接运行中 Host API，展示 runtime / bots / assistant jobs（TTY 定时刷新）
 */
import { Command } from 'commander';
import { ALLOW_UNVERIFIED_HOST_OPTION_DESCRIPTION, HOST_OPTION_DESCRIPTION, hostGet, listHostEndpoints, requireHostHttpConfig } from '../utils/host-http.js';
import { isConsoleFeatureDisabled } from '@zhin.js/console-protocol';
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
  // Independent reads: one round trip instead of four sequential ones.
  const [statsRes, systemRes, endpointsRes, jobsRes] = await Promise.all([
    hostGet<StatsApiData>(http, '/stats'),
    hostGet<SystemStatusApiData>(http, '/system/status'),
    listHostEndpoints(http),
    hostGet<AssistantJobsApiData>(http, '/assistant/jobs'),
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

  const endpoints: WatchEndpointRow[] = (endpointsRes.data ?? []).map((row) => ({
    name: row.name,
    adapter: row.adapter,
    status: row.status,
  }));

  let assistant: WatchSnapshot['assistant'];
  if (jobsRes.status === 404 || isConsoleFeatureDisabled(jobsRes.data)) {
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

/**
 * 定时刷新守卫：上一次 tick 未完成时跳过本次触发，
 * 避免慢请求下 setInterval 造成重叠抓取。
 */
export function createSerialTick(tick: () => Promise<void>): () => void {
  let inFlight = false;
  return () => {
    if (inFlight) return;
    inFlight = true;
    // 双分支 then：复位守卫并吞掉异常，避免产生 unhandled rejection。
    void tick().then(
      () => { inFlight = false; },
      () => { inFlight = false; },
    );
  };
}

export const watchCommand = new Command('watch')
  .description('监视运行中实例（Host API：stats / bots / assistant jobs）')
  .option('-i, --interval <seconds>', '刷新间隔（秒）', '3')
  .option('--once', '拉取一次后退出')
  .option('--json', 'JSON 输出（适合脚本）')
  .option('--no-clear', '不清屏（便于重定向到文件）')
  .option('--host <url>', HOST_OPTION_DESCRIPTION)
  .option('--allow-unverified-host', ALLOW_UNVERIFIED_HOST_OPTION_DESCRIPTION)
  .action(async (opts: { interval: string; once?: boolean; json?: boolean; clear?: boolean; host?: string; allowUnverifiedHost?: boolean }) => {
    const http = await requireHostHttpConfig(opts, message => console.error(message));

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

    const timer = setInterval(createSerialTick(tick), intervalSec * 1000);

    const stop = () => {
      clearInterval(timer);
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
