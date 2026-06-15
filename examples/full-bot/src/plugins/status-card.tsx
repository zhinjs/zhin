/** @jsxImportSource @zhin.js/satori */
import {
  Card,
  CardHeader,
  Row,
  StatChip,
  wrapCardHtml,
  DEFAULT_CARD_THEME,
} from '@zhin.js/satori';

export interface StatusCardLine {
  label: string;
  value: string;
}

export function buildStatusCard(title: string, lines: StatusCardLine[]): string {
  const body = (
    <Card>
      <CardHeader title={title} meta="full-bot · L4" />
      <Row gap={10}>
        {lines.map((line) => (
          <StatChip
            key={line.label}
            label={line.label}
            value={line.value}
            accent={DEFAULT_CARD_THEME.accentMem}
          />
        ))}
      </Row>
    </Card>
  );
  return wrapCardHtml(body, DEFAULT_CARD_THEME.canvas);
}
