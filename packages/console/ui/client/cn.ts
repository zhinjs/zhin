import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

export type { ClassValue } from 'clsx';

/**
 * Theme keys of `@zhin.js/console-ui/theme.css` (see `tokens/tokens.mjs`, mirrored in
 * `generated/scale.json` → `tailwind`). tailwind-merge only knows Tailwind's default scale,
 * so without these it reads `text-label` / `text-body` as a text *colour* and drops a
 * variant's `text-*` colour (or the size) when both are present. `tests/cn.test.ts` keeps
 * this list in step with the generated scale.
 */
export const CN_THEME = {
  text: ['label', 'body', 'section', 'title', 'display'],
  'font-weight': ['regular', 'medium', 'strong'],
  radius: ['0', '1', '2', '3', '4', 'card', 'card-edge', 'control', 'check', 'segment', 'badge', 'popover', 'popover-item', 'dialog', 'sheet'],
  shadow: ['e1', 'e2', 'e3', 'card', 'card-hover', 'popover', 'dialog'],
  breakpoint: ['sm', 'md', 'lg', 'xl'],
} as const;

const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: [...CN_THEME.text],
      'font-weight': [...CN_THEME['font-weight']],
      radius: [...CN_THEME.radius],
      shadow: [...CN_THEME.shadow],
      breakpoint: [...CN_THEME.breakpoint],
    },
    classGroups: {
      'border-w': [{ border: ['hairline', 'focus'] }],
    },
  },
});

/** Joins class names and resolves Tailwind conflicts (later classes win). */
export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
