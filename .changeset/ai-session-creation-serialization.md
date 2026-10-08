---
"@zhin.js/ai": patch
---

Serialize first active-session creation by session key within each repository instance, preventing concurrent opens from returning separate epochs. Keep different keys independent and release the key after storage failures so retries can recover.
