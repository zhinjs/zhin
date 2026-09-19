# @zhin.js/process-monitor

Zhin Plugin Runtime 的进程启动检测与状态查询插件。

## 能力

- 通过 `data/process-state.json` 记录启动 PID、启动时间、正常退出标记、重启次数和崩溃次数。
- `$process-status` Command 与 Tool 返回当前 PID、运行时长、内存和累计统计。
- 可在首次启动、正常重启或异常崩溃后调用 HTTP Webhook。
- 每个插件 owner 独立持有 `ProcessMonitor` 实例、状态和信号监听器；generation dispose 时自动清理监听器。

## 安装与配置

```bash
pnpm add @zhin.js/process-monitor
```

```yaml
plugins:
  process-monitor:
    package: "@zhin.js/process-monitor"
    config:
      enabled: true
      notifyOnStart: true
      notifyOnRestart: true
      notifyOnCrash: true
      notifyChannels:
        - type: webhook
          target: "${PROCESS_MONITOR_WEBHOOK_URL}"
```

`notifyChannels` 当前只接受 `webhook`。Webhook 使用 `POST application/json`，正文包含：

```json
{
  "event": "process_restart",
  "data": {
    "reason": "restart",
    "timestamp": "2026-09-19T10:00:00.000Z",
    "pid": 12345,
    "hostname": "bot-host",
    "platform": "linux-x64",
    "nodeVersion": "v24.0.0"
  },
  "stats": {
    "restartCount": 1,
    "crashCount": 0,
    "totalUptime": 3600000
  }
}
```

首次没有历史状态时记为 `start`；上次收到 `SIGTERM`/`SIGINT` 时记为 `restart`；未正常退出且五分钟内重新启动时记为 `crash`。
