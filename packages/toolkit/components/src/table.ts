import { jsx, type JSXElement } from "@zhin.js/jsx";
import { cssLength, customizeRoot, themedColumn } from "./styles.js";
import { displayProps, themeOf } from "./theme.js";
import type {
  TableProps,
  TableRowProps,
  TableCellProps,
} from "./table-props.js";

/** A display table built from Flex rows, shared by browser and SVG rendering. */
export function Table(props: TableProps): JSXElement {
  const theme = themeOf(props);
  const { caption, headers, rows, children } = displayProps(props);
  const hasHeaders = Boolean(headers?.length);
  const palette = theme.palette;
  const content = [
    caption != null
      ? jsx("div", {
          role: "caption",
          style: {
            display: "flex",
            padding: `${theme.spacing.sm * theme.spacing.scale}px ${
              theme.spacing.md * theme.spacing.scale
            }px`,
            color: palette.textMuted,
            fontSize: theme.typography.sizes.small,
          },
          children: caption,
        })
      : null,
    hasHeaders
      ? jsx(TableRow, {
          header: true,
          separator: caption != null,
          children: headers!.map((value) =>
            jsx(TableCell, { header: true, children: value })
          ),
        })
      : null,
    rows?.map((row, index) =>
      jsx(TableRow, {
        separator: caption != null || hasHeaders || index > 0,
        children: row.map((value) => jsx(TableCell, { children: value })),
      })
    ),
    children,
  ];
  const table = themedColumn(
    theme,
    content,
    `width:100%;margin:${theme.spacing.xs}px 0;background:${
      palette.card
    };border:${cssLength(theme.border.width)} ${theme.border.style} ${
      palette.border
    };border-radius:${cssLength(theme.radii.surface)};overflow:hidden;color:${
      palette.textSecondary
    }`
  );
  return customizeRoot(
    jsx(table.type, { ...table.props, role: "table" }),
    props,
    theme,
    "Table"
  );
}

export function TableRow(props: TableRowProps): JSXElement {
  const theme = themeOf(props);
  const { children, header = false, separator = true } = displayProps(props);
  const palette = theme.palette;
  const border = separator
    ? `${cssLength(theme.border.width)} ${theme.border.style} ${
        palette.divider
      }`
    : "0";
  return customizeRoot(
    jsx("div", {
      role: "row",
      style: {
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        width: "100%",
        minWidth: 0,
        margin: 0,
        gap: 0,
        borderTop: border,
        background: header ? palette.surface : palette.card,
        color: header ? palette.text : palette.textSecondary,
        fontWeight: header
          ? theme.typography.weights.strong
          : theme.typography.weights.normal,
      },
      children,
    }),
    props,
    theme,
    "TableRow"
  );
}

export function TableCell(props: TableCellProps): JSXElement {
  const theme = themeOf(props);
  const {
    children,
    header = false,
    width,
    align = "left",
  } = displayProps(props);
  return customizeRoot(
    jsx("div", {
      role: header ? "columnheader" : "cell",
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems:
          align === "center"
            ? "center"
            : align === "right"
            ? "flex-end"
            : "flex-start",
        flex: width === undefined ? 1 : "none",
        ...(width === undefined ? {} : { width }),
        minWidth: 0,
        boxSizing: "border-box",
        margin: 0,
        padding: `${theme.spacing.sm * theme.spacing.scale}px ${
          theme.spacing.md * theme.spacing.scale
        }px`,
        textAlign: align,
        ...(header ? { fontWeight: theme.typography.weights.strong } : {}),
      },
      children,
    }),
    props,
    theme,
    "TableCell"
  );
}
