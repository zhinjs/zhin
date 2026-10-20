import { jsx, type JSXRenderable } from "@zhin.js/jsx";
import {
  Card,
  CardCanvas,
  DEFAULT_CARD_THEME,
  formatCount,
  StatChip,
} from "@zhin.js/components";

export const CARD_CANVAS = DEFAULT_CARD_THEME.canvas;
export const CARD_THEME = DEFAULT_CARD_THEME;

export { formatCount, StatChip };

export function elevatedCard(inner: JSXRenderable) {
  return jsx(Card, { children: inner });
}

export function cardShell(inner: JSXRenderable, width = 540) {
  return jsx(CardCanvas, { children: inner, width });
}
