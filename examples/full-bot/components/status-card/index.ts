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
  previewProps: {
    title: "Full Bot 服务状态",
    lines: [
      { label: "RSS", value: "58MB" },
      { label: "分档", value: "L4" },
      { label: "任务", value: 2 },
    ],
  },
  render({ title = "服务状态", lines = [] }) {
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
    return jsx('html', { children: jsx(CardCanvas, { children: body }) });
  },
});
