import type { JSXRenderable } from "@zhin.js/jsx";
import type { ComponentProps } from "./theme.js";

/** Display controls describe a visual state; they never bind browser events. */
export interface ControlLabelProps extends ComponentProps {
  readonly label?: JSXRenderable;
  readonly children?: JSXRenderable;
  readonly disabled?: boolean;
  readonly accent?: string;
}

export interface CheckboxProps extends ControlLabelProps {
  readonly checked?: boolean;
}
export interface RadioProps extends ControlLabelProps {
  readonly checked?: boolean;
}
export interface SwitchProps extends ControlLabelProps {
  readonly checked?: boolean;
}

export interface ButtonProps extends ControlLabelProps {
  readonly variant?: "primary" | "secondary" | "danger";
  readonly size?: "sm" | "md" | "lg";
}
