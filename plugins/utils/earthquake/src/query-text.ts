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

export async function renderRecentEarthquakes(service: EarthquakeService, options: QueryTextOptions): Promise<string> {
  const config = service.config;
  const limit = Math.min(20, Math.max(1, Math.round(options.limit ?? config.queryLimit)));
  const minMagnitude = options.minMagnitude ?? config.queryMinMagnitude;
  const hours = Math.min(MAX_QUERY_HOURS, Math.max(1, Math.round(options.hours ?? DEFAULT_QUERY_HOURS)));
  const region = options.region?.trim();
  const regions = region ? [region] : [];
  try {
    const result = await service.queryRecent({ limit, minMagnitude, regions, hours });
    const scope = region ? `「${region}」` : '';
    const header = `最近 ${hours} 小时${scope} M${minMagnitude.toFixed(1)} 以上地震`;
    const warning = formatSourceWarnings(result.outcomes);
    const staleNote = result.stale ? '⚠️ 数据源暂不可用，以下为上次成功获取的数据' : undefined;
    if (result.events.length === 0) {
      return [`${header}：暂无记录`, staleNote, warning].filter(Boolean).join('\n');
    }
    return formatEventList({
      title: `${header}（共 ${result.total} 条）：`,
      events: result.events,
      timezone: config.timezone,
      hiddenCount: result.total - result.events.length,
      footer: [staleNote, warning],
    });
  } catch (error) {
    if (error instanceof EarthquakeUnavailableError) {
      return `暂时无法获取地震数据，请稍后再试。\n${error.message}`;
    }
    throw error;
  }
}
