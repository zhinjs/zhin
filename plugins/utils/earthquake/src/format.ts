import type { Locale } from 'zhin.js/i18n';
import { messages as t } from './i18n.js';
/** Plain-text rendering, safe for every adapter (no markup, no platform segments). */
import { eventMagnitude } from './filters.js';
import type { EarthquakeEvent, SourceOutcome } from './types.js';

const SOURCE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  cenc: 'CENC',
  usgs: 'USGS',
});

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.toUpperCase();
}

export function formatEventTime(time: number, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(time)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function formatMagnitude(value: number): string {
  return value.toFixed(1);
}

/** One event in 2–3 lines: headline, time/depth, sources (+ link when available). */
export function formatEvent(event: EarthquakeEvent, timezone: string, locale: Locale = 'zh-CN'): string {
  const primary = event.primary;
  const headline = `M${formatMagnitude(eventMagnitude(event))} ${primary.location}`;
  const details = [`${formatEventTime(primary.time, timezone)} (${timezone})`];
  if (primary.depthKm !== undefined) {
    details.push(t(locale, 'depth', { depth: Math.round(primary.depthKm) }));
  }
  details.push(`${primary.latitude.toFixed(2)}, ${primary.longitude.toFixed(2)}`);
  const sources = event.reports.map((report) => `${sourceLabel(report.source)} M${formatMagnitude(report.magnitude)}`);
  const lines = [headline, `  ${details.join(' · ')}`, `  ${t(locale, 'sources', { sources: sources.join(' / ') })}`];
  const link = event.reports.find((report) => report.url)?.url;
  if (link) {
    lines.push(`  ${link}`);
  }
  return lines.join('\n');
}

export function formatSourceWarnings(outcomes: readonly SourceOutcome[], locale: Locale = 'zh-CN'): string | undefined {
  const failed = outcomes.filter((outcome) => !outcome.ok);
  if (failed.length === 0) return undefined;
  const parts = failed.map((outcome) => {
    const reason = outcome.skipped ? t(locale, 'cooling') : outcome.error ?? t(locale, 'failed');
    return `${sourceLabel(outcome.source)}（${reason}）`;
  });
  return t(locale, 'sourceWarning', { sources: parts.join(locale === 'en' ? '; ' : '；') });
}

export function formatEventList(options: {
  readonly title: string;
  readonly locale?: Locale;
  readonly events: readonly EarthquakeEvent[];
  readonly timezone: string;
  readonly hiddenCount?: number;
  readonly footer?: readonly (string | undefined)[];
}): string {
  const blocks = options.events.map((event, index) => `${index + 1}. ${formatEvent(event, options.timezone, options.locale)}`);
  const lines = [options.title, ...blocks];
  if (options.hiddenCount && options.hiddenCount > 0) {
    lines.push(t(options.locale ?? 'zh-CN', 'hidden', { count: options.hiddenCount }));
  }
  for (const extra of options.footer ?? []) {
    if (extra) lines.push(extra);
  }
  return lines.join('\n');
}
