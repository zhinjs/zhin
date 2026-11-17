import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cn, CN_THEME } from '../client/cn.js';
import { buttonVariants } from '../client/components/ui/button.js';

const scale = JSON.parse(readFileSync(fileURLToPath(new URL('../client/styles/generated/scale.json', import.meta.url)), 'utf8'));

describe('cn() knows the console-ui Tailwind theme', () => {
  it('keeps a text colour next to a custom font size', () => {
    expect(cn('text-label', 'text-destructive')).toBe('text-label text-destructive');
    expect(cn('text-destructive', 'text-body')).toBe('text-destructive text-body');
  });

  it('still resolves real conflicts inside one group', () => {
    expect(cn('text-label', 'text-body')).toBe('text-body');
    expect(cn('font-regular', 'font-strong')).toBe('font-strong');
    expect(cn('rounded-control', 'rounded-card')).toBe('rounded-card');
    expect(cn('shadow-e1', 'shadow-e2')).toBe('shadow-e2');
  });

  it('keeps the variant colour on small buttons', () => {
    for (const variant of ['destructive', 'destructive-outline', 'link'] as const) {
      const classes = buttonVariants({ variant, size: 'sm' }).split(/\s+/u);
      expect(classes).toContain('text-label');
      expect(classes.some(name => /^text-(?!label$)/u.test(name))).toBe(true);
    }
    expect(buttonVariants({ variant: 'destructive' }).split(/\s+/u)).toContain('text-body');
  });

  it('matches the generated scale', () => {
    expect([...CN_THEME.text]).toEqual(scale.tailwind.textKeys);
    expect([...CN_THEME['font-weight']]).toEqual(scale.tailwind.fontWeightKeys);
    expect([...CN_THEME.breakpoint]).toEqual(scale.tailwind.breakpointKeys);
    expect(new Set(CN_THEME.radius)).toEqual(new Set(scale.tailwind.radiusKeys.filter((key: string) => !['none', 'full'].includes(key))));
    expect(new Set(CN_THEME.shadow)).toEqual(new Set(scale.tailwind.shadowKeys.filter((key: string) => key !== 'none')));
  });
});
