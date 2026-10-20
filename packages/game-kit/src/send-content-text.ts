/**
 * Extract plain text from SendContent (skip buttons / keyboard) for text-only game paths.
 */

export function plainTextFromSendContent(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(plainTextFromSendContent)
      .filter((s) => s.length > 0)
      .join('\n');
  }
  if (typeof content === 'object' && content !== null && 'type' in content) {
    const seg = content as { type: unknown; data?: { text?: unknown; label?: unknown } };
    if (seg.type === 'text') return String(seg.data?.text ?? '');
    // buttons / keyboard / other segments omitted in text-only mode
    return '';
  }
  return '';
}
