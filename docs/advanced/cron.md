# 定时任务

使用 `Cron` 创建定时任务。

## 基础用法

```typescript
import { usePlugin, Cron } from 'zhin.js'

const { inject } = usePlugin()

const cron = inject('cron')

// 每分钟执行
cron.add(new Cron('* * * * *', () => {
  console.log('每分钟执行一次')
}))
```

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
// 每天 8:00
cron.add(new Cron('0 8 * * *', () => {
  console.log('早上好！')
}))

// 每小时
cron.add(new Cron('0 * * * *', () => {
  console.log('整点报时')
}))

// 每周一 9:00
cron.add(new Cron('0 9 * * 1', () => {
  console.log('新的一周开始了')
}))

// 每 5 分钟
cron.add(new Cron('*/5 * * * *', () => {
  console.log('5分钟过去了')
}))
```

## 停止任务

```typescript
const task = new Cron('* * * * *', () => {
  console.log('运行中...')
})

cron.add(task)

// 停止任务
cron.remove(task)
```

## 完整示例

```typescript
import { usePlugin, Cron, MessageCommand } from 'zhin.js'

const { inject, addCommand } = usePlugin()

const cron = inject('cron')
const tasks = new Map()

// 添加定时任务命令
addCommand(
  new MessageCommand('cron-add <name:string> <pattern:string>')
    .action((_, result) => {
      const { name, pattern } = result.params
      
      const task = new Cron(pattern, () => {
        console.log(`任务 ${name} 执行`)
      })
      
      cron.add(task)
      tasks.set(name, task)
      
      return `任务 ${name} 已添加`
    })
)

// 停止定时任务命令
addCommand(
  new MessageCommand('cron-stop <name:string>')
    .action((_, result) => {
      const task = tasks.get(result.params.name)
      
      if (!task) {
        return '任务不存在'
      }
      
      cron.remove(task)
      tasks.delete(result.params.name)
      
      return `任务 ${result.params.name} 已停止`
    })
)

// 查看所有任务
addCommand(
  new MessageCommand('cron-list')
    .action(() => {
      const list = Array.from(tasks.keys())
      return list.length ? list.join('\n') : '暂无任务'
    })
)
```

