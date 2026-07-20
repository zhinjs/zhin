export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—';
  const sign = bytes < 0 ? '-' : '';
  let value = Math.abs(bytes);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${sign}${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}
