---
"@zhin.js/ai": patch
---

Retry context overflow only when recovery reduces the projected request's estimated message tokens. Preserve the original overflow when recovery fails, and honor cancellation before retrying.
