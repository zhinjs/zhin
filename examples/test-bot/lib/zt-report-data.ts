import { Time } from "zhin.js";
import * as os from "node:os";
import {
  getCpuInfo,
  getCurrentNetwork,
  getCurrentProcessInfo,
  getDiskInfo,
  getGpuInfo,
  getHostInfo,
  getMemoryInfo,
} from "@puniyu/system-info";

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

function pickPrimaryIp(ipInfo: Array<{ ipAddress: string; netmask?: number }>) {
  const ipv4 = ipInfo.find((i) => /^\d+\.\d+\.\d+\.\d+$/.test(i.ipAddress) && !i.ipAddress.startsWith("127."));
  if (ipv4) {
    return ipv4.netmask != null ? `${ipv4.ipAddress}/${ipv4.netmask}` : ipv4.ipAddress;
  }
  const sane = ipInfo.find((i) =>
    !i.ipAddress.startsWith("127.") && !i.ipAddress.startsWith("fe80:") && !i.ipAddress.startsWith("::1"));
  return sane?.ipAddress ?? ipInfo[0]?.ipAddress ?? "—";
}

function pickIpv6(ipInfo: Array<{ ipAddress: string }>) {
  const global = ipInfo.find((i) =>
    i.ipAddress.includes(":") && !i.ipAddress.startsWith("fe80:") && !i.ipAddress.startsWith("::1"));
  if (global) return truncateText(global.ipAddress, 36);
  const link = ipInfo.find((i) => i.ipAddress.startsWith("fe80:"));
  return link ? truncateText(link.ipAddress, 36) : undefined;
}

/** system-info 累计流量单位为 KB。 */
function formatTrafficKb(kb: number) {
  return formatMemoSize(kb * 1024);
}

export function formatCpuSample(value: number | undefined, runTimeSec: number) {
  if (value != null && !Number.isNaN(value)) return `${value.toFixed(1)}%`;
  return runTimeSec < 30 ? "采样中" : "—";
}

function frameworkLine(counts: ZtFrameworkCounts) {
  return `适配器 ${counts.adapters} · 插件 ${counts.plugins}`;
}

export function collectZtReportData(counts: ZtFrameworkCounts): ZtReportData {
  const host = getHostInfo();
  const cpu = getCpuInfo();
  const memory = getMemoryInfo();
  const disk = getDiskInfo();
  const network = getCurrentNetwork();
  const proc = getCurrentProcessInfo();
  const gpu = getGpuInfo();
  const memUsage = process.memoryUsage();
  const runtime = isBun ? `Bun ${Bun.version}` : `Node ${process.version.replace(/^v/, "")}`;
  const primaryIp = pickPrimaryIp(network.ipInfo);
  const diskUsage = resolveUsagePercent(disk.totalUsage, disk.totalUsedSpace, disk.totalSpace);

  return {
    hostName: host.hostName,
    osLine: `${host.osName} ${host.osVersion} · ${host.arch} · ${host.timeZone}`,
    uptimeLine: `已运行 ${Time.formatTime(host.uptime * 1000)}`,
    cpuUsage: cpu.usage,
    cpuModel: truncateText(cpu.modelName, 40),
    cpuCoresLine: `${cpu.physicalCores}C / ${cpu.logicalCores}T · ${cpu.frequency.toFixed(2)} GHz`,
    memValue: `${formatMb(memory.used)} / ${formatMb(memory.total)}`,
    memUsage: memory.usage,
    swapValue: memory.swapTotal
      ? `${formatMb(memory.swapUsed ?? 0)} / ${formatMb(memory.swapTotal)}`
      : undefined,
    swapUsage: memory.swapUsage,
    diskValue: `${formatGb(disk.totalUsedSpace)} / ${formatGb(disk.totalSpace)}`,
    diskUsage,
    diskIoLine: `读 ${disk.readSpeed.toFixed(1)} · 写 ${disk.writeSpeed.toFixed(1)} MB/s`,
    diskMounts: disk.disks.slice(0, 3).map((d) => ({
      mount: shortenMount(d.mount),
      used: formatGb(d.usedSpace),
      total: formatGb(d.totalSpace),
      usage: resolveUsagePercent(d.usage, d.usedSpace, d.totalSpace),
    })),
    networkName: network.name,
    networkIp: primaryIp,
    networkIpv6: pickIpv6(network.ipInfo),
    networkMac: network.macAddr || undefined,
    networkSpeedLine: `↑ ${network.upload.toFixed(1)}  ↓ ${network.download.toFixed(1)} KB/s`,
    networkTrafficLine: `↑ ${formatTrafficKb(network.totalUpload)}  ↓ ${formatTrafficKb(network.totalDownload)}`,
    gpuLine: gpu
      ? `${truncateText(gpu.model, 32)} · ${gpu.memoryUsed ?? "—"}/${gpu.memoryTotal ?? "—"} MB · ${formatPercent(gpu.usage)}`
      : undefined,
    botName: proc.name,
    botPid: proc.pid,
    botUptime: Time.formatTime(proc.runTime * 1000),
    botRunTimeSec: proc.runTime,
    botCpu: proc.cpuUsage,
    botMemMb: formatMb(proc.usedMemory),
    botMemPct: proc.memoryUsage,
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
    cpuCoresLine: "system-info 不可用",
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
    fallbackNote: "system-info 不可用，已回退基础信息",
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
