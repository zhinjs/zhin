---
'@zhin.js/adapter-douyin-live': patch
---

#1135 Phase 2A-F: new Experimental Douyin live danmaku adapter (unofficial protocol). A lightweight WebSocket client (no browser/CDP) resolves the web_rid to the internal room_id, connects to the webcast push socket (optional external `signerUrl`, no vendored platform script), decodes gzip `PushFrame` → `Response` with a minimal protobuf reader and parses only `WebcastChatMessage`, with heartbeat, ack, watchdog and backoff reconnect. It declares `liveDanmaku`, so danmaku join the ADR 0038 E1 window; the conversation id is the web_rid and `metadata` carries `{ roomId: <internal room_id>, liveDanmaku: true }`. Outbound is listen-only: `sendMode` defaults to `off`, and `direct` returns `not_implemented`. Nothing is written to disk.
