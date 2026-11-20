/**
 * Escapes text for HTML element content and quoted attribute values: `&`, `<`, `>`, `"` and `'`.
 * The one escaper of the IM stack's HTML strings (AI output, Console page shells, plugin pages,
 * #1250 b80). `@zhin.js/jsx` keeps the same escaper for its serializer, since that leaf package
 * depends on nothing but the IM contract; `tests/contracts/escape-html.test.ts` locks the two together.
 */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
