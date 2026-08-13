---
'@zhin.js/ai': major
'@zhin.js/agent': major
---

Fail closed on Agent session and context persistence failures. Database errors now surface as typed `PersistenceUnavailableError` instead of being reinterpreted as Not Found, empty history, or successful metadata writes.

Make `ContextRepository` the sole Agent session archive authority and remove the duplicate Store archive command that previously reported false after a successful archive.
