# 定时任务

Zhin.js 通过 `CronFeature` 管理定时任务。插件可以使用 `addCron` 扩展方法添加定时任务。

## 基础用法

```typescript
import { usePlugin, Cron } from 'zhin.js'

const { addCron } = usePlugin()

// 每分钟执行
addCron(new Cron('* * * * *', () => {
  console.log('每分钟执行一次')
}))
```

`addCron` 是 CronFeature 注入到插件上的扩展方法，返回一个 dispose 函数。插件卸载时，所有定时任务会自动清理。

## Cron 表达式

```
* * * * *
│ │ │ │ │
│ │ │ │ └─ 星期 (0-7, 0和7都表示周日)
│ │ │ └─── 月份 (1-12)
│ │ └───── 日期 (1-31)
│ └─────── 小时 (0-23)
└───────── 分钟 (0-59)
```

## 常用示例

```typescript
import { usePlugin, Cron } from 'zhin.js'

const { addCron } = usePlugin()

// 每天 8:00
addCron(new Cron('0 8 * * *', () => {
  console.log('早上好！')
}))

// 每小时整点
addCron(new Cron('0 * * * *', () => {
  console.log('整点报时')
}))

// 每周一 9:00
addCron(new Cron('0 9 * * 1', () => {
  console.log('新的一周开始了')
}))

// 每 5 分钟
addCron(new Cron('*/5 * * * *', () => {
  console.log('5分钟过去了')
}))
```

## 手动管理任务

如果需要更精细的控制，可以通过 inject 获取 CronFeature：

```typescript
import { usePlugin, Cron } from 'zhin.js'

const { inject } = usePlugin()

const cronFeature = inject('cron')

// 添加任务
const task = new Cron('* * * * *', () => {
  console.log('运行中...')
})
const dispose = cronFeature.add(task, 'my-plugin')

// 查看所有任务状态
const status = cronFeature.getStatus()
console.log(status) // [{ name, pattern, running, nextRun }]

// 停止单个任务
dispose()
```

## 完整示例

```typescript
import { usePlugin, Cron, MessageCommand } from 'zhin.js'

const { addCron, addCommand, logger } = usePlugin()

const tasks = new Map<string, () => void>()

// 添加定时任务命令
addCommand(
  new MessageCommand('cron-add <name:string> <pattern:string>')
    .desc('添加定时任务')
    .action((_, result) => {
      const { name, pattern } = result.params
      
      const dispose = addCron(new Cron(pattern, () => {
        logger.info(`任务 ${name} 执行`)
      }))
      
      tasks.set(name, dispose)
      return `任务 ${name} 已添加`
    })
)

// 停止定时任务命令
addCommand(
  new MessageCommand('cron-stop <name:string>')
    .desc('停止定时任务')
    .action((_, result) => {
      const dispose = tasks.get(result.params.name)
      if (!dispose) return '任务不存在'
      
      dispose()
      tasks.delete(result.params.name)
      return `任务 ${result.params.name} 已停止`
    })
)

// 查看所有任务
addCommand(
  new MessageCommand('cron-list')
    .desc('查看定时任务列表')
    .action(() => {
      const list = Array.from(tasks.keys())
      return list.length ? list.join('\n') : '暂无任务'
    })
)
```
