import { DEFAULT_THEME } from "./theme.js";

export const LABEL_W = DEFAULT_THEME.layout.labelWidth;
export const LABEL_W_HALF = DEFAULT_THEME.layout.compactLabelWidth;

export function formatCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function barTone(
  percent: number,
  accent: string,
  palette = DEFAULT_THEME.palette
): string {
  if (percent >= 90) return palette.barCrit;
  if (percent >= 75) return palette.barWarn;
  return accent;
}

export function tint(hex: string, alpha: number): string {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) return hex;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function rankAccent(
  rank: number,
  palette = DEFAULT_THEME.palette
): string {
  if (rank === 1) return palette.barWarn;
  if (rank === 2) return palette.textMuted;
  if (rank === 3) return palette.accentRank;
  return palette.accentMem;
}
