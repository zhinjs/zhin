import { Time } from "zhin.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const isBun = typeof Bun !== "undefined";

/*
 * 照抄本示例的用户请注意：系统状态卡片会把主机信息发进聊天（主机名、操作系统与内核版本、
 * CPU 型号、磁盘与内存容量、网卡名）。本示例已去掉 MAC 与 IPv6、把 IP 打码成网段前缀，
 * 并在 `commands/zt` 用 `permit: ['admin']` 限制为 owner 或管理员；改动这些之前先想清楚
 * 卡片会发到哪些会话、谁能看到。
 */

/** Plugin Runtime 下与 Console `/api/stats` 对齐的框架计数（非 legacy Plugin.root）。 */
export type ZtFrameworkCounts = {
  readonly adapters: number;
  readonly plugins: number;
};

export interface ZtReportData {
  hostName: string;
  osLine: string;
  uptimeLine: string;
  cpuUsage?: number;
  cpuModel: string;
  cpuCoresLine: string;
  memValue: string;
  memUsage?: number;
  swapValue?: string;
  swapUsage?: number;
  diskValue: string;
  diskUsage?: number;
  diskIoLine: string;
  diskMounts: Array<{ mount: string; used: string; total: string; usage?: number }>;
  networkName: string;
  /** 打码后的主地址（只留网段前缀，如 `192.168.x.x/24`）。 */
  networkIp: string;
  networkSpeedLine: string;
  /** 累计流量 ↑/↓。 */
  networkTrafficLine?: string;
  gpuLine?: string;
  botName: string;
  botPid: number;
  botUptime: string;
  botRunTimeSec: number;
  botCpu?: number;
  botMemMb: string;
  botMemPct?: number;
  botRuntime: string;
  botRss: string;
  botHeap: string;
  frameworkLine: string;
  fallbackNote?: string;
}

export function formatMemoSize(size: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (size > 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(2)}${units[i]}`;
}

function formatMb(mb: number) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

export function formatPercent(value?: number) {
  return value == null || Number.isNaN(value) ? "—" : `${value.toFixed(1)}%`;
}

function formatGb(gb: number) {
  return gb >= 1024 ? `${(gb / 1024).toFixed(1)} TB` : `${gb.toFixed(1)} GB`;
}

function truncateText(text: string, max = 42) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function shortenMount(mount: string, max = 26) {
  if (mount.length <= max) return mount;
  if (mount.startsWith("/Volumes/")) return `…${mount.slice(-(max - 1))}`;
  return `${mount.slice(0, max - 1)}…`;
}

function resolveUsagePercent(reported: number | undefined, used: number, total: number) {
  if (reported != null && !Number.isNaN(reported) && reported > 0) return reported;
  if (total > 0 && used >= 0) return (used / total) * 100;
  return undefined;
}

export type ZtIpInfo = { ipAddress: string; netmask?: number };

/**
 * 打码地址，只留网段前缀：IPv4 留前两段（`192.168.x.x`），IPv6 留前两组（`2001:db8:…`），
 * 有掩码时附上前缀长度。完整地址不进卡片。
 */
export function maskIp(info: ZtIpInfo) {
  const address = info.ipAddress;
  const masked = address.includes(":")
    ? `${address.split(":").filter(Boolean).slice(0, 2).join(":")}:…`
    : `${address.split(".").slice(0, 2).join(".")}.x.x`;
  return info.netmask != null ? `${masked}/${info.netmask}` : masked;
}

/** 选出主地址（优先非回环 IPv4，其次非链路本地地址）并打码。 */
export function pickPrimaryIp(ipInfo: ReadonlyArray<ZtIpInfo>) {
  const ipv4 = ipInfo.find((i) => /^\d+\.\d+\.\d+\.\d+$/.test(i.ipAddress) && !i.ipAddress.startsWith("127."));
  const sane = ipv4 ?? ipInfo.find((i) =>
    !i.ipAddress.startsWith("127.") && !i.ipAddress.startsWith("fe80:") && !i.ipAddress.startsWith("::1"));
  const picked = sane ?? ipInfo[0];
  return picked ? maskIp(picked) : "—";
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

/* ------------------------------------------------------------------ */
/* 采样：以下全部基于 node:os / node:fs / process，无原生依赖。          */
/* CPU、进程 CPU 与网速需要两次采样求差：每次采集现取两个样本，        */
/* 中间等待 ZT_SAMPLE_MS（可注入），不保留模块级状态。                    */
/* ------------------------------------------------------------------ */

type CpuTimes = { idle: number; total: number };

function readCpuTimes(): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

/** 两个 os.cpus() 样本之间的系统 CPU 占用率（%）；无增量时为 undefined。 */
export function cpuUsageBetween(prev: CpuTimes, next: CpuTimes): number | undefined {
  const total = next.total - prev.total;
  if (total <= 0) return undefined;
  return Math.min(100, Math.max(0, (1 - (next.idle - prev.idle) / total) * 100));
}

type NetCounters = { rx: number; tx: number };

/** 解析 Linux /proc/net/dev，返回每个网卡的累计收发字节。 */
export function parseProcNetDev(text: string): Map<string, NetCounters> {
  const result = new Map<string, NetCounters>();
  for (const line of text.split("\n").slice(2)) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const name = line.slice(0, idx).trim();
    const fields = line.slice(idx + 1).trim().split(/\s+/).map(Number);
    if (fields.length < 9 || fields.some(Number.isNaN)) continue;
    result.set(name, { rx: fields[0]!, tx: fields[8]! });
  }
  return result;
}

function readNetCounters(): Map<string, NetCounters> | undefined {
  try {
    return parseProcNetDev(fs.readFileSync("/proc/net/dev", "utf8"));
  } catch {
    return undefined;
  }
}

/** 解析 Linux /proc/meminfo（单位 kB），返回字节。 */
export function parseProcMeminfo(text: string): Map<string, number> {
  const result = new Map<string, number>();
  for (const line of text.split("\n")) {
    const m = /^(\w+):\s+(\d+)\s*kB/.exec(line);
    if (m) result.set(m[1]!, Number(m[2]) * 1024);
  }
  return result;
}

export type ZtSample = {
  at: number;
  cpu: CpuTimes;
  proc: NodeJS.CpuUsage;
  net?: Map<string, NetCounters>;
};

function takeSample(): ZtSample {
  return { at: Date.now(), cpu: readCpuTimes(), proc: process.cpuUsage(), net: readNetCounters() };
}

/** 两次采样之间的默认等待（ms）：CPU 占用与网速是这段窗口内的平均值。 */
export const ZT_SAMPLE_MS = 300;

export interface ZtCollectOptions {
  /** 两次采样之间等待多久（ms），默认 {@link ZT_SAMPLE_MS}；测试可设为 0。 */
  readonly sampleMs?: number;
  /** 等待实现，默认 `setTimeout`；测试可替换。 */
  readonly wait?: (ms: number) => Promise<void>;
  /** 采样实现，默认读 os.cpus() / process.cpuUsage() / /proc/net/dev；测试可替换。 */
  readonly sample?: () => ZtSample;
}

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 由两次网卡计数求速率；计数器归零（重启网卡、溢出）时差值为负，钳到 0。 */
export function formatNetworkSpeed(prev: NetCounters | undefined, next: NetCounters | undefined, elapsedSec: number) {
  if (!prev || !next || !(elapsedSec > 0)) return "—";
  const rate = (delta: number) => (Math.max(0, delta) / 1024 / elapsedSec).toFixed(1);
  return `↑ ${rate(next.tx - prev.tx)}  ↓ ${rate(next.rx - prev.rx)} KB/s`;
}

/** 选出主网卡：优先带非回环 IPv4 的非 internal 网卡。 */
function pickInterface() {
  const entries = Object.entries(os.networkInterfaces())
    .map(([name, addrs]) => [name, (addrs ?? []).filter((a) => !a.internal)] as const)
    .filter(([, addrs]) => addrs.length > 0);
  return entries.find(([, addrs]) => addrs.some((a) => a.family === "IPv4")) ?? entries[0];
}

function cidrPrefix(cidr: string | null | undefined) {
  const n = cidr ? Number(cidr.split("/")[1]) : NaN;
  return Number.isInteger(n) ? n : undefined;
}

export type DiskEntry = { mount: string; usedSpace: number; totalSpace: number };

export interface ReadDisksOptions {
  readonly platform?: NodeJS.Platform;
  readonly cwd?: string;
  readonly statfs?: (mount: string) => Pick<fs.StatsFs, "blocks" | "bfree" | "bsize">;
}

/**
 * 读取要展示的卷。macOS 上 `/` 与 `/System/Volumes/Data` 在 APFS 下属于同一个容器，statfs
 * 返回同样的 `(blocks, bfree, bsize)`；按这三个值去重，避免合计翻倍，并优先列出数据卷。
 */
export function readDisks(options: ReadDisksOptions = {}): DiskEntry[] {
  const platform = options.platform ?? process.platform;
  const statfs = options.statfs ?? ((mount: string) => fs.statfsSync(mount));
  const root = path.parse(options.cwd ?? process.cwd()).root || "/";
  const mounts = platform === "darwin" ? ["/System/Volumes/Data", root] : [root];
  const seen = new Set<string>();
  const disks: DiskEntry[] = [];
  for (const mount of mounts) {
    let st: Pick<fs.StatsFs, "blocks" | "bfree" | "bsize">;
    try {
      st = statfs(mount);
    } catch {
      continue;
    }
    const total = st.blocks * st.bsize;
    if (!(total > 0)) continue;
    const key = `${st.blocks}:${st.bfree}:${st.bsize}`;
    if (seen.has(key)) continue;
    seen.add(key);
    disks.push({ mount, usedSpace: ((st.blocks - st.bfree) * st.bsize) / GB, totalSpace: total / GB });
  }
  return disks;
}

export function formatCpuSample(value: number | undefined, runTimeSec: number) {
  if (value != null && !Number.isNaN(value)) return `${value.toFixed(1)}%`;
  return runTimeSec < 30 ? "采样中" : "—";
}

function frameworkLine(counts: ZtFrameworkCounts) {
  return `适配器 ${counts.adapters} · 插件 ${counts.plugins}`;
}

/** 运行时名称：可执行文件名（如 `node`、`bun`），不用可被改写、可能含命令行的 `process.title`。 */
function botName() {
  return path.basename(process.execPath) || (isBun ? "bun" : "node");
}

export async function collectZtReportData(
  counts: ZtFrameworkCounts,
  options: ZtCollectOptions = {},
): Promise<ZtReportData> {
  const sample = options.sample ?? takeSample;
  const prev = sample();
  await (options.wait ?? defaultWait)(Math.max(0, options.sampleMs ?? ZT_SAMPLE_MS));
  const now = sample();
  const elapsedSec = Math.max(0, (now.at - prev.at) / 1000);

  const cpus = os.cpus();
  if (cpus.length === 0) throw new Error("os.cpus() returned no CPUs");
  const cpuUsage = cpuUsageBetween(prev.cpu, now.cpu);
  const frequencyGhz = (cpus[0]!.speed || 0) / 1000;

  const totalmem = os.totalmem();
  const meminfo = (() => {
    try {
      return parseProcMeminfo(fs.readFileSync("/proc/meminfo", "utf8"));
    } catch {
      return undefined;
    }
  })();
  // Linux 读 /proc/meminfo 的 MemAvailable（可回收的缓存不算占用）。其他系统没有该文件，退回
  // os.freemem()：macOS 上它只算完全空闲的页，文件缓存、压缩内存都会计入「已用」，所以数值
  // 通常比活动监视器里的「内存压力」高；Windows 上与任务管理器的「可用」相近。交换只在 Linux 上显示。
  const available = meminfo?.get("MemAvailable") ?? os.freemem();
  const usedmem = Math.max(0, totalmem - available);
  const swapTotal = meminfo?.get("SwapTotal") ?? 0;
  const swapUsed = swapTotal > 0 ? swapTotal - (meminfo?.get("SwapFree") ?? swapTotal) : 0;

  const disks = readDisks();
  const diskTotal = disks.reduce((sum, d) => sum + d.totalSpace, 0);
  const diskUsed = disks.reduce((sum, d) => sum + d.usedSpace, 0);

  const iface = pickInterface();
  const ipInfo: ZtIpInfo[] = (iface?.[1] ?? []).map((a) => ({ ipAddress: a.address, netmask: cidrPrefix(a.cidr) }));
  const counters = iface ? now.net?.get(iface[0]) : undefined;
  const prevCounters = iface ? prev.net?.get(iface[0]) : undefined;
  const networkSpeedLine = formatNetworkSpeed(prevCounters, counters, elapsedSec);

  const memUsage = process.memoryUsage();
  const runTimeSec = process.uptime();
  const procCpuMicros = (now.proc.user - prev.proc.user) + (now.proc.system - prev.proc.system);
  const botCpu = elapsedSec > 0 ? Math.max(0, (procCpuMicros / 1e6 / elapsedSec) * 100) : undefined;
  const runtime = isBun ? `Bun ${Bun.version}` : `Node ${process.version.replace(/^v/, "")}`;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return {
    hostName: os.hostname(),
    osLine: `${os.type()} ${os.release()} · ${os.arch()} · ${timeZone}`,
    uptimeLine: `已运行 ${Time.formatTime(os.uptime() * 1000)}`,
    cpuUsage,
    cpuModel: truncateText(cpus[0]!.model.trim() || "—", 40),
    cpuCoresLine: `${cpus.length}T${frequencyGhz > 0 ? ` · ${frequencyGhz.toFixed(2)} GHz` : ""}`,
    memValue: `${formatMb(usedmem / MB)} / ${formatMb(totalmem / MB)}`,
    memUsage: totalmem > 0 ? (usedmem / totalmem) * 100 : undefined,
    swapValue: swapTotal > 0 ? `${formatMb(swapUsed / MB)} / ${formatMb(swapTotal / MB)}` : undefined,
    swapUsage: swapTotal > 0 ? (swapUsed / swapTotal) * 100 : undefined,
    diskValue: disks.length ? `${formatGb(diskUsed)} / ${formatGb(diskTotal)}` : "—",
    diskUsage: disks.length ? resolveUsagePercent(undefined, diskUsed, diskTotal) : undefined,
    diskIoLine: "—",
    diskMounts: disks.slice(0, 3).map((d) => ({
      mount: shortenMount(d.mount),
      used: formatGb(d.usedSpace),
      total: formatGb(d.totalSpace),
      usage: resolveUsagePercent(undefined, d.usedSpace, d.totalSpace),
    })),
    networkName: iface?.[0] ?? "—",
    networkIp: pickPrimaryIp(ipInfo),
    networkSpeedLine,
    networkTrafficLine: counters
      ? `↑ ${formatMemoSize(counters.tx)}  ↓ ${formatMemoSize(counters.rx)}`
      : undefined,
    gpuLine: undefined,
    botName: botName(),
    botPid: process.pid,
    botUptime: Time.formatTime(runTimeSec * 1000),
    botRunTimeSec: runTimeSec,
    botCpu,
    botMemMb: formatMb(memUsage.rss / MB),
    botMemPct: totalmem > 0 ? (memUsage.rss / totalmem) * 100 : undefined,
    botRuntime: runtime,
    botRss: formatMemoSize(memUsage.rss),
    botHeap: `${formatMemoSize(memUsage.heapUsed)} / ${formatMemoSize(memUsage.heapTotal)}`,
    frameworkLine: frameworkLine(counts),
  };
}

export function collectZtFallbackData(counts: ZtFrameworkCounts): ZtReportData {
  const totalmem = os.totalmem();
  const freemem = os.freemem();
  const memUsage = process.memoryUsage();
  const runtime = isBun ? `Bun ${Bun.version}` : `Node ${process.version.replace(/^v/, "")}`;
  const load = os.loadavg().map((v) => v.toFixed(2)).join(" / ");

  return {
    hostName: os.hostname(),
    osLine: `${os.type()} ${os.release()} · ${os.arch()}`,
    uptimeLine: `负载 ${load} · ${os.cpus().length} 线程`,
    cpuModel: "—",
    cpuCoresLine: "系统信息采集失败",
    memValue: `${formatMemoSize(totalmem - freemem)} / ${formatMemoSize(totalmem)}`,
    memUsage: ((totalmem - freemem) / totalmem) * 100,
    diskValue: "—",
    diskIoLine: "—",
    diskMounts: [],
    networkName: "—",
    networkIp: "—",
    networkSpeedLine: "—",
    botName: botName(),
    botPid: process.pid,
    botUptime: Time.formatTime(process.uptime() * 1000),
    botRunTimeSec: process.uptime(),
    botMemMb: formatMemoSize(memUsage.rss),
    botRuntime: runtime,
    botRss: formatMemoSize(memUsage.rss),
    botHeap: `${formatMemoSize(memUsage.heapUsed)} / ${formatMemoSize(memUsage.heapTotal)}`,
    frameworkLine: frameworkLine(counts),
    fallbackNote: "系统信息采集失败，已回退基础信息",
  };
}

export function buildZtReportText(data: ZtReportData): string {
  const lines = [
    `**系统状态** · ${data.hostName}`,
    "",
    "**主机**",
    data.osLine,
    data.uptimeLine,
    "",
    data.cpuUsage != null ? `**CPU** · ${formatPercent(data.cpuUsage)}` : "**CPU**",
    data.cpuModel,
    data.cpuCoresLine,
    "",
    "**内存**",
    `${data.memValue}  ${formatPercent(data.memUsage)}`,
    data.swapValue ? `交换 ${data.swapValue}  ${formatPercent(data.swapUsage)}` : null,
    "",
    "**磁盘**",
    `合计 ${data.diskValue}  ${formatPercent(data.diskUsage)}`,
    `IO  ${data.diskIoLine}`,
    ...data.diskMounts.map((d) => `  ${d.mount.padEnd(10)} ${d.used} / ${d.total}  ${formatPercent(d.usage)}`),
    "",
    "**网络**",
    `${data.networkName} · ${data.networkIp}`,
    `速率  ${data.networkSpeedLine}`,
    data.networkTrafficLine ? `累计  ${data.networkTrafficLine}` : null,
    data.gpuLine ? ["", "**GPU**", data.gpuLine].join("\n") : null,
    "",
    "**Endpoint**",
    `${data.botName} (${data.botPid}) · ${data.botUptime} · CPU ${formatCpuSample(data.botCpu, data.botRunTimeSec)} · ${data.botMemMb}`,
    `${data.botRuntime} · RSS ${data.botRss} · 堆 ${data.botHeap}`,
    data.frameworkLine,
    data.fallbackNote ? "" : null,
    data.fallbackNote ? `_${data.fallbackNote}_` : null,
  ];
  return lines.filter((line): line is string => line != null).join("\n");
}
