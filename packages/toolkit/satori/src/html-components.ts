/**
 * Satori 友好 HTML 组件
 */
import { e, html, tightHtml } from "./html-template.js";

/** 函数式 HTML 组件 */
export type HtmlComponent<P = void> = P extends void
  ? () => string
  : (props: P) => string;

/** 子节点：字符串，或子节点数组（可含 false/null/undefined 做条件渲染） */
export type HtmlChildNode = string | false | null | undefined;
export type HtmlChild = string | readonly HtmlChildNode[];

/** 将 children 展平为 HTML 字符串 */
export function flattenChildren(children: HtmlChild): string {
  if (typeof children === "string") return children;
  return children.filter((n): n is string => typeof n === "string").join("");
}

/** 调用函数式 HTML 组件，等价于无编译器的 JSX */
export function h<P>(component: HtmlComponent<P>, props?: P): string {
  if (component.length === 0) {
    return (component as () => string)();
  }
  return (component as (props: P) => string)(props as P);
}

/** @deprecated 使用 `h` */
export const renderHtmlComponent = h;

/** 与 zt-report-card THEME 一致 */
export const DEFAULT_CARD_THEME = {
  canvas: "#d8dce3",
  card: "#ffffff",
  surface: "#f8f9fb",
  border: "rgba(0,0,0,0.05)",
  text: "#111111",
  textSecondary: "#3f3f46",
  textMuted: "#a1a1aa",
  barTrack: "rgba(0,0,0,0.06)",
  barWarn: "#f59e0b",
  barCrit: "#ef4444",
  accentCpu: "#10b981",
  accentMem: "#3b82f6",
  accentDisk: "#8b5cf6",
  accentSwap: "#ec4899",
  divider: "rgba(0,0,0,0.06)",
  shadowLg: "0 16px 40px rgba(15,23,42,0.14)",
  shadowMd: "0 8px 22px rgba(15,23,42,0.10)",
  shadowSm: "0 2px 8px rgba(15,23,42,0.07)",
  shadowFloor: "rgba(15,23,42,0.07)",
} as const;

/** zt KvTable 默认标签列宽 */
export const LABEL_W = 88;
export const LABEL_W_HALF = 56;

export function formatCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** 进度条语义色（对齐 zt barTone） */
export function barTone(percent: number, accent: string): string {
  if (percent >= 90) return DEFAULT_CARD_THEME.barCrit;
  if (percent >= 75) return DEFAULT_CARD_THEME.barWarn;
  return accent;
}

/** 为 #RRGGBB 附加 alpha（雷达图填充等） */
export function tint(hex: string, alpha: number): string {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) return hex;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function rankAccent(rank: number): string {
  if (rank === 1) return DEFAULT_CARD_THEME.barWarn;
  if (rank === 2) return DEFAULT_CARD_THEME.textMuted;
  if (rank === 3) return "#d97706";
  return DEFAULT_CARD_THEME.accentMem;
}

export interface RawProps {
  html: string;
}

/** 原样插入 HTML 片段 */
export const Raw: HtmlComponent<RawProps> = ({ html: content }) => content;

export interface CardCanvasProps {
  children: HtmlChild;
  width?: number;
  backgroundColor?: string;
  padding?: string;
}

/** 卡片画布（zt 外层灰底） */
export const CardCanvas: HtmlComponent<CardCanvasProps> = ({
  children,
  width = 540,
  backgroundColor = DEFAULT_CARD_THEME.canvas,
  padding = "18px 16px 22px",
}) => tightHtml(html`
  <div style="display:flex;flex-direction:column;width:${width}px;padding:${padding};background-color:${backgroundColor};font-family:sans-serif">
    ${flattenChildren(children)}
  </div>
`);

export interface CardProps {
  children: HtmlChild;
}

/** 浮起白卡片（zt ElevatedCard：底影椭圆 + 负 margin 咬合） */
export const Card: HtmlComponent<CardProps> = ({ children }) => {
  const T = DEFAULT_CARD_THEME;
  return html`
    <div style="display:flex;flex-direction:column;width:100%">
      <div style="display:flex;flex-direction:column;margin:0 14px">
        <div style="height:14px;background:${T.shadowFloor};border-radius:0 0 50% 50%"></div>
      </div>
      <div style="display:flex;flex-direction:column;width:100%;margin-top:-10px;padding:22px 24px;background-color:${T.card};border-radius:18px;box-shadow:${T.shadowLg};color:${T.textSecondary};font-family:sans-serif">
        ${flattenChildren(children)}
      </div>
    </div>
  `;
};

export interface SurfaceProps {
  children: HtmlChild;
  shadow?: "sm" | "md";
  padding?: string;
  style?: string;
}

/** 浅灰浮块（zt SurfacePanel） */
export const Surface: HtmlComponent<SurfaceProps> = ({
  children,
  shadow = "sm",
  padding,
  style = "",
}) => {
  const T = DEFAULT_CARD_THEME;
  const boxShadow = shadow === "md" ? T.shadowMd : T.shadowSm;
  const pad = padding ?? "";
  return html`
    <div style="display:flex;flex-direction:column;background:${T.surface};border-radius:12px;box-shadow:${boxShadow};${pad ? `padding:${pad};` : ""}${style}">
      ${flattenChildren(children)}
    </div>
  `;
};

export interface CardHeaderProps {
  title: string;
  subtitle?: string;
  /** @deprecated 使用 subtitle */
  meta?: string;
  badge?: string;
}

/** 卡片标题区（zt 顶栏：左标题 + 右 Surface 角标） */
export const CardHeader: HtmlComponent<CardHeaderProps> = ({ title, subtitle, meta, badge }) => {
  const T = DEFAULT_CARD_THEME;
  const sub = subtitle ?? meta;
  const titleBlock = html`
    <div style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:0">
      <div style="font-size:20px;font-weight:700;color:${T.text};letter-spacing:-0.03em">${e(title)}</div>
      ${sub ? `<div style="font-size:11px;color:${T.textMuted};letter-spacing:0.02em">${e(sub)}</div>` : ""}
    </div>
  `;
  const badgeBlock = badge
    ? h(Surface, {
        padding: "7px 12px",
        children: `<div style="color:${T.textSecondary};font-size:12px;font-weight:600">${e(badge)}</div>`,
      })
    : "";
  if (badge) {
    return html`
      <div style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;margin-bottom:16px;gap:12px">
        ${titleBlock}${badgeBlock}
      </div>
    `;
  }
  return html`
    <div style="display:flex;flex-direction:column;gap:3px;margin-bottom:16px">
      <div style="font-size:20px;font-weight:700;color:${T.text};letter-spacing:-0.03em">${e(title)}</div>
      ${sub ? `<div style="font-size:11px;color:${T.textMuted};letter-spacing:0.02em">${e(sub)}</div>` : ""}
    </div>
  `;
};

export interface RowProps {
  children: HtmlChild;
  gap?: number;
  align?: string;
  justify?: string;
  wrap?: boolean;
  style?: string;
}

export const Row: HtmlComponent<RowProps> = ({
  children,
  gap = 0,
  align = "stretch",
  justify = "flex-start",
  wrap = false,
  style = "",
}) => html`
  <div style="display:flex;flex-direction:row;gap:${gap}px;align-items:${align};justify-content:${justify};flex-wrap:${wrap ? "wrap" : "nowrap"};${style}">
    ${flattenChildren(children)}
  </div>
`;

export interface ColProps {
  children: HtmlChild;
  gap?: number;
  align?: string;
  style?: string;
}

export const Col: HtmlComponent<ColProps> = ({
  children,
  gap = 0,
  align = "stretch",
  style = "",
}) => html`
  <div style="display:flex;flex-direction:column;gap:${gap}px;align-items:${align};${style}">
    ${flattenChildren(children)}
  </div>
`;

export interface DividerProps {
  margin?: string;
}

export const Divider: HtmlComponent<DividerProps> = ({ margin = "14px 0" }) => {
  const T = DEFAULT_CARD_THEME;
  return html`<div style="display:flex;height:1px;background:${T.divider};margin:${margin}"></div>`;
};

export interface SectionProps {
  title: string;
  children: HtmlChild;
  /** @deprecated zt Section 无 accent 装饰，保留兼容 */
  accent?: string;
}

/** 分区（zt Section：顶线 + uppercase 标题） */
export const Section: HtmlComponent<SectionProps> = ({ title, children }) => {
  const T = DEFAULT_CARD_THEME;
  return html`
    <div style="display:flex;flex-direction:column;padding-top:14px;border-top:1px solid ${T.divider}">
      <div style="color:${T.textMuted};font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px">${e(title)}</div>
      <div style="display:flex;flex-direction:column;gap:5px">${flattenChildren(children)}</div>
    </div>
  `;
};

export interface KvRowProps {
  label: string;
  value: string;
  labelWidth?: number;
  bold?: boolean;
}

/** 键值行（zt LabelCell + ValueCell） */
export const KvRow: HtmlComponent<KvRowProps> = ({
  label,
  value,
  labelWidth = LABEL_W,
  bold = false,
}) => {
  const T = DEFAULT_CARD_THEME;
  return html`
    <div style="display:flex;flex-direction:row;align-items:center">
      <div style="display:flex;width:${labelWidth}px;min-width:${labelWidth}px;max-width:${labelWidth}px;color:${T.textMuted};font-size:12px;line-height:16px;text-align:right;padding-right:10px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e(label)}</div>
      <div style="display:flex;flex:1;min-width:0;color:${bold ? T.text : T.textSecondary};font-size:12px;line-height:16px;font-weight:${bold ? 600 : 500}">${e(value)}</div>
    </div>
  `;
};

export interface KvTableProps {
  rows: ReadonlyArray<{ label: string; value: string }>;
  labelWidth?: number;
}

/** 键值表 */
export const KvTable: HtmlComponent<KvTableProps> = ({ rows, labelWidth = LABEL_W }) => html`
  <div style="display:flex;flex-direction:column;gap:6px">
    ${rows.map(({ label, value }) => h(KvRow, { label, value, labelWidth })).join("")}
  </div>
`;

export interface UsageBarProps {
  percent?: number;
  accent?: string;
  showLabel?: boolean;
  /** 覆盖右侧百分比文案 */
  label?: string;
}

/** 水平进度条（zt UsageBar） */
export const UsageBar: HtmlComponent<UsageBarProps> = ({
  percent,
  accent = DEFAULT_CARD_THEME.accentMem,
  showLabel = true,
  label: labelOverride,
}) => {
  const T = DEFAULT_CARD_THEME;
  const p = Math.min(100, Math.max(0, percent ?? 0));
  const tone = barTone(p, accent);
  const labelText = labelOverride ?? (percent == null || Number.isNaN(percent) ? "—" : `${percent.toFixed(1)}%`);
  const label = showLabel
    ? `<div style="display:flex;color:${T.textMuted};font-size:11px;width:42px;text-align:right;flex-shrink:0">${e(labelText)}</div>`
    : "";
  return html`
    <div style="display:flex;flex-direction:row;align-items:center;gap:8px;width:100%">
      <div style="display:flex;flex-direction:column;flex:1;min-width:0;height:6px;background:${T.barTrack};border-radius:3px;overflow:hidden;border:1px solid ${T.border}">
        <div style="width:${p}%;height:100%;background:${tone};border-radius:2px"></div>
      </div>
      ${label}
    </div>
  `;
};

export interface MetricBlockProps {
  label: string;
  value?: string;
  percent?: number;
  accent?: string;
  labelWidth?: number;
}

/** 标签 + 数值 + 可选进度条（zt MetricBlock） */
export const MetricBlock: HtmlComponent<MetricBlockProps> = ({
  label,
  value,
  percent,
  accent = DEFAULT_CARD_THEME.accentMem,
  labelWidth = LABEL_W,
}) => {
  const T = DEFAULT_CARD_THEME;
  if (!value && (percent == null || Number.isNaN(percent))) return "";
  const valueLine = value
    ? `<div style="color:${T.textSecondary};font-size:12px;line-height:16px;font-weight:600;white-space:nowrap">${e(value)}</div>`
    : "";
  const barLine = percent != null && !Number.isNaN(percent)
    ? h(UsageBar, { percent, accent, showLabel: true })
    : "";
  return html`
    <div style="display:flex;flex-direction:row;align-items:center;margin-bottom:6px">
      <div style="display:flex;width:${labelWidth}px;min-width:${labelWidth}px;max-width:${labelWidth}px;color:${T.textMuted};font-size:12px;line-height:16px;text-align:right;padding-right:10px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e(label)}</div>
      <div style="display:flex;flex-direction:column;flex:1;min-width:0;gap:4px">
        ${valueLine}${barLine}
      </div>
    </div>
  `;
};

export interface DualSectionProps {
  left: { title: string; rows: ReadonlyArray<{ label: string; value: string }> };
  right: { title: string; rows: ReadonlyArray<{ label: string; value: string }> };
}

/** 双栏对照分区（zt DualSection） */
export const DualSection: HtmlComponent<DualSectionProps> = ({ left, right }) => {
  const T = DEFAULT_CARD_THEME;
  const titleStyle = `flex:1;min-width:0;color:${T.textMuted};font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;line-height:14px`;
  return html`
    <div style="display:flex;flex-direction:column;padding-top:14px;border-top:1px solid ${T.divider}">
      <div style="display:flex;flex-direction:row;gap:20px;margin-bottom:8px">
        <div style="display:flex;${titleStyle}">${e(left.title)}</div>
        <div style="display:flex;${titleStyle}">${e(right.title)}</div>
      </div>
      <div style="display:flex;flex-direction:row;gap:20px;align-items:flex-start">
        <div style="display:flex;flex-direction:column;flex:1;min-width:0">${h(KvTable, { rows: left.rows, labelWidth: LABEL_W_HALF })}</div>
        <div style="display:flex;flex-direction:column;flex:1;min-width:0">${h(KvTable, { rows: right.rows, labelWidth: LABEL_W_HALF })}</div>
      </div>
    </div>
  `;
};

export interface StatChipProps {
  label: string;
  value: string;
  accent?: string;
  /** @deprecated zt StatChip 无 hint */
  hint?: string;
}

/** KPI 摘要（zt StatChip = SurfacePanel shadowMd） */
export const StatChip: HtmlComponent<StatChipProps> = ({
  label,
  value,
  accent = DEFAULT_CARD_THEME.accentMem,
}) => {
  const T = DEFAULT_CARD_THEME;
  return h(Surface, {
    shadow: "md",
    padding: "12px 14px",
    style: "flex:1;",
    children: html`
      <div style="color:${T.textMuted};font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase">${e(label)}</div>
      <div style="color:${accent};font-size:24px;font-weight:700;line-height:1.15;margin-top:6px;letter-spacing:-0.02em">${e(value)}</div>
    `,
  });
};

export interface BarRowProps {
  rank?: number;
  label: string;
  value: string | number;
  percent: number;
  accent?: string;
}

/** 排行榜行（zt DiskMountRow / MetricBlock 风格） */
export const BarRow: HtmlComponent<BarRowProps> = ({
  rank,
  label,
  value,
  percent,
  accent,
}) => {
  const tone = rank != null ? rankAccent(rank) : (accent ?? DEFAULT_CARD_THEME.accentMem);
  const rowLabel = rank != null ? `${rank}. ${label}` : label;
  return h(MetricBlock, {
    label: rowLabel,
    value: String(value),
    percent,
    accent: tone,
  });
};

export interface BarChartProps {
  values: number[];
  peakIndex?: number;
  height?: number;
  accent?: string;
  peakAccent?: string;
  tickLabels?: [string, string, string];
  showPeakValue?: boolean;
}

/** 垂直柱状图（24 小时分布等；配色遵循 zt accent） */
export const BarChart: HtmlComponent<BarChartProps> = ({
  values,
  peakIndex,
  height = 56,
  accent = DEFAULT_CARD_THEME.accentMem,
  peakAccent = DEFAULT_CARD_THEME.barWarn,
  tickLabels = ["00:00", "12:00", "23:00"],
  showPeakValue = false,
}) => {
  const T = DEFAULT_CARD_THEME;
  const max = Math.max(...values, 1);
  const bars = values.map((count, i) => {
    const pct = Math.max(4, Math.round((count / max) * 100));
    const isPeak = peakIndex === i && count > 0;
    const bg = isPeak ? peakAccent : accent;
    const opacity = count > 0 ? (isPeak ? 1 : 0.55) : 0.2;
    const minH = count > 0 ? 4 : 2;
    const peakLabel = isPeak && showPeakValue
      ? `<div style="font-size:9px;font-weight:600;color:${peakAccent};margin-bottom:2px">${e(formatCount(count))}</div>`
      : "";
    return html`
      <div style="display:flex;flex-direction:column;flex:1;align-items:center;justify-content:flex-end;min-width:0;height:100%">
        ${peakLabel}
        <div style="width:100%;height:${pct}%;min-height:${minH}px;background:${bg};opacity:${opacity};border-radius:2px"></div>
      </div>
    `;
  }).join("");
  return html`
    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;flex-direction:row;align-items:flex-end;gap:3px;height:${height}px">${bars}</div>
      <div style="display:flex;flex-direction:row;justify-content:space-between">
        <div style="font-size:9px;color:${T.textMuted}">${e(tickLabels[0])}</div>
        <div style="font-size:9px;color:${T.textMuted}">${e(tickLabels[1])}</div>
        <div style="font-size:9px;color:${T.textMuted}">${e(tickLabels[2])}</div>
      </div>
    </div>
  `;
};

export interface RadarChartProps {
  labels: string[];
  values: number[];
  max?: number;
  size?: number;
  accent?: string;
  fill?: string;
}

export const RadarChart: HtmlComponent<RadarChartProps> = ({
  labels,
  values,
  max,
  size = 200,
  accent = DEFAULT_CARD_THEME.accentMem,
  fill,
}) => {
  const T = DEFAULT_CARD_THEME;
  const areaFill = fill ?? tint(accent, 0.25);
  const n = Math.min(labels.length, values.length);
  const peak = max ?? Math.max(...values.slice(0, n), 1);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.38;
  const rings = [0.25, 0.5, 0.75, 1];
  const ringSvgs = rings.map((r) =>
    `<circle cx="${cx}" cy="${cy}" r="${radius * r}" fill="none" stroke="rgba(0,0,0,0.08)" stroke-width="1"/>`
  ).join("");
  const points: string[] = [];
  const spokes: string[] = [];
  const labelNodes: string[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const ratio = Math.min(1, (values[i] || 0) / peak);
    const x = cx + Math.cos(angle) * radius * ratio;
    const y = cy + Math.sin(angle) * radius * ratio;
    points.push(`${x},${y}`);
    const ox = cx + Math.cos(angle) * radius;
    const oy = cy + Math.sin(angle) * radius;
    spokes.push(`<line x1="${cx}" y1="${cy}" x2="${ox}" y2="${oy}" stroke="rgba(0,0,0,0.08)" stroke-width="1"/>`);
    const lx = cx + Math.cos(angle) * (radius + 16);
    const ly = cy + Math.sin(angle) * (radius + 16);
    labelNodes.push(
      `<div style="position:absolute;left:${lx}px;top:${ly}px;transform:translate(-50%,-50%);font-size:9px;color:${T.textMuted};white-space:nowrap">${e(labels[i])}</div>`,
    );
  }
  const polygon = points.length >= 3
    ? `<polygon points="${points.join(" ")}" fill="${areaFill}" stroke="${accent}" stroke-width="2"/>`
    : "";
  return html`
    <div style="display:flex;flex-direction:column;align-items:center;width:100%">
      <div style="display:flex;position:relative;width:${size}px;height:${size}px">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          ${ringSvgs}${spokes}${polygon}
        </svg>
        ${labelNodes.join("")}
      </div>
    </div>
  `;
};

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  accent?: string;
}

export const Sparkline: HtmlComponent<SparklineProps> = ({
  values,
  width = 120,
  height = 32,
  accent = DEFAULT_CARD_THEME.accentMem,
}) => {
  if (values.length < 2) {
    return html`<div style="display:flex;width:${width}px;height:${height}px"></div>`;
  }
  const max = Math.max(...values, 1);
  const pad = 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * innerW;
    const y = pad + innerH - (v / max) * innerH;
    return `${x},${y}`;
  }).join(" ");
  const last = values[values.length - 1] ?? 0;
  const lx = pad + innerW;
  const ly = pad + innerH - (last / max) * innerH;
  return html`
    <div style="display:flex;flex-direction:column;gap:4px">
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <polyline points="${pts}" fill="none" stroke="${accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="${lx}" cy="${ly}" r="3" fill="${accent}"/>
      </svg>
    </div>
  `;
};

export interface TopicItemProps {
  index: number;
  title: string;
  summary?: string;
  /** @deprecated 保留兼容 */
  accent?: string;
}

/** 话题行（Kv 风格，无独立卡片边框） */
export const TopicItem: HtmlComponent<TopicItemProps> = ({ index, title, summary }) => {
  const T = DEFAULT_CARD_THEME;
  return html`
    <div style="display:flex;flex-direction:row;gap:10px;align-items:flex-start">
      <div style="display:flex;width:22px;min-width:22px;color:${T.textMuted};font-size:12px;line-height:16px;text-align:right;padding-right:4px;flex-shrink:0">${index}</div>
      <div style="display:flex;flex-direction:column;flex:1;min-width:0;gap:2px">
        <div style="font-size:12px;font-weight:600;color:${T.text};line-height:16px">${e(title)}</div>
        ${summary ? `<div style="font-size:11px;color:${T.textMuted};line-height:15px">${e(summary)}</div>` : ""}
      </div>
    </div>
  `;
};

export interface QuoteCardProps {
  index?: number;
  content: string;
  author: string;
  reason?: string;
  /** @deprecated 保留兼容 */
  accent?: string;
}

/** 金句（zt SurfacePanel 风格） */
export const QuoteCard: HtmlComponent<QuoteCardProps> = ({ index, content, author, reason }) => {
  const T = DEFAULT_CARD_THEME;
  return h(Surface, {
    padding: "10px 12px",
    children: html`
      ${index != null ? `<div style="font-size:11px;color:${T.textMuted};margin-bottom:4px">#${index}</div>` : ""}
      <div style="font-size:12px;font-weight:600;color:${T.text};line-height:17px">「${e(content)}」</div>
      <div style="font-size:11px;color:${T.textSecondary};margin-top:6px">${e(author)}${reason ? ` · ${e(reason)}` : ""}</div>
    `,
  });
};

export interface ProfileRowProps {
  index?: number;
  name: string;
  badge?: string;
  reason?: string;
  /** @deprecated 保留兼容 */
  accent?: string;
}

/** 用户画像行 */
export const ProfileRow: HtmlComponent<ProfileRowProps> = ({ index, name, badge, reason }) => {
  const T = DEFAULT_CARD_THEME;
  const badgeText = badge
    ? `<div style="font-size:10px;font-weight:600;color:${T.accentSwap}">${e(badge)}</div>`
    : "";
  return html`
    <div style="display:flex;flex-direction:row;gap:10px;align-items:center">
      ${index != null ? `<div style="display:flex;width:28px;min-width:28px;color:${T.textMuted};font-size:12px;line-height:16px;text-align:right;padding-right:4px;flex-shrink:0">${index}</div>` : ""}
      <div style="display:flex;flex-direction:column;flex:1;min-width:0;gap:2px">
        <div style="display:flex;flex-direction:row;gap:8px;align-items:center;flex-wrap:wrap">
          <div style="font-size:12px;font-weight:600;color:${T.text}">${e(name)}</div>
          ${badgeText}
        </div>
        ${reason ? `<div style="font-size:11px;color:${T.textMuted}">${e(reason)}</div>` : ""}
      </div>
    </div>
  `;
};

export interface BadgeProps {
  text: string;
  accent?: string;
}

/** 行内强调文字（非胶囊，对齐 zt 弱装饰） */
export const Badge: HtmlComponent<BadgeProps> = ({ text, accent = DEFAULT_CARD_THEME.accentSwap }) => html`
  <div style="display:flex;font-size:10px;font-weight:600;color:${accent}">${e(text)}</div>
`;

export interface EmptyStateProps {
  message: string;
}

export const EmptyState: HtmlComponent<EmptyStateProps> = ({ message }) => {
  const T = DEFAULT_CARD_THEME;
  return h(Surface, {
    padding: "10px 12px",
    children: `<div style="color:${T.textSecondary};font-size:11px;line-height:16px">${e(message)}</div>`,
  });
};

export function composeCard(inner: string, canvas?: Partial<CardCanvasProps>): string {
  return h(CardCanvas, {
    children: h(Card, { children: inner }),
    ...canvas,
  });
}
