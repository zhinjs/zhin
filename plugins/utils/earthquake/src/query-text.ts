import type { Locale } from 'zhin.js/i18n';
import { messages as t } from './i18n.js';
/** Shared query rendering for the `地震` command and the Agent tool. */
import { formatEventList, formatSourceWarnings } from './format.js';
import type { EarthquakeService } from './service.js';
import { EarthquakeUnavailableError } from './service.js';

export interface QueryTextOptions {
  readonly limit?: number;
  readonly minMagnitude?: number;
  readonly region?: string;
  readonly hours?: number;
}

export const DEFAULT_QUERY_HOURS = 24;
export const MAX_QUERY_HOURS = 168;

export async function renderRecentEarthquakes(service: EarthquakeService, options: QueryTextOptions, locale: Locale = 'zh-CN'): Promise<string> {
  const config = service.config;
  const limit = Math.min(20, Math.max(1, Math.round(options.limit ?? config.queryLimit)));
  const minMagnitude = options.minMagnitude ?? config.queryMinMagnitude;
  const hours = Math.min(MAX_QUERY_HOURS, Math.max(1, Math.round(options.hours ?? DEFAULT_QUERY_HOURS)));
  const region = options.region?.trim();
  const regions = region ? [region] : [];
  try {
    const result = await service.queryRecent({ limit, minMagnitude, regions, hours });
    const scope = region ? `「${region}」` : '';
    const header = t(locale, 'header', { hours, scope, magnitude: minMagnitude.toFixed(1) });
    const warning = formatSourceWarnings(result.outcomes, locale);
    const staleNote = result.stale ? t(locale, 'stale') : undefined;
    if (result.events.length === 0) {
      return [t(locale, 'empty', { header }), staleNote, warning].filter(Boolean).join('\n');
    }
    return formatEventList({
      locale,
      title: t(locale, 'list', { header, count: result.total }),
      events: result.events,
      timezone: config.timezone,
      hiddenCount: result.total - result.events.length,
      footer: [staleNote, warning],
    });
  } catch (error) {
    if (error instanceof EarthquakeUnavailableError) {
      return [t(locale, 'unavailable'), formatSourceWarnings(error.outcomes, locale)].filter(Boolean).join('\n');
    }
    throw error;
  }
}
