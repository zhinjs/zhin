# 音乐插件

为 Zhin.js 提供音乐搜索和分享功能。支持多个音乐平台：QQ 音乐、网易云音乐。

## ✨ 功能特性

- 🎵 **多平台搜索**：支持 QQ 音乐、网易云音乐
- 🎯 **智能选择**：交互式选择搜索结果
- 🔗 **音频直链**：获取音乐播放链接
- 📝 **歌词获取**：获取音乐歌词文本
- 📱 **多适配器支持**：
  - ICQQ: 发送音乐分享卡片
  - 其他平台: 发送格式化的文本消息
- 🎨 **美观展示**：格式化的音乐信息展示
- ⚡ **并行搜索**：同时搜索多个平台，提高效率

## 📦 安装

```bash
pnpm add @zhin.js/plugin-music
```

## 🚀 使用

### 配置

在 `zhin.config.ts` 中添加插件：

```typescript
export default defineConfig({
  plugins: [
    'music'  // 添加音乐插件
  ]
})
```

### 命令列表

#### 1. 点歌（搜索音乐）

**语法**：
```
点歌 <关键词> [音乐源...]
```

**示例**：
```
点歌 告白气球
点歌 七里香 qq
点歌 晴天 qq netease
```

**支持的音乐源**：
- `qq` - QQ 音乐
- `netease` - 网易云音乐

如果不指定音乐源，默认搜索 QQ 音乐和网易云音乐。

#### 2. 获取音频直链

**语法**：
```
音乐链接 <关键词> [音乐源]
```

**示例**：
```
音乐链接 告白气球
音乐链接 七里香 qq
```

获取音乐的播放直链，可用于下载或直接播放。

**注意**：链接可能有时效性，请及时使用。

#### 3. 获取歌词

**语法**：
```
歌词 <关键词> [音乐源]
```

**示例**：
```
歌词 告白气球
歌词 七里香 qq
```

获取音乐的歌词文本。

## 📱 平台适配

### ICQQ 适配器

使用 ICQQ 适配器时，插件会发送音乐分享卡片：

```typescript
// 自动识别平台并发送分享卡片
// 支持 QQ 音乐和网易云音乐的原生分享
```

### 其他适配器

其他平台会发送格式化的文本消息：

```
🎵 音乐分享

🎼 告白气球
🎤 周杰伦
💿 周杰伦的床边故事
⏱️ 3:34
📱 QQ

🔗 https://y.qq.com/n/yqq/song/xxxxx.html
```

## 🎨 使用示例

### 基础搜索

```
用户: 点歌 晴天
机器人: 🎵 请选择音乐
  1. 晴天 - 周杰伦 - 叶惠美 [4:29] [QQ]
  2. 晴天 - 周杰伦 - 叶惠美 [4:30] [NETEASE]
  3. 晴天娃娃 - 周杰伦 - 我很忙 [4:59] [QQ]

用户: 1
机器人: [发送音乐分享卡片]
```

### 指定音乐源

```
用户: 点歌 夜曲 netease
机器人: [仅在网易云音乐搜索]
```

### 获取音频直链

```
用户: 音乐链接 告白气球
机器人: 🎵 请选择音乐
  1. 告白气球 - 周杰伦 - 周杰伦的床边故事 [3:34] [NETEASE]
  ...

用户: 1
机器人: 🎵 告白气球 - 周杰伦

🔗 音频直链:
https://music.example.com/song.mp3

⚠️ 链接可能有时效性，请及时使用
```

### 获取歌词

```
用户: 歌词 晴天
机器人: 🎵 请选择音乐
  ...

用户: 1
机器人: 🎵 晴天 - 周杰伦

📝 歌词:

故事的小黄花
从出生那年就飘着
童年的荡秋千
随记忆一直晃到现在
...
```

## 🗄️ 数据库结构

**注意**：当前版本已移除数据库依赖，所有功能都是无状态的。

## 🔧 API 参考

### 类型定义

```typescript
import type { ShareContent, MusicSource, MusicSearchService } from '@zhin.js/plugin-music'

// 音乐源类型
type MusicSource = 'qq' | 'netease'

// 音乐分享内容
interface ShareContent {
  id: string
  source: MusicSource
  url: string
  title: string
  artist?: string
  album?: string
  image?: string
  duration?: number
}
```

### 导出的服务

```typescript
import { musicServices } from '@zhin.js/plugin-music'

// 使用音乐搜索服务
const qqMusic = musicServices.qq
const results = await qqMusic.search('周杰伦', 10)
const cover = await qqMusic.getCover('音乐ID')
const detail = await qqMusic.getDetail('音乐ID')

// 获取音频直链（需要 Meting API）
const audioUrl = await qqMusic.getAudioUrl?.('音乐ID')

// 获取歌词
const lyric = await qqMusic.getLyric?.('音乐ID')
```

### 配置工具

```typescript
import { formatDuration, formatMusicInfo } from '@zhin.js/plugin-music'

// 格式化时长
formatDuration(214) // "3:34"

// 格式化音乐信息
formatMusicInfo({
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  duration: 269,
  source: 'qq'
})
// "晴天 - 周杰伦 - 叶惠美 [4:29] [QQ]"
```

## 🎯 扩展开发

### 添加新的音乐源

1. 创建音乐源服务类：

```typescript
// src/sources/my-music.ts
import type { MusicSearchService, ShareContent } from '../types.js'

export class MyMusicService implements MusicSearchService {
  async search(keyword: string, limit = 10): Promise<ShareContent[]> {
    // 实现搜索逻辑
    return []
  }
  
  async getCover(id: string): Promise<string | null> {
    // 实现获取封面逻辑
    return null
  }
}
```

2. 注册到服务映射：

```typescript
// src/sources/index.ts
import { MyMusicService } from './my-music.js'

export const musicServices = {
  qq: new QQMusicService(),
  netease: new NeteaseMusicService(),
  mymusic: new MyMusicService(), // 添加新服务
}
```

3. 更新类型定义：

```typescript
// src/types.ts
export type MusicSource = 'qq' | 'netease' | 'mymusic'
```

## ⚠️ 注意事项

1. **API 限制**：各音乐平台可能有请求频率限制
2. **版权问题**：仅用于搜索和分享链接，不提供下载功能
3. **网络问题**：部分 API 可能需要稳定的网络连接
4. **平台兼容**：ICQQ 特定功能仅在 ICQQ 适配器下可用

## 🐛 故障排除

### 搜索无结果

- 检查网络连接
- 尝试更换关键词
- 尝试指定不同的音乐源

### 分享卡片发送失败

- 确认使用的是 ICQQ 适配器
- 检查是否有封面图
- 降级使用文本消息

### 收藏功能异常

- 确认数据库已正确配置
- 检查数据库文件权限
- 查看日志获取详细错误信息

## 📝 开发

### 构建

```bash
pnpm build
```

### 测试

```bash
# 在测试机器人中测试
pnpm dev
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT

---

**享受音乐，享受编程！** 🎵✨
