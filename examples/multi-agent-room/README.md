# multi-agent-room

同一 IM 群内 **两个 Sandbox Endpoint** 协作的参考配置。协作单元存 **数据库**（`collaboration_scenes` + `collaboration_scene_members`），通过 REST 或群内 `/collab` 指令管理。

## 架构要点

- **SSOT**：`collaboration_scenes` + `collaboration_scene_members`（多进程共享同一 DB 即可对齐）
- **管理面**：Scene CRUD + Member 子资源 + Endpoint 反查；群内 **master** 可用 `/collab` 指令
- **成员**：`/collab init` 后使用 `/collab bind` 挂载 Bot；可选在 yaml 配置 `collaboration.roster` 作为 init 模板

## 快速开始

```bash
cd examples/multi-agent-room
pnpm install
pnpm dev
```

在 Sandbox 协作群内（master 身份）发送：

```
/collab init
```

## REST 示例

创建协作 Scene（可带 members 一次性写入，或先建空 Scene 再挂成员）：

```bash
curl -X POST http://127.0.0.1:8788/api/collaboration/scenes \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "sandbox-room-alpha",
    "adapter": "sandbox",
    "sceneId": "multi-agent-room",
    "goal": "演示多 Bot 协作",
    "members": [
      { "endpointId": "planner-bot", "primary": "planner", "peerSenderId": "planner-bot" },
      { "endpointId": "researcher-bot", "primary": "researcher", "peerSenderId": "researcher-bot" }
    ]
  }'
```

成员子资源：

```bash
curl http://127.0.0.1:8788/api/collaboration/scenes/sandbox-room-alpha/members
curl -X POST http://127.0.0.1:8788/api/collaboration/scenes/sandbox-room-alpha/members \
  -H 'Content-Type: application/json' \
  -d '{"endpointId":"writer-bot","primary":"writer"}'
curl -X PUT http://127.0.0.1:8788/api/collaboration/scenes/sandbox-room-alpha/members/writer-bot \
  -H 'Content-Type: application/json' \
  -d '{"primary":"writer","role":"worker"}'
curl -X DELETE http://127.0.0.1:8788/api/collaboration/scenes/sandbox-room-alpha/members/writer-bot
```
