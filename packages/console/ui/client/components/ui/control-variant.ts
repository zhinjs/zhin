/**
 * Look of the text-like controls (Input, Textarea, SelectTrigger, SearchableSelectField,
 * DateField, DateTimeField), ADR 0063 D29 / soft cards D39:
 *   default  48 tall, radius 14, a 1px control border on the surface; hover muted, focus ink
 *            border + 2px ring, errors via `aria-invalid`
 *   ghost    no border and no fill until hovered, focused or open; for secondary fields (fallback
 *            models, unset slots) so a long form does not become a wall of boxes
 * The look lives in the `console-field` class (components.css); `data-variant="ghost"` switches it.
 */
export type ControlVariant = 'default' | 'ghost'

/** Classes of a text-like control (merged with `cn`). */
export function controlVariantClass(variant: ControlVariant | null | undefined): string {
  void variant
  return 'console-field'
}
