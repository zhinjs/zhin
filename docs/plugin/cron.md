# ⏰ 定时任务

深入了解 Zhin.js 的定时任务系统和 Cron 表达式。

## 🎯 定时任务概述

Zhin.js 提供了基于 `cron-parser` 的定时任务功能，支持在插件中创建和管理定时任务。

## 🔧 基础用法

### 插件中的定时任务
在插件中使用定时任务。

```typescript
import { Plugin } from '@zhin.js/core'

export default function myPlugin(plugin: Plugin) {
  // 每分钟执行一次
  plugin.cron('0 * * * * *', () => {
    plugin.logger.info('每分钟执行的任务')
  })

  // 每天午夜执行
  plugin.cron('0 0 0 * * *', () => {
    plugin.logger.info('每日清理任务')
  })
}
```

### 手动管理定时任务
手动创建和管理定时任务。

```typescript
import { Cron } from '@zhin.js/core'

// 创建定时任务
const cronJob = new Cron('0 0/15 * * * *', () => {
  console.log('每15分钟执行')
})

// 启动任务
cronJob.run()

// 停止任务
cronJob.stop()

// 销毁任务
cronJob.dispose()
```

## 📅 Cron 表达式

### 表达式格式
Cron 表达式使用 6 个字段：`秒 分 时 日 月 周`

| 字段 | 范围 | 说明 |
|------|------|------|
| 秒 | 0-59 | 秒 |
| 分 | 0-59 | 分钟 |
| 时 | 0-23 | 小时 (24小时制) |
| 日 | 1-31 | 月中的日期 |
| 月 | 1-12 | 月份 (也可使用 JAN-DEC) |
| 周 | 0-7 | 星期 (0和7都表示周日，也可使用 SUN-SAT) |

### 特殊字符

- `*`: 匹配任意值
- `?`: 用于日和周字段，表示不指定值
- `-`: 表示范围，如 `1-5`
- `,`: 表示列表，如 `1,3,5`
- `/`: 表示步长，如 `0/15` 表示每15分钟

### 常用示例

| 表达式 | 说明 |
|--------|------|
| `0 0 0 * * *` | 每天午夜执行 |
| `0 0/15 * * * *` | 每15分钟执行 |
| `0 0 12 * * *` | 每天中午12点执行 |
| `0 0 0 1 * *` | 每月1号午夜执行 |
| `0 0 0 * * 0` | 每周日午夜执行 |
| `0 0 9 * * 1-5` | 工作日上午9点执行 |
| `0 0/30 * * * *` | 每30分钟执行 |
| `0 0 */2 * * *` | 每2小时执行 |

## 🎯 实际应用

### 数据清理任务
定期清理过期数据。

```typescript
import { onMounted, onDispose } from 'zhin.js'

let cleanupTask: NodeJS.Timeout

onMounted(() => {
  // 每天凌晨2点清理过期数据
  cleanupTask = setInterval(async () => {
    const now = new Date()
    if (now.getHours() === 2 && now.getMinutes() === 0) {
      await cleanupExpiredData()
      console.log('过期数据清理完成')
    }
  }, 60000) // 每分钟检查一次
})

onDispose(() => {
  if (cleanupTask) {
    clearInterval(cleanupTask)
  }
})

async function cleanupExpiredData() {
  // 清理逻辑
  console.log('清理过期数据...')
}
```

### 健康检查任务
定期检查系统健康状态。

```typescript
import { useContext } from 'zhin.js'

useContext('database', (db) => {
  // 每5分钟检查数据库连接
  setInterval(async () => {
    try {
      await db.query('SELECT 1')
      console.log('数据库连接正常')
    } catch (error) {
      console.error('数据库连接异常:', error)
    }
  }, 5 * 60 * 1000)
})
```

### 统计报告任务
定期生成统计报告。

```typescript
import { sendMessage } from 'zhin.js'

// 每天上午9点发送统计报告
setInterval(async () => {
  const now = new Date()
  if (now.getHours() === 9 && now.getMinutes() === 0) {
    const stats = await generateStats()
    
    await sendMessage({
      context: 'process',
      bot: `${process.pid}`,
      id: 'console',
      type: 'private',
      content: `📊 每日统计报告\n${stats}`
    })
  }
}, 60000)

async function generateStats() {
  // 生成统计信息
  return `消息总数: 1000\n用户总数: 50\n活跃度: 85%`
}
```

## 🔧 高级用法

### 动态任务管理
动态创建和删除定时任务。

```typescript
class TaskManager {
  private tasks = new Map<string, NodeJS.Timeout>()
  
  addTask(name: string, cronExpression: string, callback: () => void) {
    // 解析 Cron 表达式并创建任务
    const interval = this.parseCronToInterval(cronExpression)
    
    const task = setInterval(callback, interval)
    this.tasks.set(name, task)
    
    console.log(`任务 ${name} 已添加`)
  }
  
  removeTask(name: string) {
    const task = this.tasks.get(name)
    if (task) {
      clearInterval(task)
      this.tasks.delete(name)
      console.log(`任务 ${name} 已移除`)
    }
  }
  
  private parseCronToInterval(expression: string): number {
    // 简化的 Cron 解析（实际应用中应使用专业的 Cron 解析库）
    if (expression === '0 * * * * *') return 60000 // 每分钟
    if (expression === '0 0/15 * * * *') return 15 * 60000 // 每15分钟
    return 60000 // 默认每分钟
  }
}

const taskManager = new TaskManager()

// 添加任务
taskManager.addTask('cleanup', '0 0 0 * * *', () => {
  console.log('执行清理任务')
})

// 移除任务
taskManager.removeTask('cleanup')
```

### 任务持久化
将任务配置持久化存储。

```typescript
import { useContext } from 'zhin.js'

useContext('database', (db) => {
  // 从数据库加载任务配置
  loadTasksFromDatabase()
  
  // 保存任务配置到数据库
  async function saveTaskToDatabase(name: string, config: any) {
    await db.query(
      'INSERT INTO cron_tasks (name, config) VALUES (?, ?)',
      [name, JSON.stringify(config)]
    )
  }
  
  async function loadTasksFromDatabase() {
    const tasks = await db.query('SELECT * FROM cron_tasks')
    
    for (const task of tasks) {
      const config = JSON.parse(task.config)
      createTaskFromConfig(task.name, config)
    }
  }
})
```

### 任务监控
监控任务执行状态。

```typescript
class TaskMonitor {
  private taskStats = new Map<string, {
    lastRun: Date | null
    runCount: number
    errorCount: number
    lastError: Error | null
  }>()
  
  wrapTask(name: string, task: () => Promise<void>) {
    return async () => {
      const stats = this.taskStats.get(name) || {
        lastRun: null,
        runCount: 0,
        errorCount: 0,
        lastError: null
      }
      
      try {
        await task()
        stats.lastRun = new Date()
        stats.runCount++
        stats.lastError = null
      } catch (error) {
        stats.errorCount++
        stats.lastError = error as Error
        console.error(`任务 ${name} 执行失败:`, error)
      }
      
      this.taskStats.set(name, stats)
    }
  }
  
  getTaskStats(name: string) {
    return this.taskStats.get(name)
  }
}

const monitor = new TaskMonitor()

// 包装任务
const monitoredTask = monitor.wrapTask('cleanup', async () => {
  console.log('执行清理任务')
})

setInterval(monitoredTask, 60000)
```

## 🧪 测试定时任务

### 单元测试
测试定时任务的功能。

```typescript
// tests/cron.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('Cron Tasks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  
  afterEach(() => {
    vi.useRealTimers()
  })
  
  it('should execute task at specified interval', () => {
    const callback = vi.fn()
    
    // 创建每分钟执行的任务
    const task = setInterval(callback, 60000)
    
    // 快进时间
    vi.advanceTimersByTime(60000)
    
    expect(callback).toHaveBeenCalledTimes(1)
    
    clearInterval(task)
  })
  
  it('should handle task errors gracefully', async () => {
    const errorCallback = vi.fn()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    
    const task = setInterval(async () => {
      try {
        throw new Error('Task failed')
      } catch (error) {
        errorCallback(error)
      }
    }, 60000)
    
    vi.advanceTimersByTime(60000)
    await vi.runAllTimersAsync()
    
    expect(errorCallback).toHaveBeenCalledWith(expect.any(Error))
    
    clearInterval(task)
    consoleSpy.mockRestore()
  })
})
```

### 集成测试
测试定时任务与插件的集成。

```typescript
describe('Cron Integration', () => {
  it('should execute plugin cron tasks', async () => {
    const app = await createApp({
      plugins: ['my-plugin']
    })
    
    await app.start()
    
    // 快进时间触发定时任务
    vi.advanceTimersByTime(60000)
    await vi.runAllTimersAsync()
    
    // 验证任务是否执行
    expect(mockTask).toHaveBeenCalled()
  })
})
```

## 🔗 相关链接

- [插件开发指南](./development.md)
- [插件生命周期](./lifecycle.md)
- [上下文系统](./context.md)
- [中间件系统](./middleware.md)
