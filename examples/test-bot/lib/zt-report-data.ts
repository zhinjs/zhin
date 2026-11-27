import { Time } from "zhin.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const isBun = typeof Bun !== "undefined";

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
  networkIp: string;
  /** IPv6（优先全局地址；无则省略）。 */
  networkIpv6?: string;
  networkMac?: string;
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

export function pickPrimaryIp(ipInfo: ReadonlyArray<ZtIpInfo>) {
  const ipv4 = ipInfo.find((i) => /^\d+\.\d+\.\d+\.\d+$/.test(i.ipAddress) && !i.ipAddress.startsWith("127."));
  if (ipv4) {
    return ipv4.netmask != null ? `${ipv4.ipAddress}/${ipv4.netmask}` : ipv4.ipAddress;
  }
  const sane = ipInfo.find((i) =>
    !i.ipAddress.startsWith("127.") && !i.ipAddress.startsWith("fe80:") && !i.ipAddress.startsWith("::1"));
  return sane?.ipAddress ?? ipInfo[0]?.ipAddress ?? "—";
}

export function pickIpv6(ipInfo: ReadonlyArray<ZtIpInfo>) {
  const global = ipInfo.find((i) =>
    i.ipAddress.includes(":") && !i.ipAddress.startsWith("fe80:") && !i.ipAddress.startsWith("::1"));
  if (global) return truncateText(global.ipAddress, 36);
  const link = ipInfo.find((i) => i.ipAddress.startsWith("fe80:"));
  return link ? truncateText(link.ipAddress, 36) : undefined;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

/* ------------------------------------------------------------------ */
/* 采样：以下全部基于 node:os / node:fs / process，无原生依赖。          */
/* CPU、进程 CPU 与网速需要两次采样求差；首个样本在模块加载时取得。      */
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

type Sample = {
  at: number;
  cpu: CpuTimes;
  proc: NodeJS.CpuUsage;
  net?: Map<string, NetCounters>;
};

function takeSample(): Sample {
  return { at: Date.now(), cpu: readCpuTimes(), proc: process.cpuUsage(), net: readNetCounters() };
}

let lastSample: Sample = takeSample();

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

type DiskEntry = { mount: string; usedSpace: number; totalSpace: number };

function statDisk(mount: string): DiskEntry | undefined {
  try {
    const st = fs.statfsSync(mount);
    const total = st.blocks * st.bsize;
    if (total <= 0) return undefined;
    const used = (st.blocks - st.bfree) * st.bsize;
    return { mount, usedSpace: used / GB, totalSpace: total / GB };
  } catch {
    return undefined;
  }
}

function readDisks(): DiskEntry[] {
  const mounts = [path.parse(process.cwd()).root || "/"];
  if (process.platform === "darwin") mounts.push("/System/Volumes/Data");
  const seen = new Set<string>();
  const disks: DiskEntry[] = [];
  for (const mount of mounts) {
    if (seen.has(mount)) continue;
    seen.add(mount);
    const disk = statDisk(mount);
    if (disk) disks.push(disk);
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

export function collectZtReportData(counts: ZtFrameworkCounts): ZtReportData {
  const now = takeSample();
  const prev = lastSample;
  lastSample = now;
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
  const available = meminfo?.get("MemAvailable") ?? os.freemem();
  const usedmem = Math.max(0, totalmem - available);
  const swapTotal = meminfo?.get("SwapTotal") ?? 0;
  const swapUsed = swapTotal > 0 ? swapTotal - (meminfo?.get("SwapFree") ?? swapTotal) : 0;

  const disks = readDisks();
  const diskTotal = disks.reduce((sum, d) => sum + d.totalSpace, 0);
  const diskUsed = disks.reduce((sum, d) => sum + d.usedSpace, 0);

  const iface = pickInterface();
  const ipInfo: ZtIpInfo[] = (iface?.[1] ?? []).map((a) => ({ ipAddress: a.address, netmask: cidrPrefix(a.cidr) }));
  const mac = iface?.[1].find((a) => a.mac && a.mac !== "00:00:00:00:00:00")?.mac;
  const counters = iface ? now.net?.get(iface[0]) : undefined;
  const prevCounters = iface ? prev.net?.get(iface[0]) : undefined;
  const networkSpeedLine = counters && prevCounters && elapsedSec > 0
    ? `↑ ${((counters.tx - prevCounters.tx) / 1024 / elapsedSec).toFixed(1)}  ↓ ${((counters.rx - prevCounters.rx) / 1024 / elapsedSec).toFixed(1)} KB/s`
    : "—";

  const memUsage = process.memoryUsage();
  const runTimeSec = process.uptime();
  const procCpuMicros = (now.proc.user - prev.proc.user) + (now.proc.system - prev.proc.system);
  const botCpu = elapsedSec > 0 ? (procCpuMicros / 1e6 / elapsedSec) * 100 : undefined;
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
    networkIpv6: pickIpv6(ipInfo),
    networkMac: mac || undefined,
    networkSpeedLine,
    networkTrafficLine: counters
      ? `↑ ${formatMemoSize(counters.tx)}  ↓ ${formatMemoSize(counters.rx)}`
      : undefined,
    gpuLine: undefined,
    botName: path.basename(process.title) || runtime,
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
    botName: runtime,
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
    data.networkIpv6 ? `IPv6  ${data.networkIpv6}` : null,
    data.networkMac ? `MAC  ${data.networkMac}` : null,
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
