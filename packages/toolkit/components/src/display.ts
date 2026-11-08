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
  CalloutProps,
  TimelineProps,
  TimelineItemProps,
  StepTrackerProps,
  StatusGridProps,
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
      style: `margin:${theme.spacing.xs}px 0`,
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
      style: `gap:${theme.spacing.xs}px;margin:${theme.spacing.xs}px 0`,
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
      style: `margin:${theme.spacing.xs}px 0`,
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
      style: `margin:${theme.spacing.xs}px 0`,
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

export function Callout(props: CalloutProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const {
    title,
    message,
    children,
    tone = "info",
    accent,
  } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);
  const column = (children: JSXRenderable, style = "") =>
    themedColumn(theme, children, style);

  const resolvedAccent =
    accent ??
    (tone === "danger"
      ? T.barCrit
      : tone === "warning"
      ? T.barWarn
      : tone === "success"
      ? T.accentCpu
      : T.accentMem);
  const body = message === undefined ? children : message;

  return customizeRoot(
    jsx(Surface, {
      padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
      style: `margin:${theme.spacing.xs}px 0;border:2px solid ${resolvedAccent}`,
      children: column(
        [
          title != null
            ? div(
                `font-size:${theme.typography.sizes.body}px;font-weight:${theme.typography.weights.strong};color:${resolvedAccent}`,
                title
              )
            : null,
          body != null
            ? div(
                `font-size:${theme.typography.sizes.small}px;color:${T.textSecondary};line-height:${theme.typography.lineHeight}`,
                body
              )
            : null,
        ],
        `gap:${theme.spacing.xs}px`
      ),
    }),
    props,
    theme,
    "Callout"
  );
}

export function TimelineItem(props: TimelineItemProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const {
    title,
    description,
    time,
    badge,
    accent = T.accentMem,
  } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);
  const column = (children: JSXRenderable, style = "") =>
    themedColumn(theme, children, style);

  return customizeRoot(
    jsx(Row, {
      align: "flex-start",
      gap: theme.spacing.sm,
      style: `margin:${theme.spacing.xs}px 0`,
      children: [
        div(
          `width:${theme.spacing.sm}px;height:${theme.spacing.sm}px;border-radius:50%;background:${accent};margin:${theme.spacing.xs}px 0;flex-shrink:0`
        ),
        column(
          [
            jsx(Row, {
              justify: "space-between",
              align: "center",
              gap: theme.spacing.sm,
              children: [
                jsx(Row, {
                  align: "center",
                  gap: theme.spacing.sm,
                  children: [
                    div(
                      `font-size:${theme.typography.sizes.body}px;font-weight:${theme.typography.weights.strong};color:${T.text}`,
                      title
                    ),
                    badge != null
                      ? div(
                          `font-size:${theme.typography.sizes.caption}px;font-weight:${theme.typography.weights.strong};color:${accent}`,
                          badge
                        )
                      : null,
                  ],
                }),
                time != null
                  ? div(
                      `font-size:${theme.typography.sizes.caption}px;color:${T.textMuted}`,
                      time
                    )
                  : null,
              ],
            }),
            description != null
              ? div(
                  `font-size:${theme.typography.sizes.small}px;color:${T.textSecondary};line-height:${theme.typography.lineHeight}`,
                  description
                )
              : null,
          ],
          `flex:1;min-width:0;gap:${theme.spacing.xs}px`
        ),
      ],
    }),
    props,
    theme,
    "TimelineItem"
  );
}

export function Timeline(props: TimelineProps): JSXElement {
  const theme = themeOf(props);
  const { items, children } = displayProps(props);
  const column = (children: JSXRenderable, style = "") =>
    themedColumn(theme, children, style);

  return customizeRoot(
    column([
      items?.map((item) => jsx(TimelineItem, { ...item })),
      children,
    ]),
    props,
    theme,
    "Timeline"
  );
}

export function StepTracker(props: StepTrackerProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const { steps, current = 0, accent = T.accentMem } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);
  const column = (children: JSXRenderable, style = "") =>
    themedColumn(theme, children, style);

  return customizeRoot(
    jsx(Row, {
      align: "flex-start",
      gap: theme.spacing.sm,
      style: `margin:${theme.spacing.xs}px 0`,
      children: steps.map((step, idx) => {
        const status =
          step.status ??
          (idx < current ? "done" : idx === current ? "active" : "pending");
        const color =
          status === "done"
            ? T.accentCpu
            : status === "active"
            ? accent
            : T.textMuted;
        return column(
          [
            div(
              `width:100%;height:${theme.spacing.xs}px;border-radius:${cssLength(theme.radii.bar)};background:${
                status === "pending" ? T.barTrack : color
              }`
            ),
            div(
              `font-size:${theme.typography.sizes.small}px;font-weight:${
                status === "pending"
                  ? theme.typography.weights.normal
                  : theme.typography.weights.strong
              };color:${status === "pending" ? T.textMuted : T.text}`,
              step.label
            ),
            step.subtitle != null
              ? div(
                  `font-size:${theme.typography.sizes.tiny}px;color:${T.textMuted}`,
                  step.subtitle
                )
              : null,
          ],
          `flex:1;min-width:0;gap:${theme.spacing.xs}px`
        );
      }),
    }),
    props,
    theme,
    "StepTracker"
  );
}

export function StatusGrid(props: StatusGridProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const { items, columns = 2 } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);

  const cells = items.map((item) => {
    const dotColor =
      item.accent ??
      (item.status === "ok"
        ? T.accentCpu
        : item.status === "warn"
        ? T.barWarn
        : item.status === "crit"
        ? T.barCrit
        : T.textMuted);
    return jsx(Surface, {
      padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
      children: jsx(Row, {
        justify: "space-between",
        align: "center",
        gap: theme.spacing.sm,
        children: [
          jsx(Row, {
            align: "center",
            gap: theme.spacing.sm,
            children: [
              div(
                `width:${theme.spacing.sm}px;height:${theme.spacing.sm}px;border-radius:50%;background:${dotColor};flex-shrink:0`
              ),
              div(
                `font-size:${theme.typography.sizes.small}px;color:${T.textSecondary}`,
                item.label
              ),
            ],
          }),
          div(
            `font-size:${theme.typography.sizes.body}px;font-weight:${theme.typography.weights.strong};color:${T.text}`,
            item.value
          ),
        ],
      }),
    });
  });

  return customizeRoot(
    div(
      `display:grid;grid-template-columns:repeat(${Math.max(1, columns)}, minmax(0, 1fr));gap:${theme.spacing.sm}px;margin:${theme.spacing.xs}px 0`,
      cells
    ),
    props,
    theme,
    "StatusGrid"
  );
}
