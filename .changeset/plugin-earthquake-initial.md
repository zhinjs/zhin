---
"@zhin.js/plugin-earthquake": patch
---

Add `@zhin.js/plugin-earthquake`: the `地震` query plus per-conversation alert subscriptions (`地震 订阅|退订|订阅状态`) with magnitude thresholds and region keywords, merging CENC (mirror-backed, configurable URLs) and USGS with cross-source de-duplication. Every request has a timeout, jittered exponential backoff with Retry-After support, per-source cooldown and failover; the poller never throws, baselines each source before pushing, and rate-limits pushes per conversation. Includes the read-only agent tool `recent_earthquakes`.
