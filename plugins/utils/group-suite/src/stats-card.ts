import { messages as t } from './i18n.js';
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
  data: StatsRankReportData,
  locale?: import('zhin.js/i18n').Locale
): Promise<string> {
  const meta = data.empty
    ? undefined
    : t(locale, 'cardMeta', { people: data.participantCount, messages: formatCount(data.totalMessages), rank: data.myRank != null ? t(locale, 'cardRank', { rank: data.myRank }) : '' });

  const body = elevatedCard(
    data.empty
      ? [
          jsx(CardHeader, { title: data.title }),
          jsx(EmptyState, { message: t(locale, 'noStats') }),
        ]
      : [
          jsx(CardHeader, { title: data.title, subtitle: meta }),
          jsx(Row, {
            children: [
              jsx(StatChip, {
                label: t(locale, 'participants'),
                value: formatCount(data.participantCount),
                accent: T.accentCpu,
              }),
              jsx(StatChip, {
                label: t(locale, 'messages'),
                value: formatCount(data.totalMessages),
                accent: T.accentMem,
              }),
              data.myRank != null
                ? jsx(StatChip, {
                    label: t(locale, 'myRank'),
                    value: `#${data.myRank}`,
                    accent: T.accentDisk,
                  })
                : null,
            ],
            gap: 10,
            style: "margin-bottom:6px",
          }),
          jsx(Section, {
            title: t(locale, 'leaderboard'),
            children: data.entries.map((entry) =>
              jsx(BarRow, {
                rank: entry.rank,
                label: entry.name,
                value: t(locale, 'messageCount', { count: entry.count }),
                percent: entry.percent,
              })
            ),
          }),
        ]
  );

  return renderToHtml(cardShell(body));
}

export async function buildMyStatsHtml(
  data: MyStatsReportData,
  locale?: import('zhin.js/i18n').Locale
): Promise<string> {
  const body = elevatedCard([
    jsx(CardHeader, {
      title: data.userName,
      subtitle: t(locale, 'myStatsSubtitle', { scope: data.scope, days: data.activeDays }),
    }),
    jsx(Row, {
      children: [
        jsx(StatChip, {
          label: t(locale, 'today'),
          value: formatCount(data.todayCount),
          accent: T.accentMem,
        }),
        jsx(StatChip, {
          label: t(locale, 'week'),
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
          label: t(locale, 'month'),
          value: formatCount(data.monthCount),
          accent: T.barWarn,
        }),
        jsx(StatChip, {
          label: t(locale, 'total'),
          value: formatCount(data.totalCount),
          accent: T.accentDisk,
        }),
      ],
      gap: 10,
    }),
  ]);

  return renderToHtml(cardShell(body));
}
