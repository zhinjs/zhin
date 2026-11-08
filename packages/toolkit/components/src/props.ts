import type { JSXRenderable } from "@zhin.js/jsx";
import type { ComponentProps } from "./theme.js";

export interface CardCanvasProps extends ComponentProps {
  children?: JSXRenderable;
  width?: number;
  backgroundColor?: string;
  padding?: string;
}

export interface CardProps extends ComponentProps {
  children?: JSXRenderable;
}

export interface SurfaceProps extends ComponentProps {
  children?: JSXRenderable;
  shadow?: "sm" | "md";
  padding?: string;
  style?: string;
}

export interface CardHeaderProps extends ComponentProps {
  title: JSXRenderable;
  subtitle?: JSXRenderable;
  badge?: JSXRenderable;
}

export interface RowProps extends ComponentProps {
  children?: JSXRenderable;
  gap?: number;
  align?: string;
  justify?: string;
  wrap?: boolean;
  style?: string;
}

export interface ColProps extends ComponentProps {
  children?: JSXRenderable;
  gap?: number;
  align?: string;
  style?: string;
}

export interface DividerProps extends ComponentProps {
  margin?: string;
}

export interface SectionProps extends ComponentProps {
  title: JSXRenderable;
  children?: JSXRenderable;
}

export interface KvRowProps extends ComponentProps {
  label: JSXRenderable;
  value: JSXRenderable;
  labelWidth?: number;
  bold?: boolean;
}

export interface KvTableProps extends ComponentProps {
  rows: ReadonlyArray<Pick<KvRowProps, "label" | "value" | "bold">>;
  labelWidth?: number;
}

export interface UsageBarProps extends ComponentProps {
  percent?: number;
  accent?: string;
  showLabel?: boolean;
  /** 覆盖右侧百分比文案 */
  label?: JSXRenderable;
}

export interface MetricBlockProps extends ComponentProps {
  label: JSXRenderable;
  value?: JSXRenderable;
  percent?: number;
  accent?: string;
  labelWidth?: number;
}

export interface DualSectionProps extends ComponentProps {
  left: {
    title: JSXRenderable;
    rows: ReadonlyArray<Pick<KvRowProps, "label" | "value" | "bold">>;
  };
  right: {
    title: JSXRenderable;
    rows: ReadonlyArray<Pick<KvRowProps, "label" | "value" | "bold">>;
  };
}

export interface StatChipProps extends ComponentProps {
  label: JSXRenderable;
  value: JSXRenderable;
  accent?: string;
}

export interface BarRowProps extends ComponentProps {
  rank?: number;
  label: JSXRenderable;
  value: JSXRenderable;
  percent: number;
  accent?: string;
}

export interface BarChartProps extends ComponentProps {
  values: readonly number[];
  peakIndex?: number;
  height?: number;
  accent?: string;
  peakAccent?: string;
  tickLabels?: readonly [JSXRenderable, JSXRenderable, JSXRenderable];
  showPeakValue?: boolean;
}

export interface RadarChartProps extends ComponentProps {
  labels: readonly JSXRenderable[];
  values: readonly number[];
  max?: number;
  size?: number;
  accent?: string;
  fill?: string;
}

export interface SparklineProps extends ComponentProps {
  values: readonly number[];
  width?: number;
  height?: number;
  accent?: string;
}

export interface TopicItemProps extends ComponentProps {
  index: number;
  title: JSXRenderable;
  summary?: JSXRenderable;
}

export interface QuoteCardProps extends ComponentProps {
  index?: number;
  content: JSXRenderable;
  author: JSXRenderable;
  reason?: JSXRenderable;
}

export interface ProfileRowProps extends ComponentProps {
  index?: number;
  name: JSXRenderable;
  badge?: JSXRenderable;
  reason?: JSXRenderable;
}

export interface BadgeProps extends ComponentProps {
  children?: JSXRenderable;
  text?: JSXRenderable;
  accent?: string;
}

export interface EmptyStateProps extends ComponentProps {
  message?: JSXRenderable;
}

export interface DonutChartProps extends ComponentProps {
  percent?: number;
  segments?: ReadonlyArray<{
    readonly value: number;
    readonly color: string;
    readonly label?: JSXRenderable;
  }>;
  size?: number;
  thickness?: number;
  accent?: string;
  label?: JSXRenderable;
  value?: JSXRenderable;
}

export interface CalloutProps extends ComponentProps {
  title?: JSXRenderable;
  message?: JSXRenderable;
  children?: JSXRenderable;
  tone?: "info" | "success" | "warning" | "danger";
  accent?: string;
}

export interface TimelineItemProps extends ComponentProps {
  title: JSXRenderable;
  description?: JSXRenderable;
  time?: JSXRenderable;
  badge?: JSXRenderable;
  accent?: string;
}

export interface TimelineProps extends ComponentProps {
  items?: ReadonlyArray<TimelineItemProps>;
  children?: JSXRenderable;
}

export interface StepTrackerProps extends ComponentProps {
  steps: ReadonlyArray<{
    readonly label: JSXRenderable;
    readonly subtitle?: JSXRenderable;
    readonly status?: "done" | "active" | "pending";
  }>;
  current?: number;
  accent?: string;
}

export interface ComparisonBarProps extends ComponentProps {
  leftLabel: JSXRenderable;
  leftValue: number;
  leftText?: JSXRenderable;
  rightLabel: JSXRenderable;
  rightValue: number;
  rightText?: JSXRenderable;
  leftAccent?: string;
  rightAccent?: string;
}

export interface StatusGridProps extends ComponentProps {
  items: ReadonlyArray<{
    readonly label: JSXRenderable;
    readonly value: JSXRenderable;
    readonly status?: "ok" | "warn" | "crit" | "muted";
    readonly accent?: string;
  }>;
  columns?: number;
}

export interface HeatmapGridProps extends ComponentProps {
  values: readonly number[];
  columns?: number;
  cellSize?: number;
  accent?: string;
}
