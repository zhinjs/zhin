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
