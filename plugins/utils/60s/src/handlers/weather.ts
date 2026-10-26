import type { Locale } from 'zhin.js/i18n';
import { messages as t } from '../i18n.js';
import { asRecord, asString } from '../api.js';
import type { SixtySClient } from '../client.js';

export default async function (client: SixtySClient, args: { city: string }, locale?: Locale) {
  const data = await client.fetch('/weather', { query: args.city }, locale);
  const w = asRecord(data.weather);
  const aq = asRecord(data.air_quality);
  const loc = asRecord(data.location);
  const cityName = asString(loc.city) || asString(loc.name) || args.city;
  const lines = [
    t(locale, 'weather', { city: cityName }),
    '',
    t(locale, 'temperature', { value: asString(w.temperature) }),
    t(locale, 'condition', { value: asString(w.condition) }),
    t(locale, 'humidity', { value: asString(w.humidity) }),
    t(locale, 'wind', { direction: asString(w.wind_direction), power: asString(w.wind_power) }),
  ];
  if (Object.keys(aq).length > 0) {
    const quality = asString(aq.quality);
    lines.push(t(locale, 'air', { value: `${quality}${aq.aqi ? ` (AQI ${asString(aq.aqi)})` : ''}` }));
  }
  return lines.join('\n');
}
