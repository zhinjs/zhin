---
'@zhin.js/agent': patch
'@zhin.js/ai': patch
'@zhin.js/runtime': patch
'@zhin.js/cli': patch
---

fix(agent): 本轮策略无法执行 Shell 时不再向模型提供 bash（工具列表与目录同时过滤，load_tool 也无法再加载），万一触发会返回明确、不可重试的错误。新增 `ai.agent.masterShell`（默认 `off`）：设为 `isolated` 时，仅 IM 私聊中的 master 可在 Docker 容器内执行 bash（工作区可写、无网络、development 白名单、白名单外命令需审批），宿主无 Docker 时直接失败、不降级到宿主机。
