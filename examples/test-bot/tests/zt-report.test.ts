import { assertCardImage } from "../../../tests/helpers/render-card.js";
import { describe, it, expect } from "vitest";
import * as os from "node:os";
import {
  buildZtReportHtml,
  collectZtFallbackData,
  collectZtReportData,
  ztReportReply,
} from "../lib/zt-report.js";
import {
  cpuUsageBetween,
  parseProcMeminfo,
  parseProcNetDev,
  pickIpv6,
  pickPrimaryIp,
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
      data = collectZtReportData(counts);
    } catch {
      return;
    }
    expect(data.frameworkLine).toBe("适配器 2 · 插件 5");
    const html = await buildZtReportHtml(data);
    expect(html).toContain("网络");
    if (data.networkMac) expect(html).toContain(data.networkMac);
    if (data.networkTrafficLine) expect(html).toContain("累计");
    await assertImage(html);
  });
});

describe("zt-report-data（node:os 采集，替代已废弃的 @puniyu/system-info）", () => {
  it("collectZtReportData 只用 Node 内置接口就能填满主机、CPU、内存、磁盘与进程信息", () => {
    const data = collectZtReportData(counts);
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
    // 第二次采集有了上一个样本，CPU 占用率可由两次 os.cpus() 求差。
    const again = collectZtReportData(counts);
    if (again.cpuUsage != null) {
      expect(again.cpuUsage).toBeGreaterThanOrEqual(0);
      expect(again.cpuUsage).toBeLessThanOrEqual(100);
    }
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

  it("pickPrimaryIp / pickIpv6 选出非回环地址", () => {
    const ips = [
      { ipAddress: "127.0.0.1", netmask: 8 },
      { ipAddress: "fe80::1" },
      { ipAddress: "192.168.1.5", netmask: 24 },
      { ipAddress: "2001:db8::5" },
    ];
    expect(pickPrimaryIp(ips)).toBe("192.168.1.5/24");
    expect(pickIpv6(ips)).toBe("2001:db8::5");
  });
});
