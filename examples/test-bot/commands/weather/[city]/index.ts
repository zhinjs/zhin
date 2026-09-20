import { defineCommand } from 'zhin.js/command';
import { fetchWttrWeather } from '../../../lib/wttr.js';

/** Live weather (wttr.in); same source as the researcher's weather Skill Tool. */
export default defineCommand({
  description: '查询城市实时天气（wttr.in）',
  params: { city: { type: 'string' } },
  execute: async ({ params, args }) => {
    const city = [String(params.city ?? ''), ...args].join(' ').trim();
    return fetchWttrWeather(city);
  },
});
