# @zhin.js/adapter-douyin-live

## 0.1.5

### Patch Changes

- Updated dependencies [0d76a7c]
  - @zhin.js/adapter@1.1.32
  - @zhin.js/core@1.1.60

## 0.1.4

### Patch Changes

- Updated dependencies [8adce16]
  - @zhin.js/core@1.1.59
  - @zhin.js/adapter@1.1.31
  - @zhin.js/feature-kit@1.1.15

## 0.1.3

### Patch Changes

- Updated dependencies [008ccad]
- Updated dependencies [a1f1028]
  - @zhin.js/core@1.1.58
  - @zhin.js/im-contract@1.1.13
  - @zhin.js/adapter@1.1.30
  - @zhin.js/feature-kit@1.1.14

## 0.1.2

### Patch Changes

- Updated dependencies [6163abc]
- Updated dependencies [bc6ccb1]
- Updated dependencies [72b5a12]
  - @zhin.js/core@1.1.57
  - @zhin.js/im-contract@1.1.12
  - @zhin.js/adapter@1.1.29
  - @zhin.js/feature-kit@1.1.13

## 0.1.1

### Patch Changes

- 3bcf636: #1135 Phase 2A-F: new Experimental Douyin live danmaku adapter (unofficial protocol). A lightweight WebSocket client (no browser/CDP) resolves the web_rid to the internal room_id, connects to the webcast push socket (optional external `signerUrl`, no vendored platform script), decodes gzip `PushFrame` → `Response` with a minimal protobuf reader and parses only `WebcastChatMessage`, with heartbeat, ack, watchdog and backoff reconnect. It declares `liveDanmaku`, so danmaku join the ADR 0038 E1 window; the conversation id is the web_rid and `metadata` carries `{ roomId: <internal room_id>, liveDanmaku: true }`. Outbound is listen-only: `sendMode` defaults to `off`, and `direct` returns `not_implemented`. Nothing is written to disk.
- Updated dependencies [b249e5e]
- Updated dependencies [57661f6]
- Updated dependencies [cbd3f14]
- Updated dependencies [299863a]
- Updated dependencies [aaa93d7]
- Updated dependencies [4fe49b5]
- Updated dependencies [b652db3]
- Updated dependencies [0315ba0]
  - @zhin.js/core@1.1.56
  - @zhin.js/adapter@1.1.28
  - @zhin.js/im-contract@1.1.11
  - @zhin.js/feature-kit@1.1.12
