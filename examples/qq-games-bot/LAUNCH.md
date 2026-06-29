# QQ 机器人上线 Checklist

## 开放平台

1. [QQ 开放平台](https://q.qq.com/bot) 创建机器人，获取 AppID / Secret
2. **事件订阅**：`GROUP_AND_C2C_EVENT`、`INTERACTION`
3. 开发期：**沙箱配置** 添加测试 QQ 群（`zhin.config.yml` 中 `sandbox: true`）
4. 上线前：`sandbox: false`

## 群内

1. 将机器人拉入目标 QQ 群
2. 群管理员在机器人资料页 **开启消息接收**
3. 公域群用户需 **@ 机器人** 后发送命令（或直接点消息按钮）

## 配置

1. `.env` 从 `examples/test-bot/.env` 复制 `HTTP_TOKEN`、`QQ_APPID`、`QQ_SECRET`（与 test-bot 的 `zhin` 端点相同）
2. 确认 `groupSuite.noticeAdapters` 含 `qq`（入群欢迎）
3. 确认 `ai.enabled: false`（v1 无 AI）
4. `typingIndicator.groupConfig.type: none`（避免 QQ 群主动消息权限错误）

## 部署

1. `pnpm build`（或仓库根 `pnpm build`）
2. `cd examples/qq-games-bot && pnpm start`
3. 推荐 `pm2 start ecosystem.config.cjs`
4. 定期备份 `./data/bot.db`

## 验证

按 [QQ-REGRESSION.md](./QQ-REGRESSION.md) 在正式群跑一遍。
