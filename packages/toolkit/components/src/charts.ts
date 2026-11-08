import { jsx, type JSXRenderable, type JSXElement } from "@zhin.js/jsx";
import { themeOf, displayProps } from "./theme.js";
import { cssLength, customizeRoot, themedDiv, themedColumn } from "./styles.js";
import type {
  BarChartProps,
  ComparisonBarProps,
  DonutChartProps,
  HeatmapGridProps,
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
    images,
    icons,
    backgroundImage,
  } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);
  const column = (children: JSXRenderable, style = "") =>
    themedColumn(theme, children, style);

  const max = Math.max(...values, 1);
  const bars = values.map((count, i) => {
    const peak = i === peakIndex && count > 0;
    const barImg = images?.[i];
    const barIcon = icons?.[i];
    return column(
      [
        barImg
          ? jsx("img", {
              src: barImg,
              alt: "",
              style: `width:16px;height:16px;border-radius:50%;object-fit:cover;margin:${theme.spacing.xs}px 0`,
            })
          : barIcon != null && typeof barIcon !== "boolean"
          ? div(`margin:${theme.spacing.xs}px 0`, barIcon)
          : null,
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
    column(
      [
        backgroundImage
          ? jsx("img", {
              src: backgroundImage,
              alt: "",
              style:
                "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.08;pointer-events:none",
            })
          : null,
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
      ],
      backgroundImage ? "position:relative;overflow:hidden" : ""
    ),
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
    centerImage,
    centerIcon,
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
        centerImage
          ? jsx("img", {
              src: centerImage,
              alt: "",
              style: `position:absolute;left:${cx - 12}px;top:${cy - 12}px;width:24px;height:24px;border-radius:50%;object-fit:cover`,
            })
          : centerIcon != null && typeof centerIcon !== "boolean"
          ? div(
              `position:absolute;left:${cx}px;top:${cy}px;transform:translate(-50%,-50%)`,
              centerIcon
            )
          : null,
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
    endImage,
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
  if (!values.every(Number.isFinite))
    throw new RangeError("Sparkline values must be finite");
  const min = Math.min(...values),
    max = Math.max(...values),
    pad = 2,
    innerW = width - 4,
    innerH = height - 4;
  const y = (value: number): number => min === max
    ? pad + innerH / 2
    : pad + innerH - ((value - min) / (max - min)) * innerH;
  const pts = values
    .map(
      (v, i) =>
        `${pad + (i / (values.length - 1)) * innerW},${y(v)}`
    )
    .join(" ");
  const endX = pad + innerW;
  const endY = y(values.at(-1)!);
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
          endImage
            ? jsx("image", {
                href: endImage,
                x: endX - 6,
                y: endY - 6,
                width: 12,
                height: 12,
              })
            : jsx("circle", {
                cx: endX,
                cy: endY,
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

export function DonutChart(props: DonutChartProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const {
    percent,
    segments,
    size = 96,
    thickness = 10,
    accent = T.accentMem,
    label,
    value,
    centerImage,
    icon,
  } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);
  const column = (children: JSXRenderable, style = "") =>
    themedColumn(theme, children, style);

  const r = Math.max(4, (size - thickness) / 2);
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;

  let arcs: JSXRenderable;
  let centerDisplay: JSXRenderable = value;
  if (segments && segments.length > 0) {
    const total = Math.max(
      segments.reduce((acc, s) => acc + (Number.isFinite(s.value) && s.value > 0 ? s.value : 0), 0),
      1
    );
    let accOffset = 0;
    arcs = segments.map((seg) => {
      const v = Number.isFinite(seg.value) && seg.value > 0 ? seg.value : 0;
      const len = (v / total) * c;
      const dashOffset = -accOffset;
      accOffset += len;
      return jsx("circle", {
        cx,
        cy,
        r,
        fill: "none",
        stroke: seg.color,
        strokeWidth: thickness,
        strokeDasharray: `${len.toFixed(2)} ${(c - len).toFixed(2)}`,
        strokeDashoffset: dashOffset.toFixed(2),
        transform: `rotate(-90 ${cx} ${cy})`,
      });
    });
    if (centerDisplay === undefined) {
      centerDisplay = formatCount(total);
    }
  } else {
    const p = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent!)) : 0;
    const offset = c - (p / 100) * c;
    arcs = jsx("circle", {
      cx,
      cy,
      r,
      fill: "none",
      stroke: accent,
      strokeWidth: thickness,
      strokeDasharray: c.toFixed(2),
      strokeDashoffset: offset.toFixed(2),
      strokeLinecap: "round",
      transform: `rotate(-90 ${cx} ${cy})`,
    });
    if (centerDisplay === undefined) {
      centerDisplay = Number.isFinite(percent) ? `${Math.round(p)}%` : theme.text.unavailable;
    }
  }

  return customizeRoot(
    jsx(Row, {
      align: "center",
      gap: theme.spacing.md,
      style: `margin:${theme.spacing.xs}px 0`,
      children: [
        div(`display:flex;position:relative;width:${size}px;height:${size}px;flex-shrink:0`, [
          jsx("svg", {
            width: size,
            height: size,
            viewBox: `0 0 ${size} ${size}`,
            children: [
              jsx("circle", {
                cx,
                cy,
                r,
                fill: "none",
                stroke: T.barTrack,
                strokeWidth: thickness,
              }),
              arcs,
            ],
          }),
          column(
            [
              centerImage
                ? jsx("img", {
                    src: centerImage,
                    alt: "",
                    style: `width:${Math.round(size * 0.52)}px;height:${Math.round(size * 0.52)}px;border-radius:50%;object-fit:cover`,
                  })
                : icon != null && typeof icon !== "boolean"
                ? div(`color:${accent}`, icon)
                : div(
                    `font-size:${theme.typography.sizes.body}px;font-weight:${theme.typography.weights.heading};color:${T.text}`,
                    centerDisplay
                  ),
            ],
            "position:absolute;inset:0;align-items:center;justify-content:center"
          ),
        ]),
        label !== undefined
          ? column(
              [
                div(
                  `font-size:${theme.typography.sizes.body}px;font-weight:${theme.typography.weights.strong};color:${T.text}`,
                  label
                ),
              ],
              `flex:1;min-width:0;gap:${theme.spacing.xs}px`
            )
          : null,
      ],
    }),
    props,
    theme,
    "DonutChart"
  );
}

export function ComparisonBar(props: ComparisonBarProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const {
    leftLabel,
    leftValue,
    leftText,
    rightLabel,
    rightValue,
    rightText,
    leftAccent = T.accentMem,
    rightAccent = T.accentSwap,
  } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);
  const column = (children: JSXRenderable, style = "") =>
    themedColumn(theme, children, style);

  const lv = Number.isFinite(leftValue) && leftValue > 0 ? leftValue : 0;
  const rv = Number.isFinite(rightValue) && rightValue > 0 ? rightValue : 0;
  const total = lv + rv;
  const leftPct = total > 0 ? Math.round((lv / total) * 100) : 50;
  const rightPct = 100 - leftPct;

  return customizeRoot(
    column(
      [
        jsx(Row, {
          justify: "space-between",
          style: `margin:${theme.spacing.xs}px 0`,
          children: [
            div(
              `font-size:${theme.typography.sizes.small}px;font-weight:${theme.typography.weights.strong};color:${leftAccent}`,
              [leftLabel, " ", leftText !== undefined ? leftText : `${leftPct}%`]
            ),
            div(
              `font-size:${theme.typography.sizes.small}px;font-weight:${theme.typography.weights.strong};color:${rightAccent}`,
              [rightText !== undefined ? rightText : `${rightPct}%`, " ", rightLabel]
            ),
          ],
        }),
        div(
          `display:flex;flex-direction:row;width:100%;height:${theme.spacing.sm}px;border-radius:${cssLength(theme.radii.bar)};overflow:hidden;background:${T.barTrack}`,
          [
            div(`width:${leftPct}%;height:100%;background:${leftAccent}`),
            div(`width:${rightPct}%;height:100%;background:${rightAccent}`),
          ]
        ),
      ],
      `margin:${theme.spacing.xs}px 0`
    ),
    props,
    theme,
    "ComparisonBar"
  );
}

export function HeatmapGrid(props: HeatmapGridProps): JSXElement {
  const theme = themeOf(props);
  const T = theme.palette;
  const {
    values,
    columns = 12,
    cellSize = 12,
    accent = T.accentCpu,
  } = displayProps(props);
  const div = (style: string, children?: JSXRenderable) =>
    themedDiv(theme, style, children);

  const finite = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const max = Math.max(...finite, 1);
  const cells = finite.map((val) => {
    const ratio = val / max;
    const fill = val <= 0 ? T.barTrack : tint(accent, Math.max(0.2, ratio));
    return div(
      `width:${cellSize}px;height:${cellSize}px;border-radius:${cssLength(theme.radii.chart)};background:${fill}`
    );
  });

  return customizeRoot(
    div(
      `display:grid;grid-template-columns:repeat(${Math.max(1, columns)}, ${cellSize}px);gap:${theme.spacing.xs}px;margin:${theme.spacing.xs}px 0`,
      cells
    ),
    props,
    theme,
    "HeatmapGrid"
  );
}
