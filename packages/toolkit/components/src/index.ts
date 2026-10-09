export { DEFAULT_CARD_THEME, DEFAULT_THEME, ThemeProvider } from "./theme.js";
export type {
  ComponentName,
  ComponentTheme,
  ThemeOverrides,
  ComponentProps,
  ComponentCustomization,
  DisplayOverrides,
  ThemeProviderProps,
} from "./theme.js";
export type * from "./props.js";
export * from "./layout.js";
export * from "./display.js";
export * from "./charts.js";
export {
  LABEL_W,
  LABEL_W_HALF,
  formatCount,
  barTone,
  tint,
} from "./utilities.js";

import { jsx, type JSXElement, type JSXRenderable } from "@zhin.js/jsx";
import { Card, CardCanvas } from "./layout.js";
import type { CardCanvasProps } from "./props.js";

export function composeCard(
  children: JSXRenderable,
  canvas?: Omit<Partial<CardCanvasProps>, "children">
): JSXElement {
  return jsx(CardCanvas, { ...canvas, children: jsx(Card, { children }) });
}
