---
"@zhin.js/schedule": patch
---

Replace the process-global holiday registry with an owner-scoped `HolidayCalendar`. Each `CalendarScheduler` now owns independent holiday data, derived caches, update listeners, and override persistence through `scheduler.holidays`; standalone planning can receive the same calendar explicitly. Remove the root `updateData`, `loadHolidayOverrides`, `getMinHolidayYear`, `getMaxHolidayYear`, and `onHolidayDataUpdate` functions together with the old `UpdateDataOptions` type.
