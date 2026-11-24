---
"@zhin.js/gateway": patch
"@zhin.js/host-http": patch
---

修复 `zhin restart` 期间网关偶发返回 `502 instance_error`（#1250 第 103 批）：停止中的实例会先以 `http.response.error`（`Instance stopping`）结束尚未答复的转发请求，而此时传输仍处于就绪状态，网关因此把它当成实例故障。现在监管器处于停止、重启或启动阶段（状态不是 `running`）时，转发失败一律返回 `503 instance_unavailable` 并带 `Retry-After`；实例正常运行时的超时（504）与桥接失败（502）照旧，实例自己返回的错误响应也照旧原样转发。`InstanceTransportError` 新增 `dispatched`（请求是否已送到实例），网关据此如实填写 `requestOutcome`：只有确实没送出的请求才是 `not-dispatched`，实例中途退出的请求改报 `unknown`。
