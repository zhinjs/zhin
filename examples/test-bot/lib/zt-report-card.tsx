import {
  Card,
  CardCanvas,
  CardHeader,
  Col,
  DEFAULT_CARD_THEME,
  DualSection,
  h,
  KvTable,
  LABEL_W,
  MetricBlock,
  Row,
  Section,
  StatChip,
  Surface,
  tightHtml,
  UsageBar,
} from "@zhin.js/satori";
import {
  formatCpuSample,
  formatPercent,
  type ZtReportData,
} from "./zt-report-data.js";

export const ZT_REPORT_CANVAS = DEFAULT_CARD_THEME.canvas;

const T = DEFAULT_CARD_THEME;

export interface ZtReportCardProps {
  data: ZtReportData;
  subtitle?: string;
}

function DiskMountRow({
  mount,
  used,
  total,
  usage,
}: {
  mount: string;
  used: string;
  total: string;
  usage?: number;
}): string {
  return (
    `<div style="display:flex;flex-direction:row;align-items:center;margin-bottom:6px">` +
    `<div style="display:flex;width:${LABEL_W}px;min-width:${LABEL_W}px;max-width:${LABEL_W}px;color:${T.textMuted};font-size:12px;line-height:16px;text-align:right;padding-right:10px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${mount}</div>` +
    `<div style="display:flex;flex-direction:column;flex:1;min-width:0;gap:4px">` +
    `<div style="color:${T.textMuted};font-size:11px;line-height:14px;font-weight:500;white-space:nowrap">${used} / ${total}</div>` +
    h(UsageBar, { percent: usage, accent: T.accentDisk }) +
    `</div></div>`
  );
}

function buildZtReportBody(data: ZtReportData, subtitle = "Zhin.js test-bot"): string {
  const botCpu = formatCpuSample(data.botCpu, data.botRunTimeSec);

  const sections = [
    h(Section, {
      title: "主机",
      children: h(KvTable, {
        rows: [
          { label: "系统", value: data.osLine },
          { label: "运行", value: data.uptimeLine.replace(/^已运行\s*/, "") },
        ],
      }),
    }),
    h(Section, {
      title: "处理器",
      children: [
        h(KvTable, {
          rows: [
            { label: "型号", value: data.cpuModel },
            { label: "规格", value: data.cpuCoresLine },
          ],
        }),
        data.cpuUsage != null
          ? h(MetricBlock, { label: "占用", percent: data.cpuUsage, accent: T.accentCpu })
          : null,
      ],
    }),
    h(Section, {
      title: "内存",
      children: [
        h(MetricBlock, {
          label: "物理内存",
          value: data.memValue,
          percent: data.memUsage,
          accent: T.accentMem,
        }),
        data.swapValue
          ? h(MetricBlock, {
              label: "交换分区",
              value: data.swapValue,
              percent: data.swapUsage,
              accent: T.accentSwap,
            })
          : null,
      ],
    }),
    h(Section, {
      title: "磁盘",
      children: [
        h(MetricBlock, {
          label: "总用量",
          value: data.diskValue,
          percent: data.diskUsage,
          accent: T.accentDisk,
        }),
        h(KvTable, { rows: [{ label: "IO", value: data.diskIoLine }] }),
        data.diskMounts.length
          ? h(Col, {
              style: "margin-top:4px",
              children: data.diskMounts.map((d) =>
                DiskMountRow({
                  mount: d.mount,
                  used: d.used,
                  total: d.total,
                  usage: d.usage,
                }),
              ),
            })
          : h(MetricBlock, { label: "挂载", value: "无分区数据" }),
      ],
    }),
    data.gpuLine
      ? h(Section, {
          title: "GPU",
          children: h(KvTable, { rows: [{ label: "设备", value: data.gpuLine }] }),
        })
      : null,
    h(DualSection, {
      left: {
        title: "网络",
        rows: [
          { label: "网卡", value: data.networkName },
          { label: "地址", value: data.networkIp },
          { label: "速率", value: data.networkSpeedLine },
        ],
      },
      right: {
        title: "Bot 进程",
        rows: [
          { label: "进程", value: `${data.botName} · ${data.botPid}` },
          { label: "运行", value: data.botUptime },
          { label: "CPU", value: botCpu },
          {
            label: "内存",
            value: `${data.botMemMb}${data.botMemPct != null ? ` (${formatPercent(data.botMemPct)})` : ""}`,
          },
          { label: "运行时", value: `${data.botRuntime} · RSS ${data.botRss}` },
          { label: "堆内存", value: data.botHeap },
          { label: "框架", value: data.frameworkLine },
        ],
      },
    }),
  ];

  return h(Card, {
    children: [
      h(CardHeader, { title: "系统状态", subtitle, badge: data.hostName }),
      h(Row, {
        gap: 10,
        style: "margin-bottom:6px",
        children: [
          h(StatChip, { label: "CPU", value: formatPercent(data.cpuUsage), accent: T.accentCpu }),
          h(StatChip, { label: "内存", value: formatPercent(data.memUsage), accent: T.accentMem }),
          h(StatChip, { label: "磁盘", value: formatPercent(data.diskUsage), accent: T.accentDisk }),
        ],
      }),
      h(Col, { gap: 0, children: sections }),
      data.fallbackNote
        ? h(Surface, {
            padding: "10px 12px",
            style: "margin-top:14px;",
            children: `<div style="color:${T.textSecondary};font-size:11px">${data.fallbackNote}</div>`,
          })
        : null,
    ],
  });
}

export function buildZtReportHtml(data: ZtReportData, options?: { subtitle?: string }): string {
  return tightHtml(
    h(CardCanvas, { children: buildZtReportBody(data, options?.subtitle) }),
  );
}
