# @zhin.js/plugin-calendar

## 0.1.1

### Minor Changes

- Google / Microsoft 改为 refresh_token + 内存 access token 管理（单飞、提前刷新、轮换警告 / 可选 token_file）
- 新增 `pnpm --filter @zhin.js/plugin-calendar auth google|microsoft`（PKCE loopback）
- 配置移除 access_token；支持 calendar_id 选择日历

## 0.1.0

### Minor Changes

- 初始版本：CalDAV / Google / Microsoft 日历 Agent 工具
