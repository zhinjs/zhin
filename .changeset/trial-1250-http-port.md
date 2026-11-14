---
"@zhin.js/host-http": patch
"@zhin.js/runtime": patch
"@zhin.js/gateway": patch
"@zhin.js/cli": patch
"zhin.js": patch
---

`http.port` 校验与默认端口（#1250）：

- `http.port` / `http.listeners[].port` 只接受 1–65535 的整数，或展开后为该范围整数的 `${VAR}` 引用（`0` 保留原含义：由系统分配空闲端口，供测试与嵌入使用）。Host 配置 Schema 收紧（`integer` + `minimum`/`maximum` + 只允许整串 `${VAR}` 的 `pattern`），`zhin config set`、Console 保存与 `plugin:validate-config` 一致拒绝并给出中文原因（如「字段 port 只接受数值或 ${VAR} 形式的环境变量引用」「字段 port 不能大于 65535」）；`zhin config check` 报 `http.port_invalid` 错误（含引用展开后的值）。
- 启动时非法端口直接报错退出，不再悄悄监听默认端口；`${PORT}` 展开得到的数字字符串现在会被正确使用（此前被忽略而回退到默认端口）。
- **未配置 `http.port` 时的默认端口从 8086 改为 8068**，与脚手架写入、文档和 Console 链接一致（8086 常被 InfluxDB 等占用）。已在配置中写了端口的项目不受影响；依赖旧默认值的项目请显式写 `http.port: 8086`。
- `zhin doctor` 按启动方式解析端口（展开 `.env` 中的 `${VAR}`），检查真实生效的端口；无法解析或非法时报错并给出 `zhin config set http.port 8068 --offline`，不再悄悄检查 8086。
- 配置里的端口已损坏且网关未运行时，CLI 配置命令给出离线修复提示，而不是 `Invalid URL`；网关运行时经本地 socket 照常工作。
- `@zhin.js/host-http` 新增导出 `DEFAULT_HTTP_PORT`、`parseHttpPort`、`describeInvalidPortValue`、`InvalidHttpPortError`、`ENVIRONMENT_REFERENCE_PATTERN`。
