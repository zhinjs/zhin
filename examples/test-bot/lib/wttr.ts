const WTTR_TIMEOUT_MS = 20_000;

interface WttrLangValue {
  value?: string;
}

interface WttrCurrent {
  temp_C?: string;
  FeelsLikeC?: string;
  weatherDesc?: WttrLangValue[];
  lang_zh?: WttrLangValue[];
  humidity?: string;
  windspeedKmph?: string;
  winddir16Point?: string;
  precipMM?: string;
  visibility?: string;
}

/** Live weather via wttr.in (shared by command + Agent tool). */
export async function fetchWttrWeather(city: string): Promise<string> {
  const trimmed = city.trim();
  if (!trimmed) return '请提供城市名，例如：weather 成都';

  const url = `https://wttr.in/${encodeURIComponent(trimmed)}?format=j1&lang=zh`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': 'zhin-test-bot/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(WTTR_TIMEOUT_MS),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `天气请求失败: ${detail}`;
  }
  if (!res.ok) return `天气服务 HTTP ${res.status}: ${res.statusText}`;

  const data = (await res.json()) as {
    current_condition?: WttrCurrent[];
    nearest_area?: Array<{ areaName?: WttrLangValue[] }>;
  };
  const cur = data.current_condition?.[0];
  if (!cur) return `未获取到「${trimmed}」的天气数据，请检查城市名`;

  const area = data.nearest_area?.[0]?.areaName?.[0]?.value ?? trimmed;
  const desc = cur.lang_zh?.[0]?.value ?? cur.weatherDesc?.[0]?.value ?? '—';

  return [
    `weather · ${area}`,
    `温度：${cur.temp_C ?? '—'}°C（体感 ${cur.FeelsLikeC ?? '—'}°C）`,
    `天气：${desc}`,
    `湿度：${cur.humidity ?? '—'}%`,
    `风速：${cur.windspeedKmph ?? '—'} km/h ${cur.winddir16Point ?? ''}`.trim(),
    `降水：${cur.precipMM ?? '—'} mm`,
    `能见度：${cur.visibility ?? '—'} km`,
  ].join('\n');
}
