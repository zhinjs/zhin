# @zhin.js/schedule

Zhin.js 日历语义调度库：公历/农历 Cron、国务院节假日、工作日/休息日、scatter 分散触发、持久化 JobStore 等。位于 monorepo **`basic/`** 层，由 `@zhin.js/kernel` 的 `ScheduleEngine` 与 Agent 层 `ScheduleJobEngine` 封装使用。

## 安装

```bash
pnpm add @zhin.js/schedule
```

## 架构位置

```
basic/ (@zhin.js/logger, schema, database, schedule, cli)
  ↓
@zhin.js/kernel          ScheduleEngine 包装 CalendarScheduler
  ↓
@zhin.js/core            Plugin.addSchedule
  ↓
@zhin.js/agent           ScheduleJobEngine、schedule_* 工具
```

用户向文档见 [docs/advanced/schedule.md](../../docs/advanced/schedule.md)；Breaking 变更见 [ADR 0028](../../docs/adr/0028-schedule-facility-replace-cron.md)。

## 快速开始

```typescript
import { CalendarScheduler } from '@zhin.js/schedule';

const scheduler = new CalendarScheduler({ timezone: 'Asia/Shanghai' });

// 6 段 cron（秒 分 时 日 月 周）
scheduler.solar('0 0 9 * * *', async (ctx) => {
  console.log('公历 9 点', ctx.solarText);
});

scheduler.workday('0 0 9 * * *', async () => {
  console.log('工作日 9 点');
});

scheduler.holiday({ cron: '0 0 10 * * *', festival: '春节' }, async () => {
  console.log('春节期间 10 点');
});

scheduler.start();
// …
scheduler.stop();
```

## 调度类型（`ScheduleKind`）

| kind | 说明 |
|------|------|
| `solar` | 公历 Cron |
| `lunar` | 农历 Cron |
| `workday` | 法定工作日（含调休上班） |
| `freeDay` | 休息日 |
| `holiday` | 指定节日区间 |
| `scatter` | 时间窗内随机/分散触发 |

辅助解析：`parseCron`、`validateCalendarCron`、`cron()` / `at()` / `everyMinutes()` 等见 `./parsers/`。

## 节假日数据

内置 2019–2026 年国务院公示数据（`src/data/holidays/*.json`）。可运行时更新：

```typescript
import { updateData, onHolidayDataUpdate } from '@zhin.js/schedule';

onHolidayDataUpdate(() => console.log('holiday data refreshed'));
await updateData({ year: 2027, force: true });
```

同步脚本：`scripts/sync-holiday.mjs`、`scripts/generate-holiday-registry.mjs`。

## 持久化 JobStore

```typescript
import { CalendarScheduler, createLocalJsonStore, createSqliteStore } from '@zhin.js/schedule';

const store = createLocalJsonStore({ path: './data/schedule-jobs.json' });
const scheduler = new CalendarScheduler({ store, timezone: 'Asia/Shanghai' });
```

亦支持 `createRedisStore`（多 worker  claim）与 `createHandlerRegistry`（handler 与 job 解耦）。

## 开发与测试

```bash
pnpm --filter @zhin.js/schedule build
pnpm vitest run basic/schedule/tests
```

## 主要导出

- `CalendarScheduler` — 调度引擎
- `getNextRun` / `isJobDue` — 单次/next-run 计算
- `resolveSolarJob` / `resolveLunarJob` / … — 解析 schedule 输入
- `simulateNextRuns` — 预览未来触发
- `updateData` / `fetchHolidayYearData` — 节假日数据源
- `createLocalJsonStore` / `createSqliteStore` / `createRedisStore` — 持久化

完整 API 见 `src/index.ts`。
