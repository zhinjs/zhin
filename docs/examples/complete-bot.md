# 完整机器人示例

本教程将展示如何创建一个功能完整的机器人，包含多平台支持、数据库、定时任务等特性。

## 项目结构

```
my-bot/
├── src/
│   ├── index.ts
│   └── plugins/
│       ├── status.ts          # 状态查询
│       ├── checkin.ts         # 签到系统
│       ├── music.tsx          # 音乐点歌
│       └── admin.ts           # 管理功能
├── data/                      # 数据目录
├── .env                       # 环境变量
└── zhin.config.ts            # 配置文件
```

## 配置文件

`zhin.config.ts`：

```typescript
import { defineConfig } from 'zhin.js'
import path from 'node:path'

export default defineConfig(async (env) => {
  return {
    // 数据库配置
    database: {
      dialect: 'sqlite',
      filename: './data/bot.db'
    },
    
    // 机器人实例
    bots: [
      // 控制台（开发测试）
      {
        name: `${process.pid}`,
        context: 'process'
      },
      
      // QQ 官方机器人
      {
        context: 'qq',
        name: 'my-qq-bot',
        appid: env.QQ_APPID,
        secret: env.QQ_SECRET,
        intents: [
          'GUILDS',
          'GROUP_AT_MESSAGE_CREATE',
          'PUBLIC_GUILD_MESSAGES',
          'GUILD_MEMBERS',
          'DIRECT_MESSAGE',
          'C2C_MESSAGE_CREATE'
        ],
        mode: 'websocket',
        removeAt: true
      },
      
      // ICQQ（QQ第三方）
      {
        name: env.ICQQ_ACCOUNT,
        context: 'icqq',
        password: env.ICQQ_PASSWORD,
        platform: 2  // aPad
      },
      
      // KOOK
      {
        name: 'kook-bot',
        context: 'kook',
        token: env.KOOK_TOKEN,
        mode: 'websocket'
      }
    ],
    
    // 插件目录
    plugin_dirs: [
      './src/plugins',
      'node_modules',
      path.join('node_modules', '@zhin.js')
    ],
    
    // 启用的插件
    plugins: [
      'http',              // HTTP 服务
      'adapter-process',   // 控制台适配器
      'adapter-qq',        // QQ 官方适配器
      'adapter-icqq',      // ICQQ 适配器
      'adapter-kook',      // KOOK 适配器
      'console',           // Web 控制台
      'status',            // 状态查询
      'checkin',           // 签到系统
      'music',             // 音乐点歌
      'admin'              // 管理功能
    ],
    
    // 调试模式
    debug: env.DEBUG === 'true'
  }
})
```

`.env` 文件：

```bash
# 调试模式
DEBUG=true

# QQ 官方机器人
QQ_APPID=102073979
QQ_SECRET=your_secret

# ICQQ
ICQQ_ACCOUNT=123456789
ICQQ_PASSWORD=your_password

# KOOK
KOOK_TOKEN=your_token
```

## 插件开发

### 1. 状态查询插件

`src/plugins/status.ts`：

```typescript
import {
  addCommand,
  MessageCommand,
  useApp,
  useLogger,
  Adapter
} from 'zhin.js'
import * as os from 'node:os'

const logger = useLogger()
const app = useApp()

// 格式化字节
function formatBytes(bytes: number): string {
  const sizes = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unit = 0
  while (size > 1024 && unit < sizes.length - 1) {
    size = size / 1024
    unit++
  }
  return `${size.toFixed(2)}${sizes[unit]}`
}

// 格式化时间
function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  
  if (days > 0) return `${days}天${hours % 24}小时`
  if (hours > 0) return `${hours}小时${minutes % 60}分钟`
  if (minutes > 0) return `${minutes}分钟${seconds % 60}秒`
  return `${seconds}秒`
}

// 状态命令
addCommand(new MessageCommand('status')
  .alias('zt')
  .action(() => {
    const totalmem = os.totalmem()
    const freemem = os.freemem()
    const usedmem = totalmem - freemem
    
    return [
      '━━━━━ 系统状态 ━━━━━',
      `💻 操作系统：${os.type()} ${os.release()}`,
      `📊 内存：${formatBytes(usedmem)}/${formatBytes(totalmem)} (${((usedmem / totalmem) * 100).toFixed(1)}%)`,
      `⚡ Node.js：${process.version}`,
      `⏱️ 运行时长：${formatTime(process.uptime() * 1000)}`,
      `📦 内存使用：${formatBytes(process.memoryUsage().rss)}`,
      '',
      '━━━━━ 框架状态 ━━━━━',
      `🔌 适配器：${app.adapters.length}个`,
      `🧩 插件：${app.dependencyList.length}个`,
      '',
      '━━━━━ 机器人状态 ━━━━━',
      ...app.adapters.map(name => {
        const adapter = app.getContext<Adapter>(name)
        return `  ${name}：${adapter.bots.size}个`
      })
    ].join('\n')
  })
)

// 帮助命令
addCommand(new MessageCommand('help')
  .action(() => {
    return [
      '📚 可用命令列表',
      '',
      '🔍 基础功能',
      '  /status, /zt - 查看系统状态',
      '  /help - 查看帮助',
      '',
      '✅ 签到系统',
      '  /checkin, /签到 - 每日签到',
      '  /checkin-info - 签到信息',
      '  /rank - 签到排行榜',
      '',
      '🎵 音乐功能 (仅 ICQQ)',
      '  /music <关键词> - 搜索音乐',
      '  /点歌 <关键词> - 点歌',
      '',
      '⚙️ 管理功能',
      '  /reload <plugin> - 重载插件',
      '  /plugins - 查看插件列表',
      '  /bots - 查看机器人列表'
    ].join('\n')
  })
)

logger.info('状态查询插件已加载')
```

### 2. 签到系统插件

`src/plugins/checkin.ts`：

```typescript
import {
  defineModel,
  onDatabaseReady,
  addCommand,
  MessageCommand,
  useLogger
} from 'zhin.js'

const logger = useLogger()

// 声明数据模型类型
declare module '@zhin.js/types' {
  interface Models {
    checkins: {
      id?: number
      user_id: string
      username: string
      date: string
      consecutive_days: number
      total_days: number
      points: number
      created_at?: Date
    }
  }
}

// 定义签到表
defineModel('checkins', {
  id: { type: 'integer', autoIncrement: true, primary: true },
  user_id: { type: 'text', nullable: false },
  username: { type: 'text', nullable: false },
  date: { type: 'text', nullable: false },
  consecutive_days: { type: 'integer', default: 1 },
  total_days: { type: 'integer', default: 1 },
  points: { type: 'integer', default: 0 },
  created_at: { type: 'datetime', default: () => new Date() }
})

onDatabaseReady(async (db) => {
  const checkins = db.model('checkins')
  
  // 签到命令
  addCommand(new MessageCommand('checkin')
    .alias('签到')
    .action(async (message) => {
      const userId = message.$sender.id
      const username = message.$sender.name
      const today = new Date().toISOString().split('T')[0]
      
      // 检查今天是否已签到
      const todayCheckin = await checkins.select({
        user_id: userId,
        date: today
      })
      
      if (todayCheckin.length > 0) {
        const record = todayCheckin[0]
        return [
          '❌ 你今天已经签到过了！',
          `连续签到：${record.consecutive_days}天`,
          `累计签到：${record.total_days}天`,
          `总积分：${record.points}`
        ].join('\n')
      }
      
      // 获取昨天的签到记录
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayStr = yesterday.toISOString().split('T')[0]
      
      const yesterdayCheckin = await checkins.select({
        user_id: userId,
        date: yesterdayStr
      })
      
      // 获取总签到次数
      const allCheckins = await checkins.count({ user_id: userId })
      
      // 计算连续天数
      let consecutiveDays = 1
      let lastPoints = 0
      
      if (yesterdayCheckin.length > 0) {
        consecutiveDays = yesterdayCheckin[0].consecutive_days + 1
        lastPoints = yesterdayCheckin[0].points
      }
      
      // 计算获得积分（连续签到奖励）
      const basePoints = 10
      const bonusPoints = Math.floor(consecutiveDays / 7) * 5
      const earnedPoints = basePoints + bonusPoints
      const totalPoints = lastPoints + earnedPoints
      
      // 创建签到记录
      await checkins.create({
        user_id: userId,
        username,
        date: today,
        consecutive_days: consecutiveDays,
        total_days: allCheckins + 1,
        points: totalPoints
      })
      
      return [
        '✅ 签到成功！',
        `📅 连续签到：${consecutiveDays}天`,
        `📊 累计签到：${allCheckins + 1}天`,
        `💰 本次获得：${earnedPoints}积分`,
        `🏆 总积分：${totalPoints}`,
        '',
        consecutiveDays % 7 === 0 ? '🎉 连续签到7天，获得额外奖励！' : ''
      ].filter(Boolean).join('\n')
    })
  )
  
  // 签到信息
  addCommand(new MessageCommand('checkin-info')
    .alias('签到信息')
    .action(async (message) => {
      const userId = message.$sender.id
      
      const recentCheckins = await checkins.select(
        { user_id: userId },
        { limit: 7, orderBy: 'date', desc: true }
      )
      
      if (recentCheckins.length === 0) {
        return '你还没有签到记录，发送 /checkin 开始签到吧！'
      }
      
      const latest = recentCheckins[0]
      
      return [
        '📊 签到统计',
        '',
        `📅 连续签到：${latest.consecutive_days}天`,
        `📈 累计签到：${latest.total_days}天`,
        `💰 总积分：${latest.points}`,
        '',
        '📅 最近7天签到记录：',
        ...recentCheckins.map(c => `  ${c.date} ✓`)
      ].join('\n')
    })
  )
  
  // 签到排行榜
  addCommand(new MessageCommand('rank')
    .alias('排行榜')
    .action(async () => {
      // 获取最新的签到记录（每个用户一条）
      const allUsers = await checkins.select(
        {},
        { orderBy: 'created_at', desc: true }
      )
      
      // 去重，保留每个用户最新的记录
      const uniqueUsers = new Map()
      for (const record of allUsers) {
        if (!uniqueUsers.has(record.user_id)) {
          uniqueUsers.set(record.user_id, record)
        }
      }
      
      // 按积分排序
      const topUsers = Array.from(uniqueUsers.values())
        .sort((a, b) => b.points - a.points)
        .slice(0, 10)
      
      if (topUsers.length === 0) {
        return '还没有人签到哦~'
      }
      
      const rankings = topUsers.map((user, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '  '
        return `${medal} ${index + 1}. ${user.username}\n     💰${user.points}分 📅${user.consecutive_days}天连签`
      })
      
      return [
        '🏆 签到排行榜 Top 10',
        '',
        ...rankings
      ].join('\n')
    })
  )
  
  logger.info('签到系统插件已加载')
})
```

### 3. 音乐点歌插件

`src/plugins/music.tsx`：

```typescript
import {
  addCommand,
  MessageCommand,
  useContext,
  usePrompt,
  useLogger
} from 'zhin.js'

const logger = useLogger()

interface Music {
  type: 'qq' | '163'
  id: string
  name: string
  artist?: string
}

// QQ 音乐搜索
async function searchQQMusic(keyword: string): Promise<Music[]> {
  const url = new URL('https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg')
  url.searchParams.set('key', keyword)
  url.searchParams.set('format', 'json')
  
  try {
    const { data } = await fetch(url).then(res => res.json())
    return data.song.itemlist.map((song: any) => ({
      type: 'qq' as const,
      name: song.name,
      id: song.id
    }))
  } catch (error) {
    logger.error('QQ音乐搜索失败:', error)
    return []
  }
}

// 网易云音乐搜索
async function search163Music(keyword: string): Promise<Music[]> {
  const url = new URL('https://music.163.com/api/search/get/')
  
  try {
    const result = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        s: keyword,
        type: '1',
        limit: '3',
        offset: '0'
      })
    }).then(res => res.json())
    
    return result.result.songs.map((song: any) => ({
      type: '163' as const,
      name: song.name,
      id: song.id,
      artist: song.artist
    }))
  } catch (error) {
    logger.error('网易云音乐搜索失败:', error)
    return []
  }
}

// 仅在 ICQQ 适配器下生效
useContext('icqq', (adapter) => {
  addCommand(new MessageCommand('music <keyword>')
    .alias('点歌')
    .scope('icqq')
    .action(async (message, result) => {
      const keyword = result.params.keyword
      
      await message.$reply('🔍 正在搜索...')
      
      // 并发搜索
      const [musicFromQQ, musicFrom163] = await Promise.all([
        searchQQMusic(keyword),
        search163Music(keyword)
      ])
      
      const allMusic = [...musicFromQQ, ...musicFrom163].filter(Boolean)
      
      if (allMusic.length === 0) {
        return '❌ 没有找到相关歌曲'
      }
      
      // 让用户选择
      const prompt = usePrompt(message)
      const musicId = await prompt.pick('请选择搜索结果', {
        type: 'text',
        options: allMusic.map(music => ({
          label: `${music.name}${music.artist ? ' - ' + music.artist : ''} (${music.type})`,
          value: music.id
        }))
      })
      
      if (!musicId) {
        return '已取消'
      }
      
      const selectedMusic = allMusic.find(m => m.id === musicId)!
      
      // 发送音乐卡片
      try {
        switch (message.message_type) {
          case 'private':
            await message.friend.shareMusic(selectedMusic.type, selectedMusic.id)
            break
          case 'group':
            await message.group.shareMusic(selectedMusic.type, selectedMusic.id)
            break
        }
        return '✅ 已发送'
      } catch (error) {
        logger.error('发送音乐失败:', error)
        return '❌ 发送失败'
      }
    })
  )
  
  logger.info('音乐点歌插件已加载（仅 ICQQ）')
})
```

### 4. 管理功能插件

`src/plugins/admin.ts`：

```typescript
import {
  addCommand,
  MessageCommand,
  useApp,
  useLogger,
  Adapter
} from 'zhin.js'

const logger = useLogger()
const app = useApp()

// 管理员列表
const ADMINS = ['123456789', '987654321']  // 替换为实际的管理员ID

// 检查是否为管理员
function isAdmin(userId: string): boolean {
  return ADMINS.includes(userId)
}

// 重载插件
addCommand(new MessageCommand('reload <plugin>')
  .action(async (message, result) => {
    if (!isAdmin(message.$sender.id)) {
      return '❌ 权限不足'
    }
    
    try {
      await app.reloadPlugin(result.params.plugin)
      return `✅ 插件 ${result.params.plugin} 已重载`
    } catch (error) {
      logger.error('重载插件失败:', error)
      return `❌ 重载失败：${(error as Error).message}`
    }
  })
)

// 查看插件列表
addCommand(new MessageCommand('plugins')
  .action(async (message) => {
    if (!isAdmin(message.$sender.id)) {
      return '❌ 权限不足'
    }
    
    const plugins = app.dependencyList.map((dep, index) => {
      const status = (dep as any).mounted ? '✅' : '❌'
      return `${index + 1}. ${status} ${dep.name}`
    })
    
    return [
      '🧩 插件列表',
      '',
      ...plugins,
      '',
      `总计：${app.dependencyList.length}个插件`
    ].join('\n')
  })
)

// 查看机器人列表
addCommand(new MessageCommand('bots')
  .action(async (message) => {
    if (!isAdmin(message.$sender.id)) {
      return '❌ 权限不足'
    }
    
    const botList = app.adapters.flatMap(name => {
      const adapter = app.getContext<Adapter>(name)
      return Array.from(adapter.bots.entries()).map(([botName, bot]) => {
        const status = bot.$connected ? '🟢 在线' : '🔴 离线'
        return `  ${status} ${name}/${botName}`
      })
    })
    
    return [
      '🤖 机器人列表',
      '',
      ...botList,
      '',
      `总计：${botList.length}个机器人`
    ].join('\n')
  })
)

logger.info('管理功能插件已加载')
```

## 运行机器人

### 安装依赖

```bash
pnpm install
```

### 开发模式

```bash
pnpm dev
```

### 生产部署

```bash
# 构建
pnpm build

# 启动
pnpm start --daemon
```

## 功能演示

### 1. 状态查询

```
> /status
< ━━━━━ 系统状态 ━━━━━
  💻 操作系统：Darwin 23.6.0
  📊 内存：1.23GB/16.00GB (7.7%)
  ⚡ Node.js：v18.17.0
  ⏱️ 运行时长：1小时23分钟
  📦 内存使用：45.67MB
  
  ━━━━━ 框架状态 ━━━━━
  🔌 适配器：4个
  🧩 插件：8个
  
  ━━━━━ 机器人状态 ━━━━━
    process：1个
    qq：2个
    icqq：2个
    kook：1个
```

### 2. 签到系统

```
> /checkin
< ✅ 签到成功！
  📅 连续签到：5天
  📊 累计签到：12天
  💰 本次获得：10积分
  🏆 总积分：120

> /rank
< 🏆 签到排行榜 Top 10
  
  🥇 1. 张三
       💰500分 📅35天连签
  🥈 2. 李四
       💰420分 📅28天连签
  🥉 3. 王五
       💰350分 📅21天连签
```

### 3. 音乐点歌

```
> /点歌 晴天
< 🔍 正在搜索...
< 请选择搜索结果
  1. 晴天 (qq)
  2. 晴天 - 周杰伦 (163)
  3. 晴天 - 孙燕姿 (163)
> 2
< ✅ 已发送
  [音乐卡片]
```

## 进阶功能

### 定时任务

添加定时任务插件：

```typescript
import { addCron, useLogger } from 'zhin.js'

const logger = useLogger()

// 每天8点发送早安
addCron('0 8 * * *', async () => {
  logger.info('发送早安消息')
  // 实现发送逻辑
})

// 每小时清理过期数据
addCron('0 * * * *', async () => {
  logger.info('清理过期数据')
  // 实现清理逻辑
})
```

### Web 控制台

访问 `http://localhost:8086`（默认用户名密码：admin/123456）

功能：
- 📊 实时状态监控
- 🤖 机器人管理
- 🧩 插件热重载
- 📝 日志查看
- ⚙️ 配置管理

## 总结

这个完整示例展示了：

1. ✅ **多平台支持** - 同时运行在 QQ、ICQQ、KOOK、控制台
2. ✅ **数据库应用** - 签到系统、积分系统、排行榜
3. ✅ **JSX 支持** - 使用 JSX 构建富文本消息
4. ✅ **Prompt 交互** - 音乐点歌的交互式选择
5. ✅ **权限管理** - 管理员命令
6. ✅ **错误处理** - 完善的异常捕获
7. ✅ **日志记录** - 详细的运行日志
8. ✅ **Web 控制台** - 浏览器管理界面

你可以基于这个示例继续扩展更多功能！

