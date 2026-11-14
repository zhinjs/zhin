---
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"zhin.js": patch
---

服务地址可以改了（#1250 `service-baseurl-immutable`）：没有账号引用的服务可以任意修改地址；已被账号引用的服务只允许改 URL 路径（协议、主机、端口不变，例如把 `https://byesu.com` 改成 `https://byesu.com/v1`），换主机仍然拒绝——账号的密钥只能发往原来的主机。拒绝时返回新的 `ProviderError` 代码 `service-origin-change`（HTTP 409），Console 拿到的错误文案说明原因并建议「复制为新服务」。另外，模型请求拿到 2xx 却不是 JSON / 事件流（例如少了 `/v1` 时返回站点首页 HTML）时，改为明确的 `non_json_response` 失败类型（「服务返回的不是 JSON（可能少了 /v1）」），不再是看不懂的 SDK 解析错误，也不会重试；连接测试与聊天失败提示都会用到它。
