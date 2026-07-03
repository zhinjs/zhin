# ADR 0028: Schedule 设施取代 Cron

## 状态

已接受（2026-07）

## 背景

Zhin.js 原先使用 `croner` + kernel `Cron` 类 + core `CronFeature` + agent `PersistentCronEngine`，与作者自研的中国日历调度库 [cn-calendar-schedule](https://github.com/lc-cn/cn-calendar-schedule) 能力重叠。需要合并调度栈并支持农历、工作日、节假日、scatter 等语义。

## 决策

1. **新包** `@zhin.js/schedule`（`basic/schedule/`）作为日历调度 SSOT，源码迁入 monorepo，不通过 npm 安装外部包。
2. **Kernel** 提供 `ScheduleEngine`（包装 `CalendarScheduler`），**删除** `Cron` 类与 `croner` 依赖。
3. **Core** `CronFeature` → `ScheduleFeature`；插件 API **Breaking**：`addCron` → `addSchedule(descriptor, callback)`。
4. **Agent** 持久化文件 **`data/schedule-jobs.json`** 取代 `cron-jobs.json` / `scheduler-jobs.json` / `assistant-jobs.json`；**不再自动迁移**旧文件。
5. **Cron 格式** 统一 **6 段**（秒 分 时 日 月 周）；默认时区 `Asia/Shanghai`。
6. **AI / Host RPC** 工具名 `schedule_list` / `schedule_add` / …，废弃 `cron_*` / `cron:*`。
7. **Schedule 引擎** 随 kernel/core **始终可用**，不绑定 `assistant.enabled`。

## 后果

- 所有使用 `addCron` / `new Cron` 的插件与示例须改为 `addSchedule`。
- 用户须手动将旧 JSON 迁移为 `schedule-jobs.json` 或删除旧文件。
- IM 核心安装体积仍须满足 ADR 0019（`pnpm check:install-size`）。

## 关系

- 延续 ADR 0008（调度设施）的方向，本 ADR 为一次性 breaking 落地。
- 与 ADR 0019 安装分层无冲突：`@zhin.js/schedule` 在 basic 层，由 kernel 引用。
