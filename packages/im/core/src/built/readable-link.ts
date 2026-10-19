/** Only portable, explicit user-facing links survive rich-message text fallback. */
export function readableLinkTarget(value: string): string | undefined {
  const target = value.trim();
  for (const character of target) {
    const code = character.codePointAt(0)!;
    if (code <= 32 || code === 127) return undefined;
  }
  try {
    const url = new URL(target);
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) return undefined;
    // Embedded credentials should never be copied into a chat transcript.
    if (url.username || url.password) return undefined;
    return target;
  } catch { return undefined; }
}

/** Decode entities once; encoded markup remains literal text, never parsed again. */
export function decodeReadableEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi, (entity: string) => {
    const key = entity.slice(1, -1).toLowerCase();
    const named: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (named[key] !== undefined) return named[key];
    const value = key.startsWith('#x') ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return Number.isFinite(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
  });
}
