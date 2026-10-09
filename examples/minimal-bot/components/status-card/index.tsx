import { defineComponent } from 'zhin.js/component';
import type { JSXRenderable } from 'zhin.js/jsx';
import { CardCanvas, Card, CardHeader, Row, StatChip } from '@zhin.js/components';

interface StatusCardProps {
  readonly title: JSXRenderable;
  readonly lines: readonly { readonly label: JSXRenderable; readonly value: JSXRenderable }[];
}

export default defineComponent<StatusCardProps>({
  previewProps: { title: '服务状态', lines: [{ label: 'RSS', value: '42MB' }, { label: '任务', value: 0 }] },
  render({ title, lines }) {
    return (
      <CardCanvas>
        <Card>
          <CardHeader title={title} subtitle="minimal-bot" />
          <Row gap={8}>
            {lines.map((line) => <StatChip label={line.label} value={line.value} />)}
          </Row>
        </Card>
      </CardCanvas>
    );
  },
});
