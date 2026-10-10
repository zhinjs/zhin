export interface TailwindStyleOptions {
  /** Tailwind theme variables, for example --color-brand or --spacing. */
  readonly theme?: Readonly<Record<`--${string}`, string>>;
}

/** A frozen object suitable for native style, custom.style and theme.components. */
export type TailwindStyle = Readonly<Record<string, string>>;

/** Class order follows the official generated stylesheet, not argument order. */
export type TailwindStyleResolver = (classes: string) => TailwindStyle;
