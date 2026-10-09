import { jsx, renderToHtml } from "@zhin.js/jsx";
import {
  BarRow,
  CardHeader,
  EmptyState,
  Row,
  Section,
  StatChip,
} from "@zhin.js/components";
import {
  CARD_THEME,
  cardShell,
  elevatedCard,
  formatCount,
} from "./card-layout.js";
import type { MyStatsReportData, StatsRankReportData } from "./stats-data.js";

export const STATS_REPORT_CANVAS = CARD_THEME.canvas;

const T = CARD_THEME;

export async function buildStatsRankHtml(
  data: StatsRankReportData
): Promise<string> {
  const meta = data.empty
    ? undefined
    : `共 ${data.participantCount} 人 · ${formatCount(
        data.totalMessages
      )} 条消息${data.myRank != null ? ` · 你第 ${data.myRank} 名` : ""}`;

  const body = elevatedCard(
    data.empty
      ? [
          jsx(CardHeader, { title: data.title }),
          jsx(EmptyState, { message: "暂无统计数据" }),
        ]
      : [
          jsx(CardHeader, { title: data.title, subtitle: meta }),
          jsx(Row, {
            children: [
              jsx(StatChip, {
                label: "参与",
                value: formatCount(data.participantCount),
                accent: T.accentCpu,
              }),
              jsx(StatChip, {
                label: "消息",
                value: formatCount(data.totalMessages),
                accent: T.accentMem,
              }),
              data.myRank != null
                ? jsx(StatChip, {
                    label: "我的排名",
                    value: `#${data.myRank}`,
                    accent: T.accentDisk,
                  })
                : null,
            ],
            gap: 10,
            style: "margin-bottom:6px",
          }),
          jsx(Section, {
            title: "排行榜",
            children: data.entries.map((entry) =>
              jsx(BarRow, {
                rank: entry.rank,
                label: entry.name,
                value: `${entry.count} 条`,
                percent: entry.percent,
              })
            ),
          }),
        ]
  );

  return renderToHtml(cardShell(body));
}

export async function buildMyStatsHtml(
  data: MyStatsReportData
): Promise<string> {
  const body = elevatedCard([
    jsx(CardHeader, {
      title: data.userName,
      subtitle: `${data.scope}消息统计 · 活跃 ${data.activeDays} 天`,
    }),
    jsx(Row, {
      children: [
        jsx(StatChip, {
          label: "今日",
          value: formatCount(data.todayCount),
          accent: T.accentMem,
        }),
        jsx(StatChip, {
          label: "本周",
          value: formatCount(data.weekCount),
          accent: T.accentCpu,
        }),
      ],
      gap: 10,
      style: "margin-bottom:10px",
    }),
    jsx(Row, {
      children: [
        jsx(StatChip, {
          label: "本月",
          value: formatCount(data.monthCount),
          accent: T.barWarn,
        }),
        jsx(StatChip, {
          label: "总计",
          value: formatCount(data.totalCount),
          accent: T.accentDisk,
        }),
      ],
      gap: 10,
    }),
  ]);

  return renderToHtml(cardShell(body));
}
