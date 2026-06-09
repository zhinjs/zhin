import {
  Card,
  CardCanvas,
  DEFAULT_CARD_THEME,
  formatCount,
  h,
  StatChip,
} from "@zhin.js/satori";

export const CARD_CANVAS = DEFAULT_CARD_THEME.canvas;
export const CARD_THEME = DEFAULT_CARD_THEME;

export { formatCount, StatChip };

export function elevatedCard(inner: string): string {
  return h(Card, { children: inner });
}

export function cardShell(inner: string, width = 540): string {
  return h(CardCanvas, { children: inner, width });
}
