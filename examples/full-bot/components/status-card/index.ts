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

export default defineComponent<StatusCardProps>({
  render({ title, lines }) {
    const body = jsx(Card, {
      children: [
        jsx(CardHeader, { title, subtitle: "full-bot L4" }),
        jsx(Row, {
          gap: 8,
          children: lines.map((line) =>
            jsx(StatChip, {
              label: line.label,
              value: line.value,
              accent: DEFAULT_CARD_THEME.accentMem,
            })
          ),
        }),
      ],
    });
    return jsx(CardCanvas, { children: body });
  },
});
