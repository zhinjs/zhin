---
"@zhin.js/agent": patch
"@zhin.js/host-http": patch
"@zhin.js/gateway": patch
"@zhin.js/cli": patch
"zhin.js": patch
---

AI 账号与 Host 环境变量（#1250）：Console 引用 Host 环境变量收紧为仅全局 owner、变量名以 `_API_KEY` 结尾、服务为已存在或内置服务官方地址（其他 Console 用户返回明确中文原因 `reason`）；新增本机命令 `zhin ai account add / rename-env / test`（只经网关控制套接字，写审计，不回显值）及对应实例路由 `POST {base}/agent/inference/cli/account/add`、`/cli/account/rename-env`；新增 `POST /agent/inference/probe` 与 `/account/test` 连通性探测（带 tools 的最小请求，成功时激活凭据）。账号状态新增 `environment`（`env://` 账号无凭据时的环境变量就绪情况）与 `lastCall`（本进程最近一次真实调用结果）。`@zhin.js/host-http` 导出 `isLocalSocketPrincipal`、`isGlobalOwnerPrincipal`、`LOCAL_SOCKET_USER_ID`、`LOCAL_SOCKET_CREDENTIAL_ID`。
