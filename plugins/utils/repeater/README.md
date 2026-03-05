# @zhin.js/plugin-repeater

复读机插件 —— 当群内连续多人发送相同消息时，Bot 自动跟读。

## 安装

```bash
npm install @zhin.js/plugin-repeater
```

## 配置

在 `zhin.config.yml` 中添加：

```yaml
plugins:
 - "@zhin.js/plugin-repeater" 
repeater:
  threshold: 3       # 触发复读的最少人数（默认 3）
  cooldown: 30000    # 同一群冷却时间，毫秒（默认 30s）
  maxLength: 200    # 消息长度上限，超过不触发（默认 200）
```

## 工作原理

1. 监听群聊消息，记录每条消息的内容和发送者
2. 当 **不同** 用户连续发送完全相同的消息达到阈值时，Bot 自动回复该消息
3. 同一用户连续发送不计入（防止刷屏触发）
4. 每条消息在同一群只复读一次
5. 冷却期内不重复触发

## 命令

| 命令 | 说明 |
|------|------|
| `repeater-status` | 查看复读机运行状态 |

## 许可

MIT
