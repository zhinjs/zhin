import { assertCardImage } from "../../../tests/helpers/render-card.js";
import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import type { StatsFs } from "node:fs";
import ztCommand from "../commands/zt/index.js";
import {
  buildZtReportHtml,
  buildZtReportText,
  collectZtFallbackData,
  collectZtReportData,
  ztReportReply,
} from "../lib/zt-report.js";
import {
  cpuUsageBetween,
  formatNetworkSpeed,
  parseProcMeminfo,
  parseProcNetDev,
  pickPrimaryIp,
  readDisks,
  type ZtSample,
} from "../lib/zt-report-data.js";

// Verify actual PNG delivery from the shared HTML rendering engine.
async function assertImage(fragment: string) {
  await assertCardImage(fragment);
}

const counts = { adapters: 2, plugins: 5 } as const;

describe("zt-report", () => {
  it("ztReportReply 返回 html 段", async () => {
    const data = collectZtFallbackData(counts);
    const reply = await ztReportReply(data);
    expect(reply).toMatchObject({ type: "html" });
    expect(reply.data.html).toContain("系统状态");
  });

  it("buildZtReportHtml 生成可渲染的 HTML 卡片", async () => {
    const data = collectZtFallbackData(counts);
    const html = await buildZtReportHtml(data);
    expect(html).toContain("系统状态");
    expect(html).toContain(data.hostName);
    expect(html).toContain("适配器 2 · 插件 5");
    expect(html).not.toContain("<script");
  });

  it("buildZtReportHtml 可通过 Shotium 渲染", async () => {
    const data = collectZtFallbackData(counts);
    await assertImage(await buildZtReportHtml(data));
  });

  it("长挂载路径布局可通过 Shotium 渲染", async () => {
    const data = collectZtFallbackData(counts);
    data.diskMounts = [
      { mount: "/", used: "332.0 GB", total: "460.0 GB", usage: 72.2 },
      { mount: "/System/Volumes/Data", used: "332.0 GB", total: "460.0 GB", usage: 72.2 },
      { mount: "…lumes/Adobe XD v57.1.12.2", used: "2.0 GB", total: "2.0 GB", usage: 100 },
    ];
    data.diskValue = "666.0 GB / 922.0 GB";
    data.diskUsage = 72.2;
    await assertImage(await buildZtReportHtml(data));
  });

  it("buildZtReportHtml 完整采集数据可通过 Shotium 渲染", async () => {
    let data;
    try {
      data = await collectZtReportData(counts, { sampleMs: 0 });
    } catch {
      return;
    }
    expect(data.frameworkLine).toBe("适配器 2 · 插件 5");
    const html = await buildZtReportHtml(data);
    expect(html).toContain("网络");
    expect(html).not.toContain("MAC");
    expect(html).not.toContain("IPv6");
    if (data.networkTrafficLine) expect(html).toContain("累计");
    await assertImage(html);
  });
});

describe("zt-report-data（node:os 采集，替代已废弃的 @puniyu/system-info）", () => {
  it("collectZtReportData 只用 Node 内置接口就能填满主机、CPU、内存、磁盘与进程信息", async () => {
    const data = await collectZtReportData(counts, { sampleMs: 0 });
    expect(data.hostName).toBe(os.hostname());
    expect(data.osLine).toContain(os.arch());
    expect(data.cpuCoresLine).toContain(`${os.cpus().length}T`);
    expect(data.memValue).toMatch(/ \/ /);
    expect(data.memUsage).toBeGreaterThan(0);
    expect(data.memUsage).toBeLessThanOrEqual(100);
    expect(data.botPid).toBe(process.pid);
    expect(data.diskMounts.length).toBeGreaterThan(0);
    expect(data.diskUsage).toBeGreaterThanOrEqual(0);
    expect(data.fallbackNote).toBeUndefined();
    if (data.cpuUsage != null) {
      expect(data.cpuUsage).toBeGreaterThanOrEqual(0);
      expect(data.cpuUsage).toBeLessThanOrEqual(100);
    }
  });

  it("CPU / 网速按需采样：每次采集取两个样本、等待注入的时长，不依赖上一次调用（#1250 b112）", async () => {
    let tick = 0;
    const sample = (): ZtSample => {
      tick++;
      // 第 1、3 个样本 idle 100/200；第 2、4 个 idle 150/300：每次采集窗口内占用 50%。
      const odd = tick % 2 === 1;
      return {
        at: odd ? 0 : 1000,
        cpu: odd ? { idle: 100, total: 200 } : { idle: 150, total: 300 },
        proc: { user: odd ? 0 : 100_000, system: 0 },
      };
    };
    const waits: number[] = [];
    const wait = async (ms: number) => { waits.push(ms); };
    const first = await collectZtReportData(counts, { sample, wait });
    const second = await collectZtReportData(counts, { sample, wait, sampleMs: 50 });
    expect(tick).toBe(4);
    expect(waits).toEqual([300, 50]);
    expect(first.cpuUsage).toBe(50);
    expect(second.cpuUsage).toBe(50);
    expect(first.botCpu).toBeCloseTo(10);
    expect(second.botCpu).toBeCloseTo(10);
  });

  it("网速：计数器归零后负的差值钳到 0", () => {
    expect(formatNetworkSpeed({ rx: 10_240, tx: 2048 }, { rx: 20_480, tx: 4096 }, 1)).toBe("↑ 2.0  ↓ 10.0 KB/s");
    expect(formatNetworkSpeed({ rx: 9_999_999, tx: 9_999_999 }, { rx: 1024, tx: 0 }, 1)).toBe("↑ 0.0  ↓ 0.0 KB/s");
    expect(formatNetworkSpeed(undefined, { rx: 1, tx: 1 }, 1)).toBe("—");
    expect(formatNetworkSpeed({ rx: 1, tx: 1 }, { rx: 2, tx: 2 }, 0)).toBe("—");
  });

  it("readDisks：darwin 优先 /System/Volumes/Data，同一 APFS 容器只算一次（#1250 b112）", () => {
    const stat = (blocks: number, bfree: number, bsize = 4096) => ({ blocks, bfree, bsize } as StatsFs);
    const calls: string[] = [];
    const sameContainer = (mount: string) => { calls.push(mount); return stat(1_000_000, 400_000); };
    const darwin = readDisks({ platform: "darwin", cwd: "/Users/me/bot", statfs: sameContainer });
    expect(calls).toEqual(["/System/Volumes/Data", "/"]);
    expect(darwin).toHaveLength(1);
    expect(darwin[0]!.mount).toBe("/System/Volumes/Data");
    expect(darwin[0]!.totalSpace).toBeCloseTo((1_000_000 * 4096) / 1024 ** 3);
    // 不同卷（数值不同）仍各算一次。
    const distinct = readDisks({
      platform: "darwin",
      cwd: "/",
      statfs: (mount) => mount === "/" ? stat(500_000, 100_000) : stat(1_000_000, 400_000),
    });
    expect(distinct.map((d) => d.mount)).toEqual(["/System/Volumes/Data", "/"]);
    // Linux 只看 cwd 所在根；statfs 失败时跳过。
    expect(readDisks({ platform: "linux", cwd: "/srv/bot", statfs: () => stat(10, 5) }).map((d) => d.mount)).toEqual(["/"]);
    expect(readDisks({ platform: "linux", cwd: "/", statfs: () => { throw new Error("EACCES"); } })).toEqual([]);
  });

  it("不泄露主机细节：无 MAC / IPv6 字段，IP 打码，botName 用可执行文件名（#1250 b112）", async () => {
    const data = await collectZtReportData(counts, { sampleMs: 0 });
    expect(data).not.toHaveProperty("networkMac");
    expect(data).not.toHaveProperty("networkIpv6");
    expect(data.networkIp).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    expect(data.botName).toBe(path.basename(process.execPath));
    const text = buildZtReportText(data);
    expect(text).not.toContain("MAC");
    expect(text).not.toContain("IPv6");
  });

  it("/zt 只允许 owner 或管理员使用", () => {
    expect(ztCommand.permit).toEqual(["admin"]);
  });

  it("cpuUsageBetween 由两次样本求占用率，无增量时为 undefined", () => {
    expect(cpuUsageBetween({ idle: 100, total: 200 }, { idle: 150, total: 300 })).toBe(50);
    expect(cpuUsageBetween({ idle: 100, total: 200 }, { idle: 100, total: 200 })).toBeUndefined();
  });

  it("解析 /proc/net/dev 与 /proc/meminfo", () => {
    const netDev = [
      "Inter-|   Receive                                                |  Transmit",
      " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed",
      "    lo:    1000      10    0    0    0     0          0         0     1000      10    0    0    0     0       0          0",
      "  eth0: 2048000    2000    0    0    0     0          0         0   512000     900    0    0    0     0       0          0",
    ].join("\n");
    expect(parseProcNetDev(netDev).get("eth0")).toEqual({ rx: 2048000, tx: 512000 });
    const meminfo = parseProcMeminfo("MemTotal:       16000000 kB\nMemAvailable:    8000000 kB\nSwapTotal: 0 kB\n");
    expect(meminfo.get("MemAvailable")).toBe(8000000 * 1024);
    expect(meminfo.get("SwapTotal")).toBe(0);
  });

  it("pickPrimaryIp 选出非回环地址并打码，只留网段前缀", () => {
    const ips = [
      { ipAddress: "127.0.0.1", netmask: 8 },
      { ipAddress: "fe80::1" },
      { ipAddress: "192.168.1.5", netmask: 24 },
      { ipAddress: "2001:db8::5" },
    ];
    expect(pickPrimaryIp(ips)).toBe("192.168.x.x/24");
    expect(pickPrimaryIp([{ ipAddress: "fe80::1" }, { ipAddress: "2001:db8:1:2::5", netmask: 64 }])).toBe("2001:db8:…/64");
    expect(pickPrimaryIp([])).toBe("—");
  });
});
