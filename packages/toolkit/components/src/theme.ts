import {
  Fragment,
  isJsxElement,
  jsx,
  type JSXElement,
  type JSXRenderable,
  type JSXStyle,
} from "@zhin.js/jsx";
import { mergeStyles } from "./styles.js";

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
  accentRank: "#d97706",
  divider: "rgba(0,0,0,0.06)",
  shadowLg: "0 16px 40px rgba(15,23,42,0.14)",
  shadowMd: "0 8px 22px rgba(15,23,42,0.10)",
  shadowSm: "0 2px 8px rgba(15,23,42,0.07)",
  shadowFloor: "rgba(15,23,42,0.07)",
} as const;

export type ComponentName =
  | "CardCanvas"
  | "Card"
  | "Surface"
  | "CardHeader"
  | "Row"
  | "Col"
  | "Divider"
  | "Section"
  | "KvRow"
  | "KvTable"
  | "UsageBar"
  | "MetricBlock"
  | "DualSection"
  | "StatChip"
  | "BarRow"
  | "BarChart"
  | "RadarChart"
  | "Sparkline"
  | "TopicItem"
  | "QuoteCard"
  | "ProfileRow"
  | "Badge"
  | "EmptyState";

/** Content remains JSX; design tokens are intentionally CSS values or numbers. */
export interface ComponentTheme {
  readonly palette: { readonly [K in keyof typeof DEFAULT_CARD_THEME]: string };
  readonly typography: {
    readonly fontFamily: string;
    readonly lineHeight: number;
    readonly sizes: {
      readonly tiny: number;
      readonly caption: number;
      readonly small: number;
      readonly body: number;
      readonly title: number;
      readonly metric: number;
    };
    readonly weights: {
      readonly normal: number;
      readonly strong: number;
      readonly heading: number;
    };
  };
  readonly radii: {
    readonly card: string | number;
    readonly surface: string | number;
    readonly bar: string | number;
    readonly chart: string | number;
  };
  readonly border: { readonly width: string | number; readonly style: string };
  readonly spacing: {
    readonly scale: number;
    readonly xs: number;
    readonly sm: number;
    readonly md: number;
    readonly lg: number;
    readonly xl: number;
    readonly canvasPadding?: string;
    readonly cardPadding?: string;
    readonly sectionGap?: number;
    readonly rowGap: number;
  };
  readonly layout: {
    readonly cardWidth: number;
    readonly labelWidth: number;
    readonly compactLabelWidth: number;
    readonly progressHeight: number;
    readonly barChartHeight: number;
    readonly radarSize: number;
    readonly sparklineWidth: number;
    readonly sparklineHeight: number;
  };
  readonly text: {
    readonly unavailable: JSXRenderable;
    readonly emptyState: JSXRenderable;
    readonly rankSeparator: JSXRenderable;
    readonly quoteOpen: JSXRenderable;
    readonly quoteClose: JSXRenderable;
    readonly reasonSeparator: JSXRenderable;
    readonly indexPrefix: JSXRenderable;
    readonly chartTicks: readonly [JSXRenderable, JSXRenderable, JSXRenderable];
  };
  /** Global root defaults; a component's own layout remains authoritative. */
  readonly style: JSXStyle;
  /** Project-wide component root overrides, applied after component defaults. */
  readonly components: Readonly<Partial<Record<ComponentName, JSXStyle>>>;
}

export type ThemeOverrides = {
  readonly [K in keyof ComponentTheme]?: K extends "style" | "components"
    ? ComponentTheme[K]
    : K extends "text"
    ? Partial<ComponentTheme[K]>
    : {
        readonly [P in keyof ComponentTheme[K]]?: ComponentTheme[K][P] extends object
          ? Partial<ComponentTheme[K][P]>
          : ComponentTheme[K][P];
      };
};

export interface DisplayOverrides {
  readonly title?: JSXRenderable;
  readonly subtitle?: JSXRenderable;
  readonly label?: JSXRenderable;
  readonly value?: JSXRenderable;
  readonly text?: JSXRenderable;
  readonly content?: JSXRenderable;
  readonly message?: JSXRenderable;
  readonly badge?: JSXRenderable;
  readonly reason?: JSXRenderable;
  readonly author?: JSXRenderable;
  readonly summary?: JSXRenderable;
  readonly name?: JSXRenderable;
}
export interface ComponentCustomization {
  readonly style?: JSXStyle;
  readonly text?: DisplayOverrides;
}
export interface ComponentProps {
  readonly custom?: ComponentCustomization;
}

export const DEFAULT_THEME: ComponentTheme = {
  palette: DEFAULT_CARD_THEME,
  typography: {
    fontFamily: "sans-serif",
    lineHeight: 4 / 3,
    sizes: { tiny: 9, caption: 10, small: 11, body: 12, title: 20, metric: 24 },
    weights: { normal: 500, strong: 600, heading: 700 },
  },
  radii: { card: 18, surface: 12, bar: 3, chart: 2 },
  border: { width: 1, style: "solid" },
  spacing: {
    scale: 1,
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    rowGap: 0,
  },
  layout: {
    cardWidth: 540,
    labelWidth: 88,
    compactLabelWidth: 56,
    progressHeight: 6,
    barChartHeight: 56,
    radarSize: 200,
    sparklineWidth: 120,
    sparklineHeight: 32,
  },
  text: {
    unavailable: "—",
    emptyState: "暂无数据",
    rankSeparator: ". ",
    quoteOpen: "「",
    quoteClose: "」",
    reasonSeparator: " · ",
    indexPrefix: "#",
    chartTicks: ["00:00", "12:00", "23:00"],
  },
  style: {},
  components: {},
};

/** Private symbols carry a tree's scope and never become HTML attributes. */
const themeContext = Symbol("zhin.components.theme");
const scopedNode = Symbol("zhin.components.scoped-node");
interface ScopeRecord {
  readonly source: JSXElement;
}

export function themeOf(props: object): ComponentTheme {
  return (
    (props as { [themeContext]?: ComponentTheme })[themeContext] ??
    DEFAULT_THEME
  );
}

export function mergeTheme(
  parent: ComponentTheme,
  override: ThemeOverrides = {}
): ComponentTheme {
  return {
    palette: { ...parent.palette, ...override.palette },
    typography: {
      ...parent.typography,
      ...override.typography,
      sizes: { ...parent.typography.sizes, ...override.typography?.sizes },
      weights: {
        ...parent.typography.weights,
        ...override.typography?.weights,
      },
    },
    radii: { ...parent.radii, ...override.radii },
    border: { ...parent.border, ...override.border },
    spacing: { ...parent.spacing, ...override.spacing },
    layout: { ...parent.layout, ...override.layout },
    text: { ...parent.text, ...override.text },
    style: mergeStyles(parent.style, override.style),
    components: Object.fromEntries(
      [
        ...new Set([
          ...Object.keys(parent.components),
          ...Object.keys(override.components ?? {}),
        ]),
      ].map((name) => [
        name,
        mergeStyles(
          parent.components[name as ComponentName],
          override.components?.[name as ComponentName]
        ),
      ])
    ),
  };
}

/** Local display overrides do not coerce nodes, including null, false or zero. */
export function displayProps<P extends ComponentProps>(props: P): P {
  return props.custom?.text ? { ...props, ...props.custom.text } : props;
}

export interface ThemeProviderProps {
  readonly theme?: ThemeOverrides;
  readonly children?: JSXRenderable;
}

/** Pure tree scope: no mutable current theme, async context or React dependency. */
export function ThemeProvider(props: ThemeProviderProps): JSXRenderable {
  const theme = mergeTheme(themeOf(props), props.theme);
  if (!Number.isFinite(theme.spacing.scale) || theme.spacing.scale < 0)
    throw new RangeError("Theme spacing.scale must be finite and non-negative");
  return scopeTree(props.children, theme, true);
}

function scopeTree(
  node: JSXRenderable,
  theme: ComponentTheme,
  reset = false,
  ancestors: ReadonlySet<object> = new Set(),
  initialDepth = 0
): JSXRenderable {
  const path = new Set<object>(ancestors);
  const visit = (
    value: JSXRenderable,
    depth: number
  ): JSXRenderable => {
    if (depth > 100)
      throw new RangeError("Theme tree exceeds maximum depth 100");
    if (value == null || typeof value !== "object") return value;
    if (path.has(value)) throw new TypeError("Circular JSX theme tree");
    path.add(value);
    try {
      if (Array.isArray(value))
        return value.map((child) => visit(child, depth + 1));
      if (isJsxElement(value)) {
        const marker = (value.props as { [scopedNode]?: ScopeRecord })[
          scopedNode
        ];
        if (marker && !reset) return value;
        const source = marker?.source ?? value;
        const { type, props } = source;
        if (type === ThemeProvider) {
          // Nested providers receive raw children so their overrides inherit the parent.
          return jsx(ThemeProvider, {
            ...props,
            [themeContext]: theme,
            [scopedNode]: { source },
          });
        }
        const scopedProps = {
          ...props,
          [themeContext]: theme,
          [scopedNode]: { source },
          children: visit(props.children, depth + 1),
        };
        if (typeof type === "function") {
          const ancestry = new Set(path);
          return jsx(
            (input) =>
              scopeTree(type(input), theme, false, ancestry, depth + 1),
            scopedProps
          );
        }
        return jsx(type, scopedProps);
      }
      if ("then" in value && typeof value.then === "function") {
        // Keep source ancestors through async resolution, without Promise assimilation.
        const ancestry = new Set(path);
        return jsx(async (): Promise<JSXElement> => {
          const result = await new Promise<{ node: JSXRenderable }>(
            (resolve, reject) => {
              value.then((node) => resolve({ node }), reject);
            }
          );
          return jsx(Fragment, {
            children: scopeTree(result.node, theme, reset, ancestry, depth + 1),
          });
        }, {});
      }
      throw new TypeError("Unsupported JSX theme child");
    } finally {
      path.delete(value);
    }
  };
  return visit(node, initialDepth);
}
