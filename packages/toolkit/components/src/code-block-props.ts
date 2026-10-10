import type { JSXRenderable } from '@zhin.js/jsx';
import type { ComponentProps } from './theme.js';

export interface CodeBlockProps extends ComponentProps {
  readonly source: string;
  readonly language?: string;
  readonly title?: JSXRenderable;
  readonly lineNumbers?: boolean;
  readonly wrap?: boolean;
  /** A bundled Shiki theme; defaults to the surrounding theme.code.theme. */
  readonly themeName?: string;
}
