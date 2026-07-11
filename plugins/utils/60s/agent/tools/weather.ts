import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineTool<{ city: string }>({
  description: "查询指定城市的当前天气信息",
  inputSchema: z.object({ city: z.string() }),
  keywords: ["天气", "气温", "温度", "下雨", "晴天", "阴天", "weather"],
  tags: ["天气", "生活", "查询"],
  async execute(input) {
    const handler = (await import('../../tools/weather/handler.js')).default;
    return handler(input);
  },
});
