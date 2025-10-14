# JSX 支持

Zhin.js 支持使用 JSX 语法构建富文本消息，让消息构建更加直观和易于维护。

## 基础使用

### 创建 JSX 插件

将插件文件扩展名改为 `.tsx`：

```tsx
// src/plugins/test-jsx.tsx
import { addCommand, MessageCommand } from 'zhin.js'

addCommand(new MessageCommand('test-jsx')
  .action(async (message, result) => {
    return (
      <>
        hello world
        <face id={66}/>
      </>
    )
  })
)
```

### JSX 元素类型

JSX 会被编译为 MessageElement 数组：

```tsx
// JSX
<>
  hello world
  <face id={66}/>
</>

// 编译为
[
  { type: 'text', data: { text: 'hello world\n' } },
  { type: 'face', data: { id: 66 } }
]
```

## 内置组件

### text - 文本

```tsx
<text>这是文本消息</text>

// 或直接使用字符串
<>
  这也是文本消息
</>
```

### at - @提及

```tsx
// @指定用户
<at id="123456789" name="张三"/>

// @所有人
<at id="all"/>
```

### face - 表情

```tsx
// QQ 表情
<face id={66}/>  {/* 爱心 */}
<face id={14}/>  {/* 微笑 */}
```

### image - 图片

```tsx
// 网络图片
<image url="https://example.com/image.jpg"/>

// 本地图片
<image file="./images/photo.jpg"/>

// Base64 图片
<image data="data:image/png;base64,..."/>
```

### audio - 音频

```tsx
<audio url="https://example.com/audio.mp3"/>
<audio file="./audio/sound.mp3"/>
```

### video - 视频

```tsx
<video url="https://example.com/video.mp4"/>
<video file="./video/movie.mp4"/>
```

### reply - 引用回复

```tsx
// 引用当前消息
<reply id={message.$id}/>

// 引用指定消息
<reply id="message_id_123"/>
```

## 动态内容

### 变量插值

```tsx
addCommand(new MessageCommand('greet <name>')
  .action(async (message, result) => {
    const name = result.params.name
    const hour = new Date().getHours()
    const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
    
    return (
      <>
        <at id={message.$sender.id}/>
        {greeting}，{name}！
      </>
    )
  })
)
```

### 条件渲染

```tsx
addCommand(new MessageCommand('weather')
  .action(async () => {
    const isRaining = Math.random() > 0.5
    
    return (
      <>
        今天天气：
        {isRaining ? (
          <>
            <face id={9}/> {/* 雨 */}
            下雨了，记得带伞
          </>
        ) : (
          <>
            <face id={14}/> {/* 晴天 */}
            天气晴朗
          </>
        )}
      </>
    )
  })
)
```

### 列表渲染

```tsx
addCommand(new MessageCommand('menu')
  .action(async () => {
    const items = [
      { name: '帮助', command: 'help' },
      { name: '状态', command: 'status' },
      { name: '签到', command: 'checkin' }
    ]
    
    return (
      <>
        <text>📋 菜单</text>
        {items.map((item, index) => (
          <>
            {index + 1}. {item.name} - 使用 {item.command}
          </>
        ))}
      </>
    )
  })
)
```

## 自定义组件

### 定义组件

```tsx
import { addComponent, ComponentContext } from 'zhin.js'

// 定义一个问候组件
addComponent(async function greeting(
  props: { name: string; emoji?: string },
  context: ComponentContext
) {
  const emoji = props.emoji || '👋'
  return `${emoji} 你好，${props.name}！`
})

// 使用组件
addCommand(new MessageCommand('hi <name>')
  .action(async (message, result) => {
    return (
      <>
        <greeting name={result.params.name} emoji="😊"/>
      </>
    )
  })
)
```

### 组件组合

```tsx
// 用户卡片组件
addComponent(async function userCard(
  props: { userId: string; username: string; level: number; points: number },
  context: ComponentContext
) {
  return (
    <>
      <at id={props.userId}/>
      📇 用户信息
      等级: Lv.{props.level}
      积分: {props.points}
    </>
  )
})

// 使用组件
addCommand(new MessageCommand('info')
  .action(async (message) => {
    return (
      <>
        <userCard
          userId={message.$sender.id}
          username={message.$sender.name}
          level={5}
          points={500}
        />
      </>
    )
  })
)
```

## 平台特定组件

### ICQQ 专属

```tsx
// JSON 卡片
<json data={JSON.stringify({
  app: "com.tencent.miniapp",
  desc: "描述",
  view: "music",
  ver: "0.0.0.1",
  prompt: "提示",
  meta: {
    music: {
      action: "play",
      android_pkg_name: "",
      app_type: 1,
      appid: 100497308,
      title: "歌曲名",
      desc: "歌手名",
      preview: "封面URL",
      musicUrl: "音乐URL",
      tag: "QQ音乐"
    }
  }
})}/>

// Markdown
<markdown content="# 标题\n**粗体** *斜体*"/>

// 按钮
<button id="btn_1" label="点击我"/>
```

### Discord 专属

```tsx
// Embed
<embed
  title="标题"
  description="描述"
  color={0x00ff00}
  url="https://example.com"
  author={{ name: "作者", icon_url: "..." }}
  thumbnail={{ url: "..." }}
  fields={[
    { name: "字段1", value: "值1", inline: true },
    { name: "字段2", value: "值2", inline: true }
  ]}
  footer={{ text: "页脚", icon_url: "..." }}
  timestamp={new Date().toISOString()}
/>
```

## 实战示例

### 天气预报

```tsx
import { addCommand, MessageCommand } from 'zhin.js'

interface Weather {
  city: string
  temperature: number
  condition: 'sunny' | 'cloudy' | 'rainy'
  humidity: number
  wind: string
}

async function getWeather(city: string): Promise<Weather> {
  // 实际应用中调用天气 API
  return {
    city,
    temperature: 25,
    condition: 'sunny',
    humidity: 60,
    wind: '东南风3级'
  }
}

addCommand(new MessageCommand('weather <city>')
  .action(async (message, result) => {
    const weather = await getWeather(result.params.city)
    
    const conditionEmoji = {
      sunny: '☀️',
      cloudy: '☁️',
      rainy: '🌧️'
    }
    
    return (
      <>
        <text>🌤️ {weather.city}天气预报</text>
        
        {conditionEmoji[weather.condition]}
        {weather.condition === 'sunny' && '晴天'}
        {weather.condition === 'cloudy' && '多云'}
        {weather.condition === 'rainy' && '下雨'}
        
        <text>🌡️ 温度：{weather.temperature}°C</text>
        <text>💧 湿度：{weather.humidity}%</text>
        <text>💨 风力：{weather.wind}</text>
        
        {weather.condition === 'rainy' && (
          <text>☔ 记得带伞哦！</text>
        )}
      </>
    )
  })
)
```

### 音乐搜索

基于 test-bot 的真实示例：

```tsx
import { addCommand, MessageCommand, useContext, usePrompt } from 'zhin.js'

interface Music {
  type: 'qq' | '163'
  id: string
  name: string
  artist?: string
}

async function searchMusic(keyword: string): Promise<Music[]> {
  // 调用音乐API搜索
  // 这里简化为示例
  return [
    { type: 'qq', id: '001', name: '歌曲1', artist: '歌手1' },
    { type: '163', id: '002', name: '歌曲2', artist: '歌手2' }
  ]
}

useContext('icqq', (adapter) => {
  addCommand(new MessageCommand('点歌 <keyword>')
    .scope('icqq')
    .action(async (message, result) => {
      const keyword = result.params.keyword
      const musicList = await searchMusic(keyword)
      
      if (musicList.length === 0) {
        return <>❌ 没有找到相关歌曲</>
      }
      
      // 使用 Prompt 让用户选择
      const prompt = usePrompt(message)
      const musicId = await prompt.pick('请选择搜索结果', {
        type: 'text',
        options: musicList.map(music => ({
          label: `${music.name} - ${music.artist} (from ${music.type})`,
          value: music.id
        }))
      })
      
      if (!musicId) {
        return <>已取消</>
      }
      
      const music = musicList.find(m => m.id === musicId)!
      
      // 发送音乐卡片
      return (
        <>
          <text>🎵 正在播放：{music.name}</text>
          <text>🎤 歌手：{music.artist}</text>
          {/* 实际应用中这里会发送音乐卡片 */}
        </>
      )
    })
  )
})
```

### 用户信息卡片

```tsx
import { addCommand, MessageCommand, onDatabaseReady } from 'zhin.js'

onDatabaseReady(async (db) => {
  const points = db.model('points')
  
  addCommand(new MessageCommand('card')
    .action(async (message) => {
      const user = await points.select({
        user_id: message.$sender.id
      })
      
      if (user.length === 0) {
        return (
          <>
            <at id={message.$sender.id}/>
            你还没有注册哦
          </>
        )
      }
      
      const userData = user[0]
      const progress = (userData.points % 100) / 100
      const progressBar = '█'.repeat(Math.floor(progress * 10)) + 
                         '░'.repeat(10 - Math.floor(progress * 10))
      
      return (
        <>
          <at id={message.$sender.id}/>
          <text>━━━━━━━━━━━━━━━</text>
          <text>📇 用户信息卡片</text>
          <text>━━━━━━━━━━━━━━━</text>
          
          <text>👤 用户：{userData.username}</text>
          <text>⭐ 等级：Lv.{userData.level}</text>
          <text>💰 积分：{userData.points}</text>
          
          <text>📊 升级进度</text>
          <text>[{progressBar}] {Math.floor(progress * 100)}%</text>
          
          <text>━━━━━━━━━━━━━━━</text>
        </>
      )
    })
  )
})
```

## 性能优化

### 1. 缓存组件

```tsx
const cache = new Map()

addComponent(async function expensiveComponent(
  props: { data: string },
  context: ComponentContext
) {
  if (cache.has(props.data)) {
    return cache.get(props.data)
  }
  
  // 耗时操作
  const result = await heavyComputation(props.data)
  cache.set(props.data, result)
  
  return result
})
```

### 2. 懒加载

```tsx
addCommand(new MessageCommand('detail <id>')
  .action(async (message, result) => {
    // 先返回基本信息
    await message.$reply(<>⏳ 加载中...</>)
    
    // 异步加载详细信息
    const details = await fetchDetails(result.params.id)
    
    return (
      <>
        <text>📋 详细信息</text>
        {details.map(item => (
          <text>{item.name}: {item.value}</text>
        ))}
      </>
    )
  })
)
```

### 3. 避免过深嵌套

```tsx
// ❌ 不好的做法
<>
  {items.map(item => (
    <>
      {item.subItems.map(sub => (
        <>
          {sub.details.map(detail => (
            <>{detail}</>
          ))}
        </>
      ))}
    </>
  ))}
</>

// ✅ 好的做法
const flatList = items.flatMap(item => 
  item.subItems.flatMap(sub => sub.details)
)

<>
  {flatList.map(detail => <>{detail}</>)}
</>
```

## 调试技巧

### 1. 查看编译结果

```tsx
const elements = (
  <>
    hello <face id={66}/>
  </>
)

console.log('编译结果:', JSON.stringify(elements, null, 2))
```

### 2. 条件断点

```tsx
addCommand(new MessageCommand('debug')
  .action(async (message) => {
    const result = (
      <>
        {message.$sender.id === 'debug_user' && (
          <text>调试模式</text>
        )}
        正常内容
      </>
    )
    
    return result
  })
)
```

## 下一步

- 💬 [Prompt 交互](/guide/prompts) - 创建交互式对话
- 🎨 [组件系统](/guide/components) - 深入了解组件开发
- 💡 [实战示例](/examples/jsx-components) - 更多 JSX 应用场景

