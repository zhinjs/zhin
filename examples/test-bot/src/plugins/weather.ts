import {
  usePlugin,
  MessageCommand,
} from "zhin.js";

const { addCommand } = usePlugin();

// 天气数据接口类型定义
interface WeatherData {
  city: string;
  temperature: string;
  weather: string;
  humidity: string;
  windDirection: string;
  windPower: string;
  reportTime: string;
}

// 模拟天气数据（实际项目中应该调用真实的天气API）
const mockWeatherData: Record<string, WeatherData> = {
  "北京": {
    city: "北京",
    temperature: "15℃",
    weather: "晴",
    humidity: "45%",
    windDirection: "北风",
    windPower: "3级",
    reportTime: "2026-02-04 14:00"
  },
  "上海": {
    city: "上海",
    temperature: "18℃",
    weather: "多云",
    humidity: "60%",
    windDirection: "东南风",
    windPower: "2级",
    reportTime: "2026-02-04 14:00"
  },
  "广州": {
    city: "广州",
    temperature: "22℃",
    weather: "阴",
    humidity: "75%",
    windDirection: "南风",
    windPower: "1级",
    reportTime: "2026-02-04 14:00"
  },
  "深圳": {
    city: "深圳",
    temperature: "23℃",
    weather: "小雨",
    humidity: "80%",
    windDirection: "东南风",
    windPower: "2级",
    reportTime: "2026-02-04 14:00"
  },
  "杭州": {
    city: "杭州",
    temperature: "16℃",
    weather: "晴",
    humidity: "55%",
    windDirection: "西北风",
    windPower: "2级",
    reportTime: "2026-02-04 14:00"
  },
  "成都": {
    city: "成都",
    temperature: "14℃",
    weather: "多云",
    humidity: "70%",
    windDirection: "无持续风向",
    windPower: "微风",
    reportTime: "2026-02-04 14:00"
  }
};

// 根据天气状况返回对应的emoji
function getWeatherEmoji(weather: string): string {
  const weatherMap: Record<string, string> = {
    "晴": "☀️",
    "多云": "⛅",
    "阴": "☁️",
    "小雨": "🌧️",
    "中雨": "🌧️",
    "大雨": "⛈️",
    "雷阵雨": "⛈️",
    "雪": "❄️",
    "雾": "🌫️",
    "霾": "😷"
  };
  return weatherMap[weather] || "🌡️";
}

// 格式化天气信息
function formatWeatherInfo(data: WeatherData): string {
  const emoji = getWeatherEmoji(data.weather);
  
  return [
    `╔═══════════ ${emoji} 天气查询 ${emoji} ═══════════╗`,
    "",
    `📍 城市：${data.city}`,
    `🌡️  温度：${data.temperature}`,
    `${emoji} 天气：${data.weather}`,
    `💧 湿度：${data.humidity}`,
    `🌬️  风向：${data.windDirection}`,
    `💨 风力：${data.windPower}`,
    "",
    `🕐 更新时间：${data.reportTime}`,
    "",
    "╚════════════════════════════════════╝"
  ].join("\n");
}

// 注册天气查询命令
addCommand(
  new MessageCommand("天气 <city:text>")
    .desc("查询城市天气", "查询指定城市的实时天气信息")
    .usage("天气 <城市名>")
    .examples("天气 北京", "天气 上海", "天气 广州")
    .action(async (message, result) => {
      const city = result.params.city;
      
      // 查询天气数据
      const weatherData = mockWeatherData[city];
      
      if (!weatherData) {
        return [
          "❌ 抱歉，暂不支持该城市的天气查询",
          "",
          "💡 当前支持的城市：",
          "  • 北京",
          "  • 上海",
          "  • 广州",
          "  • 深圳",
          "  • 杭州",
          "  • 成都",
          "",
          "📝 使用示例：天气 北京"
        ].join("\n");
      }
      
      return formatWeatherInfo(weatherData);
    })
);

// 注册天气列表命令
addCommand(
  new MessageCommand("天气列表")
    .desc("查看支持的城市", "显示所有支持天气查询的城市列表")
    .usage("天气列表")
    .examples("天气列表")
    .action(() => {
      const cities = Object.keys(mockWeatherData);
      
      return [
        "╔═══════════ 🌍 支持的城市 ═══════════╗",
        "",
        "📋 当前支持以下城市的天气查询：",
        "",
        ...cities.map((city, index) => `  ${index + 1}. ${city}`),
        "",
        "💡 使用方法：天气 <城市名>",
        "📝 示例：天气 北京",
        "",
        "╚════════════════════════════════════╝"
      ].join("\n");
    })
);

// 注册多城市天气对比命令
addCommand(
  new MessageCommand("天气对比 [...cities:text]")
    .desc("对比多个城市天气", "同时查询并对比多个城市的天气情况")
    .usage("天气对比 <城市1> <城市2> ...")
    .examples("天气对比 北京 上海", "天气对比 广州 深圳 杭州")
    .action(async (message, result) => {
      const cities = result.params.cities;
      
      if (!cities || cities.length === 0) {
        return [
          "❌ 请指定要对比的城市",
          "",
          "💡 使用方法：天气对比 <城市1> <城市2> ...",
          "📝 示例：天气对比 北京 上海"
        ].join("\n");
      }
      
      const lines = [
        "╔═══════════ 🌍 天气对比 ═══════════╗",
        ""
      ];
      
      const validCities: string[] = [];
      const invalidCities: string[] = [];
      
      cities.forEach((city: string) => {
        const weatherData = mockWeatherData[city];
        if (weatherData) {
          validCities.push(city);
          const emoji = getWeatherEmoji(weatherData.weather);
          lines.push(`📍 ${city}：${weatherData.temperature} ${emoji} ${weatherData.weather}`);
        } else {
          invalidCities.push(city);
        }
      });
      
      if (invalidCities.length > 0) {
        lines.push("");
        lines.push(`⚠️  不支持的城市：${invalidCities.join("、")}`);
      }
      
      lines.push("");
      lines.push("╚════════════════════════════════════╝");
      
      if (validCities.length === 0) {
        return "❌ 没有找到支持的城市，请使用 '天气列表' 查看支持的城市";
      }
      
      return lines.join("\n");
    })
);

// 插件加载日志
const plugin = usePlugin();
plugin.onMounted(() => {
  plugin.logger.info("天气查询插件已加载 🌤️");
});

plugin.onDispose(() => {
  plugin.logger.info("天气查询插件已卸载");
});
