# 定时任务

Zhin.js 通过 `CronFeature` 管理定时任务。插件可以使用 `addCron` 扩展方法添加定时任务。此外提供两类持久化能力：

1. **Cron 持久化**：`data/cron-jobs.json`，仅 Cron 表达式 + prompt，重启后加载。
2. **统一调度器（Scheduler）**：`data/scheduler-jobs.json`，支持单次（at）、间隔（every）、Cron，以及 **Heartbeat**（周期检查工作区 `HEARTBEAT.md`）。

## 统一调度器与 Heartbeat

调度器在应用启动时自动运行，持久化到 `data/scheduler-jobs.json`。

- **at**：单次在指定时间执行（ISO8601）。
- **every**：按固定间隔执行（如 30m、1h、1d）。
- **cron**：Cron 表达式（与 cron-jobs 一致）。
- **Heartbeat**：每 30 分钟检查项目根目录下的 `HEARTBEAT.md`；若文件存在且内容非空（除注释和 `- [ ]` 任务列表外有正文），则触发一次 Agent 执行固定 prompt（读 HEARTBEAT 说明）。可用于周期任务清单。

### CLI 添加单次/间隔任务

```bash
# 单次：指定时间执行一次（执行后默认删除）
zhin cron add --at "2025-12-31T09:00:00" "提醒：年终总结"

# 间隔：每 30 分钟 / 1 小时 / 1 天执行
zhin cron add --every 30m "检查待办并提醒"
zhin cron add --every 1h "早报摘要" --label hourly
```

应用运行中会到点执行；重启后会自动加载 `scheduler-jobs.json` 中未过期的任务。

## 持久化定时任务（Cron，AI 到点执行）

适用于「每天 9 点让 AI 执行某段 prompt」等场景，数据存于 `data/cron-jobs.json`，与 OpenClaw 定时任务思路一致。

### CLI

```bash
# 列出所有持久化任务
zhin cron list

# 添加：Cron 表达式 + 触发时发给 AI 的 prompt（或使用 --at / --every 见上文）
zhin cron add "0 9 * * *" "今天有什么待办？给我一份简要提醒"
zhin cron add "0 8 * * 1-5" "早报摘要" --label 工作日早报

# 删除
zhin cron remove <id>

# 暂停 / 恢复（不删除，重启后暂停的不执行）
zhin cron pause <id>
zhin cron resume <id>
```

修改后需**重启应用**（`zhin start` / `zhin dev`）后生效。触发时以 `platform: 'cron'`、`senderId: 'system'` 调用 ZhinAgent.process(prompt)。

### AI 管理定时任务

AI 具备管理定时任务的能力（内存任务 + 持久化任务），通过内置工具与 Agent 交互：

| 工具 | 说明 |
|------|------|
| `cron_list` | 列出所有定时任务：**memory**（插件注册，重启丢失）与 **persistent**（存于 data/cron-jobs.json，有 id） |
| `cron_add` | 添加一条持久化任务（cron_expression + prompt + 可选 label），**立即生效** |
| `cron_remove` | 按 id 删除持久化任务 |
| `cron_pause` | 暂停持久化任务（不删除） |
| `cron_resume` | 恢复已暂停的持久化任务 |

用户可以说「帮我加一个每天 9 点的提醒：今天有什么待办」「列出所有定时任务」「把 id 为 xxx 的任务删掉」等，由 AI 调用上述工具完成。

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
