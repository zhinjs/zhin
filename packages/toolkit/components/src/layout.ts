import { jsx, type JSXRenderable, type JSXElement } from "@zhin.js/jsx";
import { themeOf, displayProps } from "./theme.js";
import { cssLength, customizeRoot, themedDiv, themedColumn } from "./styles.js";
import type {
  CardCanvasProps,
  CardProps,
  SurfaceProps,
  CardHeaderProps,
  RowProps,
  ColProps,
  DividerProps,
  SectionProps,
  DualSectionProps,
} from "./props.js";
import { KvTable } from "./display.js";

export function CardCanvas(props: CardCanvasProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const {
    children,
    width = theme.layout.cardWidth,
    backgroundColor = T.canvas,
    padding = theme.spacing.canvasPadding ?? `${theme.spacing.lg}px`,
  } = displayProps(props);
  const column = (children: JSXRenderable, style = "") =>
    themedColumn(theme, children, style);

  return customizeRoot(
    column(
      children,
      `width:${width}px;padding:${padding};background:${backgroundColor};font-family:${theme.typography.fontFamily}`
    ),
    props,
    theme,
    "CardCanvas"
  );
}

export function Card(props: CardProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const { children } = displayProps(props);
  const column = (children: JSXRenderable, style = "") =>
    themedColumn(theme, children, style);

  return customizeRoot(
    column(
      children,
      `width:100%;padding:${
        theme.spacing.cardPadding ?? `${theme.spacing.xl}px`
      };background:${T.card};border:${cssLength(theme.border.width)} ${
        theme.border.style
      } ${T.border};border-radius:${cssLength(theme.radii.card)};box-shadow:${
        T.shadowLg
      };color:${T.textSecondary};font-family:${theme.typography.fontFamily}`
    ),
    props,
    theme,
    "Card"
  );
}

export function Surface(props: SurfaceProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const {
    children,
    shadow = "sm",
    padding = `${theme.spacing.sm}px ${theme.spacing.md}px`,
    style = "",
  } = displayProps(props);
  const column = (children: JSXRenderable, style = "") =>
    themedColumn(theme, children, style);

  return customizeRoot(
    column(
      children,
      `background:${T.surface};border:${cssLength(theme.border.width)} ${
        theme.border.style
      } ${T.border};border-radius:${cssLength(
        theme.radii.surface
      )};box-shadow:${shadow === "md" ? T.shadowMd : T.shadowSm};${
        padding ? `padding:${padding};` : ""
      }${style}`
    ),
    props,
    theme,
    "Surface"
  );
}

export function CardHeader(props: CardHeaderProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const { title, subtitle, badge } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);
  const column = (children: JSXRenderable, style = "") =>
    themedColumn(theme, children, style);

  const heading = column(
    [
      div(
        `font-size:${theme.typography.sizes.title}px;font-weight:${theme.typography.weights.heading};color:${T.text};letter-spacing:-0.03em`,
        title
      ),
      subtitle != null
        ? div(
            `font-size:${theme.typography.sizes.small}px;color:${T.textMuted};letter-spacing:0.02em`,
            subtitle
          )
        : null,
    ],
    `flex:1;min-width:0;gap:${theme.spacing.xs}px`
  );
  return customizeRoot(
    badge != null
      ? div(
          `display:flex;flex-direction:row;align-items:center;justify-content:space-between;margin:${theme.spacing.sm}px 0;gap:${theme.spacing.md}px`,
          [
            heading,
            jsx(Surface, {
              padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
              children: div(
                `color:${T.textSecondary};font-size:${theme.typography.sizes.body}px;font-weight:${theme.typography.weights.strong}`,
                badge
              ),
            }),
          ]
        )
      : column(heading, `margin:${theme.spacing.sm}px 0`),
    props,
    theme,
    "CardHeader"
  );
}

export function Row(props: RowProps): JSXElement {
  const theme = themeOf(props);
  const {
    children,
    gap = theme.spacing.rowGap,
    align = "stretch",
    justify = "flex-start",
    wrap = false,
    style = "",
  } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);

  return customizeRoot(
    div(
      `display:flex;flex-direction:row;gap:${gap}px;align-items:${align};justify-content:${justify};flex-wrap:${
        wrap ? "wrap" : "nowrap"
      };${style}`,
      children
    ),
    props,
    theme,
    "Row"
  );
}

export function Col(props: ColProps): JSXElement {
  const theme = themeOf(props);
  const {
    children,
    gap = theme.spacing.rowGap,
    align = "stretch",
    style = "",
  } = displayProps(props);
  const column = (children: JSXRenderable, style = "") =>
    themedColumn(theme, children, style);

  return customizeRoot(
    column(children, `gap:${gap}px;align-items:${align};${style}`),
    props,
    theme,
    "Col"
  );
}

export function Divider(props: DividerProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const { margin = `${theme.spacing.lg}px 0` } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);

  return customizeRoot(
    div(
      `display:flex;height:${cssLength(theme.border.width)};background:${
        T.divider
      };margin:${margin}`
    ),
    props,
    theme,
    "Divider"
  );
}

export function Section(props: SectionProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const { title, children } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);
  const column = (children: JSXRenderable, style = "") =>
    themedColumn(theme, children, style);

  return customizeRoot(
    column(
      [
        div(
          `color:${T.textMuted};font-size:${theme.typography.sizes.caption}px;font-weight:${theme.typography.weights.strong};letter-spacing:0.1em;text-transform:uppercase;margin:${theme.spacing.xs}px 0`,
          title
        ),
        column(
          children,
          `margin:${theme.spacing.sectionGap ?? theme.spacing.xs}px 0`
        ),
      ],
      `padding:${theme.spacing.lg}px 0;margin:${
        theme.spacing.sm
      }px 0;border-top:${cssLength(theme.border.width)} ${theme.border.style} ${
        T.divider
      }`
    ),
    props,
    theme,
    "Section"
  );
}

export function DualSection(props: DualSectionProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const { left, right } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);
  const column = (children: JSXRenderable, style = "") =>
    themedColumn(theme, children, style);

  return customizeRoot(
    column(
      [
        jsx(Row, {
          gap: theme.spacing.xl,
          style: `margin:${theme.spacing.xs}px 0`,
          children: [left, right].map((side) =>
            div(
              `display:flex;flex:1;min-width:0;color:${T.textMuted};font-size:${theme.typography.sizes.caption}px;font-weight:${theme.typography.weights.strong};letter-spacing:0.1em;text-transform:uppercase;line-height:${theme.typography.lineHeight}`,
              side.title
            )
          ),
        }),
        jsx(Row, {
          gap: theme.spacing.xl,
          align: "flex-start",
          style: `margin:${theme.spacing.xs}px 0`,
          children: [left, right].map((side) =>
            column(
              jsx(KvTable, {
                rows: side.rows,
                labelWidth: theme.layout.compactLabelWidth,
              }),
              "flex:1;min-width:0"
            )
          ),
        }),
      ],
      `padding:${theme.spacing.lg}px 0;margin:${
        theme.spacing.sm
      }px 0;border-top:${cssLength(theme.border.width)} ${theme.border.style} ${
        T.divider
      }`
    ),
    props,
    theme,
    "DualSection"
  );
}
