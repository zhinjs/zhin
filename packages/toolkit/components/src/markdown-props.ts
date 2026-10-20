import type { ComponentProps } from "./theme.js";

/** Markdown source is parser input, rather than an arbitrary JSX display slot. */
export type MarkdownProps = ComponentProps &
  (
    | { readonly source: string; readonly children?: never }
    | { readonly source?: never; readonly children: string }
  );
