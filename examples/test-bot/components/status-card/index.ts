import { defineComponent } from "zhin.js/component";
import { jsx, type JSXRenderable } from "zhin.js/jsx";
import {
  CardCanvas,
  Card,
  CardHeader,
  Row,
  StatChip,
  DEFAULT_CARD_THEME,
} from "@zhin.js/components";

interface StatusCardProps {
  readonly title: JSXRenderable;
  readonly lines: readonly {
    readonly label: JSXRenderable;
    readonly value: JSXRenderable;
  }[];
}

/** 对齐 minimal-bot status-card；供 /zt 使用。 */
export default defineComponent<StatusCardProps>({
  render({ title, lines }) {
    // 一行最多 3 个 StatChip（24px 值文本），多了换行，避免挤压裁切。
    const rows: ReturnType<typeof jsx>[] = [];
    for (let i = 0; i < lines.length; i += 3) {
      rows.push(
        jsx(Row, {
          gap: 8,
          children: lines.slice(i, i + 3).map((line) =>
            jsx(StatChip, {
              label: line.label,
              value: line.value,
              accent: DEFAULT_CARD_THEME.accentMem,
            })
          ),
        })
      );
    }
    const body = jsx(Card, {
      children: [jsx(CardHeader, { title, subtitle: "test-bot" }), ...rows],
    });
    return jsx(CardCanvas, { children: body });
  },
});
