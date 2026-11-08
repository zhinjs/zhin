import type { JSXRenderable } from "@zhin.js/jsx";
import type { ComponentProps } from "./theme.js";

/** Convenience data and composable rows can be used together, in that order. */
export interface TableProps extends ComponentProps {
  readonly caption?: JSXRenderable;
  readonly headers?: readonly JSXRenderable[];
  readonly rows?: readonly (readonly JSXRenderable[])[];
  readonly children?: JSXRenderable;
}

export interface TableRowProps extends ComponentProps {
  readonly children?: JSXRenderable;
  readonly header?: boolean;
  /** Highlight row as selected in batch operations. */
  readonly selected?: boolean;
  /** Disable for the first composed row when it follows the table's outer border. */
  readonly separator?: boolean;
}

export interface TableCellProps extends ComponentProps {
  readonly children?: JSXRenderable;
  readonly icon?: JSXRenderable;
  readonly header?: boolean;
  /** Pin cell to the left or right edge with sticky positioning and separator border. */
  readonly fixed?: "left" | "right";
  /** Unspecified cells share available width equally. */
  readonly width?: number | string;
  readonly align?: "left" | "center" | "right";
}
