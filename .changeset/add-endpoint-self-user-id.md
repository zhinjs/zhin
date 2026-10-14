---
"@zhin.js/adapter": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-sandbox": patch
---

Endpoint 新增运行期 `selfUserId` 访问器与受保护的 `reportSelfUserId()`（`EndpointImplementation` 另可声明 `selfUserId`，`EndpointActivationContext` 提供 `reportSelfUserId`），并新增进程级 Peer Registry（`getProcessPeerRegistry()` / `createPeerRegistry()`）。账号仅在 generation active 后登记，回滚 / retire / stop 后移除；`EndpointIdentity` 保持不可变。ICQQ 在 `system.online` 上报 uin；OneBot11 ws/wss 从事件 `self_id` 与 `get_login_info` 上报；Sandbox 以配置的 bot id 作为合成账号。未上报的旧 Endpoint 不进入 Registry（fail closed），不会用配置 id 兜底。OneBot12 / napcat / milky 等其余适配器留待后续。
