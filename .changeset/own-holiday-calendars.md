---
"@zhin.js/schedule": minor
---

Replace the process-global holiday registry with an owner-scoped `HolidayCalendar`. Each `CalendarScheduler` now owns independent holiday data, derived caches, update listeners, and override persistence through `scheduler.holidays`; standalone planning can receive the same calendar explicitly. Remove the global update, range, deprecated constant, and test-reset APIs.
