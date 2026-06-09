import { BarRow, CardHeader, EmptyState, h, Row, Section, StatChip } from "@zhin.js/satori";
import {
  CARD_THEME,
  cardShell,
  elevatedCard,
  formatCount,
} from "./card-layout.js";
import type { MyStatsReportData, StatsRankReportData } from "./stats-data.js";

export const STATS_REPORT_CANVAS = CARD_THEME.canvas;

const T = CARD_THEME;

export function buildStatsRankHtml(data: StatsRankReportData): string {
  const meta = data.empty
    ? undefined
    : `共 ${data.participantCount} 人 · ${formatCount(data.totalMessages)} 条消息${data.myRank != null ? ` · 你第 ${data.myRank} 名` : ""}`;

  const body = elevatedCard(data.empty
    ? [
        h(CardHeader, { title: data.title }),
        h(EmptyState, { message: "暂无统计数据" }),
      ].join("")
    : [
        h(CardHeader, { title: data.title, meta }),
        h(Row, {
          children: [
            h(StatChip, { label: "参与", value: formatCount(data.participantCount), accent: T.accentCpu }),
            h(StatChip, { label: "消息", value: formatCount(data.totalMessages), accent: T.accentMem }),
            data.myRank != null ? h(StatChip, { label: "我的排名", value: `#${data.myRank}`, accent: T.accentDisk }) : null,
          ],
          gap: 10,
          style: "margin-bottom:6px",
        }),
        h(Section, {
          title: "排行榜",
          children: data.entries.map((entry) => h(BarRow, {
            rank: entry.rank,
            label: entry.name,
            value: `${entry.count} 条`,
            percent: entry.percent,
          })),
        }),
      ].join(""));

  return cardShell(body);
}

export function buildMyStatsHtml(data: MyStatsReportData): string {
  const body = elevatedCard([
    h(CardHeader, {
      title: data.userName,
      meta: `${data.scope}消息统计 · 活跃 ${data.activeDays} 天`,
    }),
    h(Row, {
      children: [
        h(StatChip, { label: "今日", value: formatCount(data.todayCount), accent: T.accentMem }),
        h(StatChip, { label: "本周", value: formatCount(data.weekCount), accent: T.accentCpu }),
      ],
      gap: 10,
      style: "margin-bottom:10px",
    }),
    h(Row, {
      children: [
        h(StatChip, { label: "本月", value: formatCount(data.monthCount), accent: T.barWarn }),
        h(StatChip, { label: "总计", value: formatCount(data.totalCount), accent: T.accentDisk }),
      ],
      gap: 10,
    }),
  ].join(""));

  return cardShell(body);
}
