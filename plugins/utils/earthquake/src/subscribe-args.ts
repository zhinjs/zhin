import type { Locale } from 'zhin.js/i18n';
import { messages as t } from './i18n.js';
/**
 * Parses `地震 订阅 [最小震级] [地区...]` arguments.
 * The first token may be a magnitude such as `5`, `5.5`, `M5` or `5级`; the rest are regions.
 */
import { MAX_REGIONS_PER_SUBSCRIPTION } from './config.js';

export interface SubscribeArgs {
  readonly minMagnitude?: number;
  readonly regions: readonly string[];
}

const MAGNITUDE_TOKEN = /^(?:m)?(\d{1,2}(?:\.\d)?)(?:级)?$/iu;

export function parseMagnitudeToken(token: string): number | undefined {
  const match = MAGNITUDE_TOKEN.exec(token.trim());
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0 || value > 10) return undefined;
  return value;
}

export function parseSubscribeArgs(tokens: readonly string[], locale: Locale = 'zh-CN'): SubscribeArgs | { readonly error: string } {
  const cleaned = tokens.map((token) => token.trim()).filter((token) => token.length > 0);
  let minMagnitude: number | undefined;
  const regions: string[] = [];
  for (const [index, token] of cleaned.entries()) {
    const magnitude = parseMagnitudeToken(token);
    if (index === 0 && magnitude !== undefined) {
      minMagnitude = magnitude;
      continue;
    }
    if (magnitude !== undefined) {
      return { error: t(locale, 'order') };
    }
    if (token.length > 20) {
      return { error: t(locale, 'longRegion', { region: token.slice(0, 20) }) };
    }
    if (!regions.includes(token)) regions.push(token);
  }
  if (regions.length > MAX_REGIONS_PER_SUBSCRIPTION) {
    return { error: t(locale, 'maxRegions', { count: MAX_REGIONS_PER_SUBSCRIPTION }) };
  }
  return { minMagnitude, regions };
}
