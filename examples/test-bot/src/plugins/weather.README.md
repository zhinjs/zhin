# 天气查询插件

这是一个为 Zhin 框架开发的天气查询插件，支持查询多个城市的实时天气信息。

## 功能特性

- ☀️ 查询指定城市的实时天气
- 🌍 查看支持的城市列表
- 📊 对比多个城市的天气情况
- 🎨 美观的格式化输出
- 😊 天气状况 emoji 显示

## 命令列表

### 1. 天气查询

查询指定城市的详细天气信息。

```
天气 <城市名>
```

**示例：**
```
天气 北京
天气 上海
天气 广州
```

**输出示例：**
```
╔═══════════ ☀️ 天气查询 ☀️ ═══════════╗

📍 城市：北京
🌡️  温度：15℃
☀️ 天气：晴
💧 湿度：45%
🌬️  风向：北风
💨 风力：3级

🕐 更新时间：2026-02-04 14:00

╚════════════════════════════════════╝
```

### 2. 天气列表

查看所有支持天气查询的城市。

```
天气列表
```

**输出示例：**
```
╔═══════════ 🌍 支持的城市 ═══════════╗

📋 当前支持以下城市的天气查询：

  1. 北京
  2. 上海
  3. 广州
  4. 深圳
  5. 杭州
  6. 成都

💡 使用方法：天气 <城市名>
📝 示例：天气 北京

╚════════════════════════════════════╝
```

### 3. 天气对比

同时查询并对比多个城市的天气情况。

```
天气对比 <城市1> <城市2> ...
```

**示例：**
```
天气对比 北京 上海
天气对比 广州 深圳 杭州
```

**输出示例：**
```
╔═══════════ 🌍 天气对比 ═══════════╗

📍 北京：15℃ ☀️ 晴
📍 上海：18℃ ⛅ 多云

╚════════════════════════════════════╝
```

## 支持的城市

当前版本支持以下城市：

- 北京
- 上海
- 广州
- 深圳
- 杭州
- 成都

## 技术实现

### 插件结构

插件使用 Zhin 框架的标准插件结构：

```typescript
import { usePlugin, MessageCommand } from "zhin.js";

const { addCommand } = usePlugin();

// 注册命令
addCommand(
  new MessageCommand("天气 <city:text>")
    .desc("查询城市天气", "查询指定城市的实时天气信息")
    .action(async (message, result) => {
      // 命令处理逻辑
    })
);
```

### 生命周期钩子

插件实现了标准的生命周期钩子：

```typescript
const plugin = usePlugin();

plugin.onMounted(() => {
  plugin.logger.info("天气查询插件已加载 🌤️");
});

plugin.onDispose(() => {
  plugin.logger.info("天气查询插件已卸载");
});
```

### 数据格式

天气数据接口定义：

```typescript
interface WeatherData {
  city: string;          // 城市名称
  temperature: string;   // 温度
  weather: string;       // 天气状况
  humidity: string;      // 湿度
  windDirection: string; // 风向
  windPower: string;     // 风力
  reportTime: string;    // 更新时间
}
```

## 扩展开发

### 接入真实天气API

当前版本使用模拟数据，可以通过以下步骤接入真实的天气API：

1. **选择天气API服务**（推荐）：
   - 高德地图天气API
   - 和风天气API
   - OpenWeatherMap API

2. **安装HTTP客户端**：
```bash
npm install axios
```

3. **修改查询逻辑**：
```typescript
import axios from 'axios';

async function fetchWeather(city: string): Promise<WeatherData | null> {
  try {
    const response = await axios.get('https://api.example.com/weather', {
      params: {
        city: city,
        key: 'YOUR_API_KEY'
      }
    });
    
    // 转换API响应为WeatherData格式
    return {
      city: response.data.city,
      temperature: response.data.temperature,
      weather: response.data.weather,
      // ... 其他字段
    };
  } catch (error) {
    console.error('天气查询失败:', error);
    return null;
  }
}
```

### 添加更多功能

可以扩展的功能建议：

- 🔮 天气预报（未来3-7天）
- 🌡️ 温度趋势图
- ⚠️ 天气预警信息
- 🌈 空气质量指数（AQI）
- 🌙 日出日落时间
- 📍 基于地理位置的自动查询

### 添加缓存机制

为了减少API调用，可以添加缓存：

```typescript
const weatherCache = new Map<string, { data: WeatherData, timestamp: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30分钟

async function getCachedWeather(city: string): Promise<WeatherData | null> {
  const cached = weatherCache.get(city);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  const data = await fetchWeather(city);
  if (data) {
    weatherCache.set(city, { data, timestamp: Date.now() });
  }
  
  return data;
}
```

## 使用方法

1. 确保插件文件位于 `examples/test-bot/src/plugins/weather.ts`
2. Zhin 会自动加载该插件
3. 启动机器人后即可使用天气查询命令

```bash
cd examples/test-bot
npm run dev
```

## 注意事项

- 当前使用模拟数据，仅供测试使用
- 生产环境建议接入真实的天气API
- 注意API调用频率限制
- 建议添加错误处理和重试机制

## 许可证

MIT
