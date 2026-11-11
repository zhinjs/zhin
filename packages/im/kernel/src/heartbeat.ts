/** True when HEARTBEAT.md has no actionable line (only headings, comments and empty checkboxes). */
export function isHeartbeatEmpty(content: string | null): boolean {
  if (!content) return true;
  const skipPatterns = new Set(['- [ ]', '* [ ]', '- [x]', '* [x]']);
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('<!--') || skipPatterns.has(trimmed)) continue;
    return false;
  }
  return true;
}
