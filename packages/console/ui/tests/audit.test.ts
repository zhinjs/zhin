/**
 * Layout audit configuration (audit/layout-audit.mjs, ADR 0063 D20 / 增补 35 第 3 款): the
 * consistency groups know exactly console-ui's own variants, and each soft-card ring has a home.
 * The browser side runs in visual/audit.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain ESM modules without declarations
import { AUDIT_RING_SLOTS, AUDIT_VARIANT_SLOTS } from '../audit/index.mjs';
// @ts-expect-error — plain ESM modules without declarations
import * as tokens from '../tokens/tokens.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (file: string) => readFileSync(join(packageRoot, file), 'utf8');

/** The keys of the `variant: { … }` block of a cva() definition. */
function cvaVariants(file: string): string[] {
  const block = /variants: \{\n\s+variant: \{\n([\s\S]*?)\n\s+\},/u.exec(source(file));
  if (!block) throw new Error(`${file}: no variant block`);
  return [...block[1].matchAll(/^\s+"?([\w-]+)"?:/gmu)].map((match) => match[1]);
}

describe('layout audit: consistency groups', () => {
  it('only console-ui slots with deliberate variants are split, each by its known values', () => {
    expect(Object.keys(AUDIT_VARIANT_SLOTS).sort()).toEqual(['badge', 'button', 'hero', 'icon-button', 'tile']);
    expect([...AUDIT_VARIANT_SLOTS.button.values].sort()).toEqual(cvaVariants('client/components/ui/button.tsx').sort());
    expect([...AUDIT_VARIANT_SLOTS.badge.values].sort()).toEqual(cvaVariants('client/components/ui/badge.tsx').sort());
    expect(AUDIT_VARIANT_SLOTS['icon-button']).toEqual({ attribute: 'data-variant', values: ['flat', 'soft'] });
    expect(AUDIT_VARIANT_SLOTS.hero).toEqual({ attribute: 'data-variant', values: ['hero', 'hero-2'] });
    expect(AUDIT_VARIANT_SLOTS.tile).toEqual({ attribute: 'data-size', values: ['sm', 'lg'] });
    expect(source('client/components/ui/soft.tsx')).toContain('variant?: "white" | "flat" | "soft"');
    expect(source('client/components/ui/soft.tsx')).toContain('variant?: "hero" | "hero-2"');
  });

  it('selection counts only when it is on: aria-current other than "false"', () => {
    const audit = source('audit/layout-audit.mjs');
    expect(audit).toContain("(current !== null && current !== 'false')");
    expect(audit).not.toContain("element.hasAttribute('aria-current')");
  });
});

describe('layout audit: rings', () => {
  it('hairline, selected and field-focus rings belong to their components; every ring is a token', () => {
    expect(AUDIT_RING_SLOTS['hairline-ring'].slots).toEqual(['button', 'badge']);
    expect(AUDIT_RING_SLOTS['selected-bar'].slots).toEqual(['list-row', 'stat-card']);
    expect(AUDIT_RING_SLOTS['selected-bar'].selector).toBe('[data-slot="table"] td');
    expect(AUDIT_RING_SLOTS['field-focus-ring'].slots).toEqual(['input']);
    expect(AUDIT_RING_SLOTS['field-error-ring'].slots).toEqual(['input']);
    for (const name of Object.keys(AUDIT_RING_SLOTS)) expect(tokens.composite[name], name).toBeTypeOf('string');
  });
});
