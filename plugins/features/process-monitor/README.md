# @zhin.js/process-monitor

进程监控与重启通知插件，自动记录机器人重启情况并通知管理员。

## 功能特性

- ✅ **智能检测**：自动识别启动类型（首次启动/正常重启/异常崩溃）
- ✅ **历史记录**：数据库持久化存储重启历史
- ✅ **多渠道通知**：支持用户私聊、群组消息、邮件、Webhook
- ✅ **统计分析**：重启次数、崩溃次数、累计运行时长
- ✅ **健康检查**：定期检查进程状态（内存、运行时长）
- ✅ **命令管理**：查看状态、历史记录、重置统计

## 安装

### 方式一：从 npm 安装（发布后）

```bash
pnpm add @zhin.js/process-monitor
```

### 方式二：本地开发

如果你在 Zhin 项目中开发，插件已经在 workspace 中，直接在配置文件中启用即可：

```yaml
plugins:
  - "@zhin.js/process-monitor"
```

## 配置

在 `zhin.config.yml` 中配置：

```yaml
plugins:
  - "@zhin.js/process-monitor"

process-monitor:
  enabled: true                    # 是否启用
  recordHistory: true              # 是否记录历史
  maxHistoryRecords: 100           # 最大历史记录数
  checkInterval: 60000             # 健康检查间隔（毫秒）
  notifyOnStart: true              # 启动时通知
  notifyOnRestart: true            # 重启时通知
  notifyOnCrash: true              # 崩溃时通知
  
  notifyChannels:
    # 方式一：发送给指定用户（私聊）
    - type: user
      target: "123456789"          # 用户 ID
      platform: "icqq"             # 平台标识（可选，默认第一个适配器）
    
    # 方式二：发送到指定群组
    - type: group
      target: "987654321"          # 群组 ID
      platform: "icqq"
    
    # 方式三：发送邮件（需配置邮件服务）
    - type: email
      target: "admin@example.com"
    
    # 方式四：Webhook 回调
    - type: webhook
      target: "https://your-webhook.com/notify"
```

## 使用

### 查看状态

```bash
monitor --status
# 或
pm -s
```

输出示例：
```
📊 进程监控状态

🚀 当前 PID: 12345
⏱️  运行时长: 2天5小时30分钟
💾 内存使用: 156 MB
🔄 总重启: 3 次
💥 崩溃: 1 次
📈 累计运行: 15天8小时
🖥️  主机: my-server
💻 平台: linux-x64
📦 Node: v23.7.0
```

### 查看重启历史

```bash
monitor --history        # 最近 10 条
monitor --history 20     # 最近 20 条
```

输出示例：
```
📜 重启历史记录

🔄 2026-02-05 14:30:25
   原因: restart | PID: 12345
   运行: 2天5小时30分钟

💥 2026-02-03 09:15:10
   原因: crash | PID: 11234
   运行: 3小时45分钟

🚀 2026-02-03 05:30:00
   原因: start | PID: 11234
```

### 重置统计

```bash
monitor --reset
```

## 通知示例

### 启动通知

```
🚀 【进程监控通知】

📊 事件: 首次启动
⏰ 时间: 2026-02-05 14:30:25
🖥️  主机: my-server
🔢 PID: 12345
💻 平台: linux-x64
📦 Node: v23.7.0
💾 内存: 120 MB

📈 统计:
  • 总重启: 0 次
  • 崩溃: 0 次
  • 累计运行: 0秒
```

### 崩溃通知

```
💥 【进程监控通知】

📊 事件: 异常崩溃
⏰ 时间: 2026-02-05 18:45:30
🖥️  主机: my-server
🔢 PID: 12346
💻 平台: linux-x64
📦 Node: v23.7.0
⏱️  运行时长: 4小时15分钟
💾 内存: 256 MB

📈 统计:
  • 总重启: 3 次
  • 崩溃: 1 次
  • 累计运行: 15天8小时
```

## 工作原理

### 启动检测

1. **首次启动**：无历史状态文件
2. **正常重启**：距上次启动 > 5 分钟
3. **异常崩溃**：距上次启动 < 5 分钟

### 数据持久化

- **状态文件**：`data/process-state.json`
  - 记录上次 PID、启动时间、统计数据
  
- **数据库表**：`process_restart_records`
  - 完整的重启历史记录

### 通知流程

```
进程启动 → 检测启动原因 → 记录数据库 → 判断是否通知 → 发送通知
```

## Webhook 数据格式

POST 请求体：

```json
{
  "event": "process_restart",
  "data": {
    "timestamp": "2026-02-05T14:30:25.000Z",
    "reason": "crash",
    "exitCode": 1,
    "uptime": 15300000,
    "pid": 12346,
    "hostname": "my-server",
    "platform": "linux-x64",
    "nodeVersion": "v23.7.0",
    "memory": 256
  },
  "stats": {
    "restartCount": 3,
    "crashCount": 1,
    "totalUptime": 1324800000
  }
}
```

## 最佳实践

### 生产环境配置

```yaml
process-monitor:
  enabled: true
  recordHistory: true
  maxHistoryRecords: 200
  checkInterval: 300000              # 5 分钟检查一次
  notifyOnStart: true
  notifyOnRestart: true
  notifyOnCrash: true
  
  notifyChannels:
    # 主管理员（私聊）
    - type: user
      target: "${ADMIN_USER_ID}"
      platform: "icqq"
    
    # 运维群组
    - type: group
      target: "${OPS_GROUP_ID}"
      platform: "icqq"
    
    # 监控系统 Webhook
    - type: webhook
      target: "${MONITORING_WEBHOOK_URL}"
```

### 配合系统服务

与 systemd/launchd/NSSM 配合使用，实现：
- **系统级监督**：守护进程崩溃自动重启
- **应用级通知**：插件记录并通知管理员

### 告警规则建议

- 🟢 **正常重启**：记录即可，可选通知
- 🟡 **频繁重启**：1小时内重启 > 3 次，需关注
- 🔴 **持续崩溃**：5分钟内崩溃 > 2 次，立即处理

## 故障排查

### 通知未发送

1. 检查配置：`notifyChannels` 是否正确
2. 检查权限：机器人是否有发送消息权限
3. 查看日志：是否有错误信息

### 历史记录丢失

1. 检查数据库连接
2. 确认 `recordHistory: true`
3. 查看 `data/process-state.json` 是否存在

### 启动类型误判

- 调整判断阈值（默认 5 分钟）
- 检查系统时间是否正确

## 许可证

MIT License
