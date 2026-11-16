/** `zhin watch` 纯函数（可单测） */
import { formatDateTime } from '@zhin.js/plugin-runtime';

export interface WatchProcessMemory {
  rss?: number;
  heapTotal?: number;
  heapUsed?: number;
  external?: number;
  arrayBuffers?: number;
}

export interface WatchOsMemory {
  freeMem?: number;
  totalMem?: number;
}

/** One process's figures from a single sample (#1250 `watch-memory-figures-inconsistent`). */
export interface WatchProcessSample {
  role: 'gateway' | 'instance';
  pid?: number;
  memory: WatchProcessMemory;
  /** Epoch ms of the sample, when the source reports it. */
  sampledAt?: number;
}

export interface WatchSystemInfo {
  uptime?: number;
  pid?: number;
  nodeVersion?: string;
  platform?: string;
  runtime?: string;
  processMemory?: WatchProcessMemory;
  osMemory?: WatchOsMemory;
}

export interface WatchStats {
  uptime?: number;
  memory?: number;
  endpoints?: { total?: number; online?: number };
  plugins?: { total?: number; active?: number };
  commands?: number;
  components?: number;
  runtime?: string;
}

export interface WatchEndpointRow {
  name: string;
  adapter: string;
  status: 'online' | 'offline';
}

export interface WatchJobRow {
  id: string;
  label?: string;
  enabled: boolean;
  schedule: string;
  notify: string;
  lastStatus?: string;
  lastError?: string;
}

export function formatUptime(seconds: number | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '-';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** 字节 → 人类可读（默认 MB，小于 1MB 用 KB） */
export function formatBytes(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '-';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  const value = bytes / k ** i;
  const digits = i <= 1 ? 0 : i === 2 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[i]}`;
}

export function parseProcessMemory(raw: Record<string, unknown> | undefined): WatchProcessMemory {
  if (!raw || typeof raw !== 'object') return {};
  const num = (k: string) => {
    const v = raw[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  return {
    rss: num('rss'),
    heapTotal: num('heapTotal'),
    heapUsed: num('heapUsed'),
    external: num('external'),
    arrayBuffers: num('arrayBuffers'),
  };
}

/**
 * A `ConsoleProcessSample` (`GET /system/status` → `process`, `gateway.instance.status` → `gateway`),
 * the source the Console home「进程与资源」panel reads. Undefined unless it has the expected role.
 */
export function processSampleFromApi(raw: unknown, role: WatchProcessSample['role']): WatchProcessSample | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const sample = raw as Record<string, unknown>;
  if (sample.role !== role || !sample.memory || typeof sample.memory !== 'object') return undefined;
  return {
    role,
    ...(typeof sample.pid === 'number' ? { pid: sample.pid } : {}),
    memory: parseProcessMemory(sample.memory as Record<string, unknown>),
    ...(typeof sample.sampledAt === 'number' ? { sampledAt: sample.sampledAt } : {}),
  };
}

/** The instance's sample of a `/system/status` answer; older instances only have `memory` + `pid`, still one call. */
export function instanceSampleFromStatus(data: Record<string, unknown> | undefined): WatchProcessSample | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const labeled = processSampleFromApi(data.process, 'instance');
  if (labeled) return labeled;
  if (!data.memory || typeof data.memory !== 'object') return undefined;
  return {
    role: 'instance',
    ...(typeof data.pid === 'number' ? { pid: data.pid } : {}),
    memory: parseProcessMemory(data.memory as Record<string, unknown>),
  };
}

export function systemInfoFromApi(data: Record<string, unknown> | undefined): WatchSystemInfo | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const osRaw = data.osMemory as Record<string, unknown> | undefined;
  const memRaw = data.memory as Record<string, unknown> | undefined;
  return {
    uptime: typeof data.uptime === 'number' ? data.uptime : undefined,
    pid: typeof data.pid === 'number' ? data.pid : undefined,
    nodeVersion: data.nodeVersion != null ? String(data.nodeVersion) : undefined,
    platform: data.platform != null ? String(data.platform) : undefined,
    runtime: data.runtime != null ? String(data.runtime) : undefined,
    processMemory: parseProcessMemory(memRaw),
    osMemory: osRaw
      ? {
          freeMem: typeof osRaw.freeMem === 'number' ? osRaw.freeMem : undefined,
          totalMem: typeof osRaw.totalMem === 'number' ? osRaw.totalMem : undefined,
        }
      : undefined,
  };
}

function processLines(sample: WatchProcessSample): string[] {
  const pm = sample.memory;
  const lines = [`  ${sample.role.padEnd(8)} ${sample.pid != null ? `pid ${sample.pid}` : 'pid -'}${sample.sampledAt != null
    ? `  采样 ${formatDateTime(sample.sampledAt, undefined, { part: 'time' })}` : ''}`];
  lines.push(`    rss          ${formatBytes(pm.rss)}`);
  lines.push(`    heapUsed     ${formatBytes(pm.heapUsed)}`);
  lines.push(`    heapTotal    ${formatBytes(pm.heapTotal)}`);
  lines.push(`    external     ${formatBytes(pm.external)}`);
  if (pm.arrayBuffers != null) lines.push(`    arrayBuffers ${formatBytes(pm.arrayBuffers)}`);
  // Both figures are from one sample: rss only counts resident pages, so compressed / swapped heap
  // pages (macOS memory compression) can make it smaller than heapUsed.
  if (pm.rss != null && pm.heapUsed != null && pm.rss < pm.heapUsed) {
    lines.push('    （同一次采样：rss 只计常驻物理内存，部分堆内存被系统压缩或换出时会小于 heapUsed）');
  }
  return lines;
}

/**
 * Memory per process (#1250 `watch-memory-figures-inconsistent`): every figure is labeled with its
 * process and all of one process's figures come from one sample — the instance from
 * `GET /system/status`, the gateway from `gateway.instance.status`, as the Console home panel.
 */
export function renderMemorySection(system?: WatchSystemInfo, samples: readonly WatchProcessSample[] = []): string[] {
  const lines: string[] = ['Memory'];
  const om = system?.osMemory ?? {};
  const instance = samples.find(sample => sample.role === 'instance')
    ?? { role: 'instance' as const, ...(system?.pid != null ? { pid: system.pid } : {}), memory: system?.processMemory ?? {} };
  lines.push(...processLines(instance));
  const gateway = samples.find(sample => sample.role === 'gateway');
  if (gateway) lines.push(...processLines(gateway));
  if (om.totalMem != null || om.freeMem != null) {
    const used = om.totalMem != null && om.freeMem != null ? om.totalMem - om.freeMem : undefined;
    lines.push('  host');
    lines.push(`    totalMem     ${formatBytes(om.totalMem)}`);
    lines.push(`    freeMem      ${formatBytes(om.freeMem)}`);
    if (used != null) {
      lines.push(`    usedMem      ${formatBytes(used)}`);
    }
  }
  return lines;
}

export function formatJobSchedule(schedule: Record<string, unknown> | undefined): string {
  if (!schedule || typeof schedule !== 'object') return '?';
  const kind = String(schedule.kind ?? '');
  if (kind === 'cron' && schedule.expr) return `cron ${schedule.expr}`;
  if (kind === 'every' && schedule.everyMs != null) {
    const ms = Number(schedule.everyMs);
    if (ms >= 86_400_000) return `every ${Math.round(ms / 86_400_000)}d`;
    if (ms >= 3_600_000) return `every ${Math.round(ms / 3_600_000)}h`;
    if (ms >= 60_000) return `every ${Math.round(ms / 60_000)}m`;
    return `every ${Math.round(ms / 1000)}s`;
  }
  if (kind === 'at' && schedule.atMs != null) {
    return `at ${formatDateTime(Number(schedule.atMs)).slice(0, 16)}`;
  }
  if (kind === 'event') {
    const src = schedule.source ? String(schedule.source) : 'event';
    const typ = schedule.eventType ? `/${schedule.eventType}` : '';
    return `event:${src}${typ}`;
  }
  return kind || '?';
}

export function formatNotifyChannel(notify: Record<string, unknown> | undefined): string {
  if (!notify || typeof notify !== 'object') return '-';
  const ch = String(notify.channel ?? '-');
  if (ch !== 'im') return ch;
  const parts = [ch];
  if (notify.platform) parts.push(String(notify.platform));
  if (notify.sceneId) parts.push(`scene:${notify.sceneId}`);
  return parts.join('/');
}

export function truncateText(text: string | undefined, max = 48): string {
  if (!text) return '-';
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function jobRowsFromApi(jobs: unknown[]): WatchJobRow[] {
  return jobs.map((raw) => {
    const j = raw as Record<string, unknown>;
    const state = (j.state ?? {}) as Record<string, unknown>;
    const notify = j.notify as Record<string, unknown> | undefined;
    const schedule = j.schedule as Record<string, unknown> | undefined;
    return {
      id: String(j.id ?? ''),
      label: j.label != null ? String(j.label) : undefined,
      enabled: j.enabled !== false,
      schedule: formatJobSchedule(schedule),
      notify: formatNotifyChannel(notify),
      lastStatus: state.lastStatus != null ? String(state.lastStatus) : undefined,
      lastError: state.lastError != null ? String(state.lastError) : undefined,
    };
  });
}

export function renderWatchText(options: {
  baseUrl: string;
  fetchedAt: Date;
  stats?: WatchStats;
  system?: WatchSystemInfo;
  /** Labeled per-process samples (instance, and the gateway when reachable over the local socket). */
  processes?: readonly WatchProcessSample[];
  endpoints?: WatchEndpointRow[];
  assistantEnabled?: boolean;
  eventsActive?: boolean;
  jobs?: WatchJobRow[];
  error?: string;
}): string {
  const lines: string[] = [];
  const ts = formatDateTime(options.fetchedAt, undefined, { part: 'time' });
  lines.push(`Zhin watch  ${options.baseUrl}  @ ${ts}`);
  lines.push('─'.repeat(72));

  if (options.error) {
    lines.push(`⚠ ${options.error}`);
    lines.push('');
    lines.push('提示: 在项目根运行 zhin start（管理网关承载 Console）');
    return lines.join('\n');
  }

  const st = options.stats ?? {};
  const sys = options.system;
  const uptime = sys?.uptime ?? st.uptime;
  const bots = st.endpoints ?? {};
  const runtimeBits = [
    `uptime ${formatUptime(uptime)}`,
    sys?.pid != null ? `pid ${sys.pid}` : null,
    sys?.nodeVersion ?? null,
    sys?.platform ?? null,
  ].filter(Boolean);
  lines.push(`Runtime  ${runtimeBits.join('  ')}`);
  lines.push(
    `         bots ${bots.online ?? 0}/${bots.total ?? 0}  plugins ${st.plugins?.active ?? '-'}/${st.plugins?.total ?? '-'}  cmds ${st.commands ?? '-'}  components ${st.components ?? '-'}`,
  );
  lines.push('');
  lines.push(...renderMemorySection(sys, options.processes));
  lines.push('');

  const botList = options.endpoints ?? [];
  if (botList.length === 0) {
    lines.push('Bots     (none registered)');
  } else {
    lines.push('Bots');
    for (const b of botList) {
      const mark = b.status === 'online' ? '●' : '○';
      lines.push(`  ${mark} ${b.adapter}/${b.name}  ${b.status}`);
    }
  }
  lines.push('');

  if (options.assistantEnabled === false) {
    lines.push('Assistant  disabled (assistant.enabled: false)');
  } else if (options.jobs != null) {
    const ev = options.eventsActive ? 'events:on' : 'events:off';
    lines.push(`Assistant jobs (${options.jobs.length})  ${ev}`);
    if (options.jobs.length === 0) {
      lines.push('  (empty)');
    } else {
      for (const j of options.jobs) {
        const status = j.enabled ? 'on' : 'off';
        const last = j.lastStatus ?? '-';
        const label = j.label ? ` ${j.label}` : '';
        lines.push(`  [${status}] ${j.id}${label}`);
        lines.push(`       ${j.schedule}  notify:${j.notify}  last:${last}`);
        if (j.lastError && j.lastStatus === 'error') {
          lines.push(`       err: ${truncateText(j.lastError, 64)}`);
        }
      }
    }
  } else {
    lines.push('Assistant  (API unavailable or assistant not enabled)');
  }

  lines.push('');
  lines.push('Ctrl+C 退出 · zhin watch --json 快照 · --once 单次');
  return lines.join('\n');
}
