import { fetchApi } from '../api.js';

export default async function (args: { city: string }) {
  const data = await fetchApi<any>('/weather', { query: args.city });
  const w = data.weather;
  const aq = data.air_quality;
  const loc = data.location;
  const cityName = loc?.city || loc?.name || args.city;
  const lines = [
    `🌤️ ${cityName} 天气`,
    '',
    `🌡️ 温度: ${w.temperature}°C`,
    `☁️ 天气: ${w.condition}`,
    `💧 湿度: ${w.humidity}%`,
    `💨 风: ${w.wind_direction} ${w.wind_power}`,
  ];
  if (aq) {
    const quality = aq.quality || '';
    lines.push(`🌬️ 空气: ${quality}${aq.aqi ? ` (AQI ${aq.aqi})` : ''}`);
  }
  return lines.join('\n');
}
