import type { JSXRenderable } from "@zhin.js/jsx";
import type { ComponentProps } from "./theme.js";

export interface ListProps extends ComponentProps {
  readonly ordered?: boolean;
  readonly start?: number;
  readonly items?: readonly JSXRenderable[];
  /** Direct ListItem children inherit numbering; nested lists belong inside an item. */
  readonly children?: JSXRenderable;
}

export interface ListItemProps extends ComponentProps {
  readonly children?: JSXRenderable;
  /** null/false hides the marker, e.g. when content already contains a task control. */
  readonly marker?: JSXRenderable;
}
