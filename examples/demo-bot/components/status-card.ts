import { defineComponent } from '@zhin.js/component';
import { raw } from '@zhin.js/core/runtime';
import {
  Card,
  CardHeader,
  Row,
  StatChip,
  h,
  wrapCardHtml,
  DEFAULT_CARD_THEME,
} from '@zhin.js/satori';

interface StatusCardProps {
  readonly title: string;
  readonly lines: readonly { readonly label: string; readonly value: string }[];
}

export default defineComponent<StatusCardProps>({
  render({ title, lines }) {
    const body = h(Card, {
      children: [
        h(CardHeader, { title, meta: 'Zhin.js Demo' }),
        h(Row, {
          gap: 10,
          children: lines.map((line) => h(StatChip, {
            label: line.label,
            value: line.value,
            accent: DEFAULT_CARD_THEME.accentMem,
          })),
        }),
      ],
    });
    return raw({
      type: 'html',
      data: { html: wrapCardHtml(body, DEFAULT_CARD_THEME.canvas), width: 540 },
    });
  },
});
