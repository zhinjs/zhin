---
"@zhin.js/testing": patch
---

`FakeClock.advance()` now moves the clock to each firing instant before running the jobs due at that instant, so a scheduled job that reads `clock.now()` sees the time it fired at instead of the time `advance()` started from.
