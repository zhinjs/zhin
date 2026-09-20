import { asRecord, asString } from '../api.js';
import type { SixtySClient } from '../client.js';

export default async function (client: SixtySClient, args: { city: string }) {
  const data = await client.fetch('/weather', { query: args.city });
  const w = asRecord(data.weather);
  const aq = asRecord(data.air_quality);
  const loc = asRecord(data.location);
  const cityName = asString(loc.city) || asString(loc.name) || args.city;
  const lines = [
    `🌤️ ${cityName} 天气`,
    '',
    `🌡️ 温度: ${asString(w.temperature)}°C`,
    `☁️ 天气: ${asString(w.condition)}`,
    `💧 湿度: ${asString(w.humidity)}%`,
    `💨 风: ${asString(w.wind_direction)} ${asString(w.wind_power)}`,
  ];
  if (Object.keys(aq).length > 0) {
    const quality = asString(aq.quality);
    lines.push(`🌬️ 空气: ${quality}${aq.aqi ? ` (AQI ${asString(aq.aqi)})` : ''}`);
  }
  return lines.join('\n');
}
