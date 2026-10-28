---
'@zhin.js/adapter-bilibili-live': patch
---

ADR 0038 slice E2: new Experimental Bilibili live danmaku adapter. It connects to the danmaku WebSocket of your own live room (WBI-signed token, auth, 30 s heartbeat, backoff reconnect), parses `DANMU_MSG`, filters self-echo, and declares `liveDanmaku` so the Agent answers one danmaku window at a time with read-only tools. Replies are posted as danmaku (`sendMode: direct`, needs SESSDATA + bili_jct; `off` only listens), split by `maxLength` / `maxChunks`, the first mention becomes the platform reply target, with a minimum send interval and a risk-control breaker. Nothing is written to disk.
