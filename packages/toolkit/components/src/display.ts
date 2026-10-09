import { jsx, type JSXRenderable, type JSXElement } from "@zhin.js/jsx";
import { themeOf, displayProps } from "./theme.js";
import {
  cssLength,
  customizeRoot,
  themedDiv,
  themedColumn,
  themedLabel,
} from "./styles.js";
import type {
  KvRowProps,
  KvTableProps,
  UsageBarProps,
  MetricBlockProps,
  StatChipProps,
  BarRowProps,
  TopicItemProps,
  QuoteCardProps,
  ProfileRowProps,
  BadgeProps,
  EmptyStateProps,
} from "./props.js";
import { Surface, Row } from "./layout.js";
import { barTone, rankAccent } from "./utilities.js";

export function KvRow(props: KvRowProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const {
    label,
    value,
    labelWidth = theme.layout.labelWidth,
    bold = false,
  } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);
  const labelCell = (label: JSXRenderable, width: number) =>
    themedLabel(theme, label, width);

  return customizeRoot(
    div(
      `display:flex;flex-direction:row;align-items:center;gap:${theme.spacing.sm}px;margin:${theme.spacing.xs}px 0`,
      [
        labelCell(label, labelWidth),
        div(
          `display:flex;flex:1;min-width:0;color:${
            bold ? T.text : T.textSecondary
          };font-size:${theme.typography.sizes.body}px;line-height:${
            theme.typography.lineHeight
          };font-weight:${
            bold
              ? theme.typography.weights.strong
              : theme.typography.weights.normal
          }`,
          value
        ),
      ]
    ),
    props,
    theme,
    "KvRow"
  );
}

export function KvTable(props: KvTableProps): JSXElement {
  const theme = themeOf(props);
  const { rows, labelWidth = theme.layout.labelWidth } = displayProps(props);
  const column = (children: JSXRenderable, style = "") =>
    themedColumn(theme, children, style);

  return customizeRoot(
    column(rows.map((row) => jsx(KvRow, { ...row, labelWidth }))),
    props,
    theme,
    "KvTable"
  );
}

export function UsageBar(props: UsageBarProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const {
    percent,
    accent = T.accentMem,
    showLabel = true,
    label,
  } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);
  const column = (children: JSXRenderable, style = "") =>
    themedColumn(theme, children, style);

  const p = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent!)) : 0;
  const labelText =
    label !== undefined
      ? label
      : !Number.isFinite(percent)
      ? theme.text.unavailable
      : `${percent!.toFixed(1)}%`;
  return customizeRoot(
    div(
      `display:flex;flex-direction:row;align-items:center;gap:${theme.spacing.sm}px;width:100%`,
      [
        column(
          div(
            `width:${p}%;height:100%;background:${barTone(
              p,
              accent,
              T
            )};border-radius:${cssLength(theme.radii.chart)}`
          ),
          `flex:1;min-width:0;height:${
            theme.layout.progressHeight
          }px;background:${T.barTrack};border-radius:${cssLength(
            theme.radii.bar
          )};overflow:hidden;border:${cssLength(theme.border.width)} ${
            theme.border.style
          } ${T.border}`
        ),
        showLabel
          ? div(
              `display:flex;color:${T.textMuted};font-size:${theme.typography.sizes.small}px;width:42px;text-align:right;flex-shrink:0`,
              labelText
            )
          : null,
      ]
    ),
    props,
    theme,
    "UsageBar"
  );
}

export function MetricBlock(props: MetricBlockProps): JSXRenderable {
  const theme = themeOf(props);
  const T = theme.palette;
  const {
    label,
    value,
    percent,
    accent = T.accentMem,
    labelWidth = theme.layout.labelWidth,
  } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);
  const column = (children: JSXRenderable, style = "") =>
    themedColumn(theme, children, style);
  const labelCell = (label: JSXRenderable, width: number) =>
    themedLabel(theme, label, width);

  if (value == null && !Number.isFinite(percent))
    return customizeRoot(null, props, theme, "MetricBlock");
  return customizeRoot(
    div(
      `display:flex;flex-direction:row;align-items:center;gap:${theme.spacing.sm}px;margin:${theme.spacing.xs}px 0`,
      [
        labelCell(label, labelWidth),
        column(
          [
            value != null
              ? div(
                  `color:${T.textSecondary};font-size:${theme.typography.sizes.body}px;line-height:${theme.typography.lineHeight};font-weight:${theme.typography.weights.strong};white-space:nowrap`,
                  value
                )
              : null,
            Number.isFinite(percent)
              ? jsx(UsageBar, { percent, accent })
              : null,
          ],
          `flex:1;min-width:0;gap:${theme.spacing.xs}px`
        ),
      ]
    ),
    props,
    theme,
    "MetricBlock"
  );
}

export function StatChip(props: StatChipProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const { label, value, accent = T.accentMem } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);

  return customizeRoot(
    jsx(Surface, {
      shadow: "md",
      padding: `${theme.spacing.md}px ${theme.spacing.lg}px`,
      style: `flex:1;gap:${theme.spacing.sm}px`,
      children: [
        div(
          `color:${T.textMuted};font-size:${theme.typography.sizes.caption}px;font-weight:${theme.typography.weights.strong};letter-spacing:0.06em;text-transform:uppercase`,
          label
        ),
        div(
          `color:${accent};font-size:${theme.typography.sizes.metric}px;font-weight:${theme.typography.weights.heading};line-height:${theme.typography.lineHeight};letter-spacing:-0.02em`,
          value
        ),
      ],
    }),
    props,
    theme,
    "StatChip"
  );
}

export function BarRow(props: BarRowProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const { rank, label, value, percent, accent } = displayProps(props);

  return customizeRoot(
    jsx(MetricBlock, {
      label: rank != null ? [rank, theme.text.rankSeparator, label] : label,
      value,
      percent,
      accent: rank != null ? rankAccent(rank, T) : accent ?? T.accentMem,
    }),
    props,
    theme,
    "BarRow"
  );
}

export function TopicItem(props: TopicItemProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const { index, title, summary } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);
  const column = (children: JSXRenderable, style = "") =>
    themedColumn(theme, children, style);

  return customizeRoot(
    jsx(Row, {
      gap: theme.spacing.md,
      align: "flex-start",
      children: [
        div(
          `display:flex;width:22px;min-width:22px;color:${T.textMuted};font-size:${theme.typography.sizes.body}px;line-height:${theme.typography.lineHeight};text-align:right;flex-shrink:0`,
          index
        ),
        column(
          [
            div(
              `font-size:${theme.typography.sizes.body}px;font-weight:${theme.typography.weights.strong};color:${T.text};line-height:${theme.typography.lineHeight}`,
              title
            ),
            summary != null
              ? div(
                  `font-size:${theme.typography.sizes.small}px;color:${T.textMuted};line-height:${theme.typography.lineHeight}`,
                  summary
                )
              : null,
          ],
          `flex:1;min-width:0;gap:${theme.spacing.xs}px`
        ),
      ],
    }),
    props,
    theme,
    "TopicItem"
  );
}

export function QuoteCard(props: QuoteCardProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const { index, content, author, reason } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);

  return customizeRoot(
    jsx(Surface, {
      padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
      style: `gap:${theme.spacing.xs}px`,
      children: [
        index != null
          ? div(
              `font-size:${theme.typography.sizes.small}px;color:${T.textMuted}`,
              [theme.text.indexPrefix, index]
            )
          : null,
        div(
          `font-size:${theme.typography.sizes.body}px;font-weight:${theme.typography.weights.strong};color:${T.text};line-height:${theme.typography.lineHeight}`,
          [theme.text.quoteOpen, content, theme.text.quoteClose]
        ),
        div(
          `font-size:${theme.typography.sizes.small}px;color:${T.textSecondary}`,
          [author, reason != null ? [theme.text.reasonSeparator, reason] : null]
        ),
      ],
    }),
    props,
    theme,
    "QuoteCard"
  );
}

export function ProfileRow(props: ProfileRowProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const { index, name, badge, reason } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);
  const column = (children: JSXRenderable, style = "") =>
    themedColumn(theme, children, style);

  return customizeRoot(
    jsx(Row, {
      gap: theme.spacing.md,
      align: "center",
      children: [
        index != null
          ? div(
              `display:flex;width:28px;min-width:28px;color:${T.textMuted};font-size:${theme.typography.sizes.body}px;line-height:${theme.typography.lineHeight};text-align:right;flex-shrink:0`,
              index
            )
          : null,
        column(
          [
            jsx(Row, {
              gap: theme.spacing.sm,
              align: "center",
              wrap: true,
              children: [
                div(
                  `font-size:${theme.typography.sizes.body}px;font-weight:${theme.typography.weights.strong};color:${T.text}`,
                  name
                ),
                badge != null
                  ? div(
                      `font-size:${theme.typography.sizes.caption}px;font-weight:${theme.typography.weights.strong};color:${T.accentSwap}`,
                      badge
                    )
                  : null,
              ],
            }),
            reason != null
              ? div(
                  `font-size:${theme.typography.sizes.small}px;color:${T.textMuted}`,
                  reason
                )
              : null,
          ],
          `flex:1;min-width:0;gap:${theme.spacing.xs}px`
        ),
      ],
    }),
    props,
    theme,
    "ProfileRow"
  );
}

export function Badge(props: BadgeProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const { text, children, accent = T.accentSwap } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);

  return customizeRoot(
    div(
      `display:flex;font-size:${theme.typography.sizes.caption}px;font-weight:${theme.typography.weights.strong};color:${accent}`,
      text === undefined ? children : text
    ),
    props,
    theme,
    "Badge"
  );
}

export function EmptyState(props: EmptyStateProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const { message = theme.text.emptyState } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);

  return customizeRoot(
    jsx(Surface, {
      padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
      children: div(
        `color:${T.textSecondary};font-size:${theme.typography.sizes.small}px;line-height:${theme.typography.lineHeight}`,
        message
      ),
    }),
    props,
    theme,
    "EmptyState"
  );
}
