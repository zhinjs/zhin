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
  readonly lines: readonly {
    readonly label: string;
    readonly value: string;
  }[];
}

/** 对齐 minimal-bot status-card；供 /zt 使用。 */
export default defineComponent<StatusCardProps>({
  render({ title, lines }) {
    // 一行最多 3 个 StatChip（24px 值文本），多了换行，避免挤压裁切。
    const rows: ReturnType<typeof h>[] = [];
    for (let i = 0; i < lines.length; i += 3) {
      rows.push(h(Row, {
        gap: 10,
        children: lines.slice(i, i + 3).map((line) => h(StatChip, {
          label: line.label,
          value: line.value,
          accent: DEFAULT_CARD_THEME.accentMem,
        })),
      }));
    }
    const body = h(Card, {
      children: [
        h(CardHeader, { title, meta: 'test-bot' }),
        ...rows,
      ],
    });
    return raw({
      type: 'html',
      data: {
        html: wrapCardHtml(body, DEFAULT_CARD_THEME.canvas),
        width: 540,
      },
    });
  },
});
