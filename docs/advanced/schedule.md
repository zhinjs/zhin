# 调度任务（Schedule）

Zhin.js 通过 `ScheduleFeature` 与 `@zhin.js/schedule` 提供统一调度能力，支持公历/农历 Cron、工作日、节假日、scatter、单次（at）、间隔（every）等。

## 插件内存任务

```typescript
const { addSchedule } = usePlugin();

// 6 段 cron（秒 分 时 日 月 周），默认时区 Asia/Shanghai
addSchedule({ kind: 'solar', cron: '0 0 9 * * *' }, async () => {
  logger.info('早报');
});

addSchedule({ kind: 'workday', cron: '0 0 9 * * *' }, async () => { /* 工作日 9 点 */ });
addSchedule({ kind: 'every', everyMs: 30 * 60 * 1000 }, async () => { /* 每 30 分钟 */ });
```

Breaking：`addCron` / `Cron` 类已移除，见 [ADR 0031](/adr/0031-schedule-facility-replace-cron.md)。

## 持久化：`data/schedule-jobs.json`

Agent 层 `ScheduleJobEngine` 在启动时加载该文件（**不**再读取 `cron-jobs.json` / `assistant-jobs.json`）。每条记录包含 `schedule` + `action` + `notify`：

```json
{
  "version": 1,
  "jobs": [{
    "id": "sched_morning",
    "enabled": true,
    "schedule": { "kind": "solar", "cron": "0 0 8 * * *" },
    "action": { "kind": "agent", "prompt": "早报摘要" },
    "notify": { "channel": "silent" },
    "createdAt": 1710000000000,
    "updatedAt": 1710000000000,
    "state": {}
  }]
}
```

### CLI

```bash
zhin schedule list
zhin schedule add "0 0 9 * * *" "早报" --notify-channel silent
zhin schedule add --at "2025-12-31T09:00:00" "年终提醒"
zhin schedule add --every 30m "检查待办"
```

`zhin cron` 为兼容别名，指向同一命令。

### AI 工具

`schedule_list` / `schedule_add` / `schedule_remove` / `schedule_pause` / `schedule_resume`。

### Host RPC

`schedule:list` / `schedule:add` / `schedule:remove` / `schedule:pause` / `schedule:resume`。

## 投递通道

| `notify.channel` | 行为 |
|------------------|------|
| `im` | `Adapter.sendMessage` |
| `silent` | 仅更新 Job 状态 |
| `log` | 写入应用日志 |

`schedule_add` 参数 **`notify_channel`**：`im`、`silent`、`log`。

## 相关文档

- [ADR 0031 — Schedule 取代 Cron](/adr/0031-schedule-facility-replace-cron.md)
- [Assistant Runtime](/architecture/assistant-runtime.md)
