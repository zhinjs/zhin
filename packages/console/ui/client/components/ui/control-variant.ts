/**
 * Look of the text-like controls (Input, Textarea, SelectTrigger, SearchableSelectField,
 * DateField, DateTimeField), ADR 0063 D29:
 *   default  hairline border on a card surface
 *   ghost    no border and no fill until hovered or focused; for secondary fields (fallback
 *            models, unset slots) so a long form does not become a wall of boxes
 */
export type ControlVariant = 'default' | 'ghost'

const DEFAULT = 'border-input bg-card hover:border-foreground/45 focus-visible:border-brand-text disabled:bg-muted'
const GHOST = 'border-transparent bg-transparent hover:border-input focus-visible:border-brand-text aria-expanded:border-input data-[state=open]:border-input disabled:bg-transparent'

/** Border and surface classes of a control variant (Tailwind utilities, merged with `cn`). */
export function controlVariantClass(variant: ControlVariant | null | undefined): string {
  return variant === 'ghost' ? GHOST : DEFAULT
}
