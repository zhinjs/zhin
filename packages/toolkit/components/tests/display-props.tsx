import {
  Badge,
  CardHeader,
  DualSection,
  KvTable,
  MetricBlock,
  QuoteCard,
  RadarChart,
  StatChip,
  ThemeProvider,
  Card,
  EmptyState,
} from "../src/index.js";
import type { JSXNode } from '@zhin.js/jsx';

async function AsyncDisplay(): Promise<JSXNode> {
  return [<strong>异步</strong>, Promise.resolve(<em>内容</em>), 0];
}

const displayNode = <strong>状态</strong>;
export const displayFixtures = [
  <CardHeader title={AsyncDisplay()} badge={<Badge>{AsyncDisplay()}</Badge>} />,
  <ThemeProvider theme={{ text: { emptyState: AsyncDisplay() } }}>
    <EmptyState custom={{ text: { message: AsyncDisplay() } }} />
  </ThemeProvider>,
  <Badge><AsyncDisplay />{Promise.resolve(<i>子节点</i>)}</Badge>,
  <ThemeProvider
    theme={{
      typography: { sizes: { title: 24 }, lineHeight: 1.5 },
      components: { Card: { background: "ivory" } },
      text: { emptyState: <em>空</em> },
    }}
  >
    <Card custom={{ style: { borderRadius: 0 }, text: { title: <b>标题</b> } }}>
      <EmptyState />
    </Card>
  </ThemeProvider>,
  <CardHeader
    title={displayNode}
    subtitle={0}
    badge={
      <Badge>
        <em>在线</em>
      </Badge>
    }
  />,
  <KvTable rows={[{ label: displayNode, value: <b>12</b> }]} />,
  <DualSection
    left={{ title: displayNode, rows: [{ label: "左", value: displayNode }] }}
    right={{ title: "右", rows: [] }}
  />,
  <MetricBlock label={displayNode} value={<em>1 / 2</em>} />,
  <StatChip label={displayNode} value={<b>99</b>} />,
  <QuoteCard
    content={displayNode}
    author={<em>QA</em>}
    reason={<span>已验证</span>}
  />,
  <RadarChart labels={[displayNode, "B", 0]} values={[1, 2, 3]} />,
];
