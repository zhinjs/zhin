import { jsx, type JSXElement, type JSXRenderable } from "@zhin.js/jsx";
import {
  displayProps,
  themeOf,
  type ComponentName,
  type ComponentTheme,
} from "./theme.js";
import { cssLength, customizeRoot, themedDiv } from "./styles.js";
import type {
  ButtonProps,
  CheckboxProps,
  ControlLabelProps,
  RadioProps,
  SwitchProps,
} from "./controls-props.js";

function labelOf(props: ControlLabelProps): JSXRenderable {
  return props.label === undefined ? props.children : props.label;
}

function controlRoot(
  props: ControlLabelProps,
  theme: ComponentTheme,
  name: ComponentName,
  indicator: JSXElement
): JSXElement {
  const label = labelOf(props);
  const children: JSXRenderable[] = [jsx(indicator.type, {
    ...indicator.props, "aria-hidden": true,
  })];
  if (label != null && typeof label !== "boolean") {
    children.push(
      themedDiv(theme, "display:flex;align-items:center;min-width:0", label)
    );
  }
  const root = customizeRoot(
    themedDiv(
      theme,
      `display:flex;align-items:center;gap:${theme.spacing.sm}px;margin:${
        theme.spacing.xs
      }px 0;color:${
        props.disabled ? theme.palette.textMuted : theme.palette.textSecondary
      };font-size:${theme.typography.sizes.body}px;font-weight:${
        theme.typography.weights.normal
      };opacity:${props.disabled ? 0.55 : 1}`,
      children
    ),
    props,
    theme,
    name
  );
  // Content names are predictable only for primitive labels. Rich/lazy labels
  // remain display-only unless the author supplies a name; never evaluate them
  // early just to infer accessibility metadata.
  const explicitName = props.ariaLabel?.trim();
  const hasContentName =
    (typeof label === "string" && label.trim().length > 0) ||
    typeof label === "number";
  if (!explicitName && !hasContentName) return root;
  return jsx(root.type, {
    ...root.props,
    role: name.toLowerCase(),
    ...(explicitName ? { "aria-label": explicitName } : {}),
    "aria-checked": Boolean((props as CheckboxProps).checked),
    ...(name === "Radio" ? {} : { "aria-readonly": true }),
    "aria-disabled": Boolean(props.disabled),
  });
}

function icon(theme: ComponentTheme, children: JSXRenderable): JSXElement {
  const size = theme.spacing.lg + theme.spacing.xs;
  return jsx("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    style: { flexShrink: 0 },
    children,
  });
}

/** A checkbox illustration, with no input, event handler or internal state. */
export function Checkbox(input: CheckboxProps): JSXElement {
  const theme = themeOf(input),
    props = displayProps(input);
  const accent = props.accent ?? theme.palette.accentMem;
  return controlRoot(
    props,
    theme,
    "Checkbox",
    icon(theme, [
      jsx("rect", {
        x: 2,
        y: 2,
        width: 20,
        height: 20,
        rx: theme.radii.chart,
        fill: props.checked ? accent : theme.palette.card,
        stroke: props.checked ? accent : theme.palette.textMuted,
        strokeWidth: theme.border.width,
      }),
      props.checked
        ? jsx("path", {
            d: "M7 12l3.5 3.5L17 8.5",
            fill: "none",
            stroke: theme.palette.onAccent,
            strokeWidth: 2,
            strokeLinecap: "round",
            strokeLinejoin: "round",
          })
        : null,
    ])
  );
}

/** A radio selection illustration; siblings have no selection coordination. */
export function Radio(input: RadioProps): JSXElement {
  const theme = themeOf(input),
    props = displayProps(input);
  const accent = props.accent ?? theme.palette.accentMem;
  return controlRoot(
    props,
    theme,
    "Radio",
    icon(theme, [
      jsx("circle", {
        cx: 12,
        cy: 12,
        r: 10,
        fill: theme.palette.card,
        stroke: props.checked ? accent : theme.palette.textMuted,
        strokeWidth: theme.border.width,
      }),
      props.checked
        ? jsx("circle", { cx: 12, cy: 12, r: 5, fill: accent })
        : null,
    ])
  );
}

/** A switch illustration; checked chooses a fixed thumb position. */
export function Switch(input: SwitchProps): JSXElement {
  const theme = themeOf(input),
    props = displayProps(input);
  const accent = props.accent ?? theme.palette.accentMem;
  const height = theme.spacing.lg + theme.spacing.sm;
  const indicator = jsx("svg", {
    width: (height * 11) / 6,
    height,
    viewBox: "0 0 44 24",
    style: { flexShrink: 0 },
    children: [
      jsx("rect", {
        x: 1,
        y: 1,
        width: 42,
        height: 22,
        rx: 11,
        fill: props.checked ? accent : theme.palette.barTrack,
        stroke: props.checked ? accent : theme.palette.border,
        strokeWidth: theme.border.width,
      }),
      jsx("circle", {
        cx: props.checked ? 32 : 12,
        cy: 12,
        r: 8,
        fill: theme.palette.onAccent,
      }),
    ],
  });
  return controlRoot(props, theme, "Switch", indicator);
}

/** A visual button. It cannot submit, focus or trigger an action. */
export function Button(input: ButtonProps): JSXElement {
  const theme = themeOf(input),
    props = displayProps(input);
  const variant = props.variant ?? "primary",
    size = props.size ?? "md";
  const accent =
    props.accent ??
    (variant === "danger" ? theme.palette.barCrit : theme.palette.accentMem);
  const secondary = variant === "secondary";
  const vertical =
    size === "sm"
      ? theme.spacing.xs
      : size === "lg"
      ? theme.spacing.md
      : theme.spacing.sm;
  const horizontal =
    size === "sm"
      ? theme.spacing.sm
      : size === "lg"
      ? theme.spacing.xl
      : theme.spacing.lg;
  const fontSize =
    size === "sm"
      ? theme.typography.sizes.small
      : size === "lg"
      ? theme.typography.sizes.body + theme.spacing.xs
      : theme.typography.sizes.body;
  const foreground = secondary
    ? props.accent ?? theme.palette.textSecondary
    : theme.palette.onAccent;
  const border = secondary ? props.accent ?? theme.palette.border : accent;
  return customizeRoot(
    themedDiv(
      theme,
      `display:flex;align-items:center;justify-content:center;margin:${
        theme.spacing.xs
      }px 0;padding:${vertical}px ${horizontal}px;background:${
        secondary ? theme.palette.surface : accent
      };color:${foreground};border:${cssLength(theme.border.width)} ${
        theme.border.style
      } ${border};border-radius:${cssLength(
        theme.radii.surface
      )};font-size:${fontSize}px;font-weight:${
        theme.typography.weights.strong
      };opacity:${props.disabled ? 0.55 : 1}`,
      labelOf(props)
    ),
    props,
    theme,
    "Button"
  );
}
