import { jsx, renderToHtml } from "@zhin.js/jsx";
import {
  BarChart,
  CardHeader,
  ProfileRow,
  QuoteCard,
  Row,
  Section,
  StatChip,
  TopicItem,
} from "@zhin.js/components";
import type { AnalysisReportData } from "./analysis.js";
import {
  CARD_THEME,
  cardShell,
  elevatedCard,
  formatCount,
} from "./card-layout.js";

export const ANALYSIS_REPORT_CANVAS = CARD_THEME.canvas;

const T = {
  ...CARD_THEME,
  accentMsg: CARD_THEME.accentMem,
  accentPeople: CARD_THEME.accentCpu,
  accentChars: CARD_THEME.accentDisk,
  accentHour: CARD_THEME.barWarn,
} as const;

export async function buildAnalysisReportHtml(
  data: AnalysisReportData
): Promise<string> {
  const { stats, channelName, days, startDate, endDate, llm } = data;
  const title = channelName ? `${channelName} · 群日常分析` : "群日常分析";
  const peakLabel = `${String(stats.mostActiveHour).padStart(2, "0")}:00`;
  const hourlyValues = Array.from(
    { length: 24 },
    (_, hour) => stats.hourlyDistribution[hour] || 0
  );

  const llmBlocks = [
    llm?.topics?.length
      ? jsx(Section, {
          title: "热门话题",
          children: llm.topics.map((topic, i) =>
            jsx(TopicItem, {
              index: i + 1,
              title: topic.topic,
              summary: topic.summary,
            })
          ),
        })
      : "",
    llm?.quotes?.length
      ? jsx(Section, {
          title: "金句精选",
          children: llm.quotes.map((quote, i) =>
            jsx(QuoteCard, {
              index: i + 1,
              content: quote.content,
              author: quote.sender,
              reason: quote.reason,
            })
          ),
        })
      : "",
    llm?.userTitles?.length
      ? jsx(Section, {
          title: "用户画像",
          children: llm.userTitles.map((user, i) =>
            jsx(ProfileRow, {
              index: i + 1,
              name: user.name,
              badge: user.title,
              reason: user.reason,
            })
          ),
        })
      : "",
  ];

  const body = elevatedCard([
    jsx(CardHeader, {
      title,
      subtitle: `${startDate} 至 ${endDate} · 最近 ${days} 天`,
    }),
    jsx(Row, {
      children: [
        jsx(StatChip, {
          label: "消息",
          value: formatCount(stats.messageCount),
          accent: T.accentMsg,
        }),
        jsx(StatChip, {
          label: "参与",
          value: formatCount(stats.participantCount),
          accent: T.accentPeople,
        }),
        jsx(StatChip, {
          label: "字数",
          value: formatCount(stats.totalChars),
          accent: T.accentChars,
        }),
        jsx(StatChip, {
          label: "活跃",
          value: peakLabel,
          accent: T.accentHour,
        }),
      ],
      gap: 10,
      style: "margin-bottom:4px",
    }),
    jsx(Section, {
      title: "每小时消息分布",
      children: jsx(BarChart, {
        values: hourlyValues,
        peakIndex: stats.mostActiveHour,
        accent: T.accentMsg,
        peakAccent: T.accentHour,
      }),
    }),
    llmBlocks,
  ]);

  return renderToHtml(cardShell(body));
}
