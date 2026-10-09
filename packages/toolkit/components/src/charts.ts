import { jsx, type JSXRenderable, type JSXElement } from "@zhin.js/jsx";
import { themeOf, displayProps } from "./theme.js";
import { cssLength, customizeRoot, themedDiv, themedColumn } from "./styles.js";
import type {
  BarChartProps,
  RadarChartProps,
  SparklineProps,
} from "./props.js";
import { Row } from "./layout.js";
import { formatCount, tint } from "./utilities.js";

export function BarChart(props: BarChartProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const {
    values,
    peakIndex,
    height = theme.layout.barChartHeight,
    accent = T.accentMem,
    peakAccent = T.barWarn,
    tickLabels = theme.text.chartTicks,
    showPeakValue = false,
  } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);
  const column = (children: JSXRenderable, style = "") =>
    themedColumn(theme, children, style);

  const max = Math.max(...values, 1);
  const bars = values.map((count, i) => {
    const peak = i === peakIndex && count > 0;
    return column(
      [
        peak && showPeakValue
          ? div(
              `font-size:${theme.typography.sizes.tiny}px;font-weight:${theme.typography.weights.strong};color:${peakAccent};margin:${theme.spacing.xs}px 0`,
              formatCount(count)
            )
          : null,
        div(
          `width:100%;height:${Math.max(
            4,
            Math.round((count / max) * 100)
          )}%;min-height:${count > 0 ? 4 : 2}px;background:${
            peak ? peakAccent : accent
          };opacity:${
            count > 0 ? (peak ? 1 : 0.55) : 0.2
          };border-radius:${cssLength(theme.radii.chart)}`
        ),
      ],
      "flex:1;align-items:center;justify-content:flex-end;min-width:0;height:100%"
    );
  });
  return customizeRoot(
    column([
      jsx(Row, {
        align: "flex-end",
        gap: theme.spacing.xs,
        style: `height:${height}px`,
        children: bars,
      }),
      jsx(Row, {
        justify: "space-between",
        style: `margin:${theme.spacing.xs}px 0`,
        children: tickLabels.map((label) =>
          div(
            `font-size:${theme.typography.sizes.tiny}px;color:${T.textMuted}`,
            label
          )
        ),
      }),
    ]),
    props,
    theme,
    "BarChart"
  );
}

export function RadarChart(props: RadarChartProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const {
    labels,
    values,
    max,
    size = theme.layout.radarSize,
    accent = T.accentMem,
    fill,
  } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);
  const column = (children: JSXRenderable, style = "") =>
    themedColumn(theme, children, style);

  const n = Math.min(labels.length, values.length),
    peak = max != null && max > 0 ? max : Math.max(...values.slice(0, n), 1);
  const cx = size / 2,
    cy = size / 2,
    radius = size * 0.38;
  const rings = [0.25, 0.5, 0.75, 1].map((r) =>
    jsx("circle", {
      cx,
      cy,
      r: radius * r,
      fill: "none",
      stroke: T.divider,
      strokeWidth: 1,
    })
  );
  const points: string[] = [],
    spokes: JSXRenderable[] = [],
    names: JSXRenderable[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2,
      ratio = Math.min(1, Math.max(0, (values[i] || 0) / peak));
    points.push(
      `${cx + Math.cos(angle) * radius * ratio},${
        cy + Math.sin(angle) * radius * ratio
      }`
    );
    spokes.push(
      jsx("line", {
        x1: cx,
        y1: cy,
        x2: cx + Math.cos(angle) * radius,
        y2: cy + Math.sin(angle) * radius,
        stroke: T.divider,
        strokeWidth: 1,
      })
    );
    names.push(
      div(
        `position:absolute;left:${cx + Math.cos(angle) * (radius + 16)}px;top:${
          cy + Math.sin(angle) * (radius + 16)
        }px;transform:translate(-50%,-50%);font-size:${
          theme.typography.sizes.tiny
        }px;color:${T.textMuted};white-space:nowrap`,
        labels[i]
      )
    );
  }
  return customizeRoot(
    column(
      div(`display:flex;position:relative;width:${size}px;height:${size}px`, [
        jsx("svg", {
          width: size,
          height: size,
          viewBox: `0 0 ${size} ${size}`,
          children: [
            rings,
            spokes,
            n >= 3
              ? jsx("polygon", {
                  points: points.join(" "),
                  fill: fill ?? tint(accent, 0.25),
                  stroke: accent,
                  strokeWidth: 2,
                })
              : null,
          ],
        }),
        names,
      ]),
      "align-items:center;width:100%"
    ),
    props,
    theme,
    "RadarChart"
  );
}

export function Sparkline(props: SparklineProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const {
    values,
    width = theme.layout.sparklineWidth,
    height = theme.layout.sparklineHeight,
    accent = T.accentMem,
  } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);
  const column = (children: JSXRenderable, style = "") =>
    themedColumn(theme, children, style);

  if (values.length < 2)
    return customizeRoot(
      div(`display:flex;width:${width}px;height:${height}px`),
      props,
      theme,
      "Sparkline"
    );
  const max = Math.max(...values, 1),
    pad = 2,
    innerW = width - 4,
    innerH = height - 4;
  const pts = values
    .map(
      (v, i) =>
        `${pad + (i / (values.length - 1)) * innerW},${
          pad + innerH - (v / max) * innerH
        }`
    )
    .join(" ");
  return customizeRoot(
    column(
      jsx("svg", {
        width,
        height,
        viewBox: `0 0 ${width} ${height}`,
        children: [
          jsx("polyline", {
            points: pts,
            fill: "none",
            stroke: accent,
            strokeWidth: 2,
            strokeLinecap: "round",
            strokeLinejoin: "round",
          }),
          jsx("circle", {
            cx: pad + innerW,
            cy: pad + innerH - ((values.at(-1) ?? 0) / max) * innerH,
            r: 3,
            fill: accent,
          }),
        ],
      })
    ),
    props,
    theme,
    "Sparkline"
  );
}
