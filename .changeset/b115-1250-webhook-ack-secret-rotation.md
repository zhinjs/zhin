---
"@zhin.js/adapter": patch
"@zhin.js/adapter-line": patch
"@zhin.js/adapter-dingtalk": patch
"@zhin.js/adapter-wechat-mp": patch
---

fix(adapters): LINE / 钉钉收到回调先确认再处理；钉钉支持只换 appSecret，微信公众号给出中文原因（#1250 b115）

- LINE Webhook、钉钉 HTTP 回调与 Stream ACK 改用 admit + handoff：事件交给 Runtime 后立即返回 200 / ACK，不再等整轮 Agent 回合；之后的处理失败只记日志。钉钉新增按 `msgId` 去重（并发重投共享同一次交接，成功后保留 24 小时，失败释放可重试）。
- 钉钉实现 `identifyConfiguration`：用 appKey + appSecret 调一次 `gettoken`，失败带钉钉 errcode / errmsg（脱敏，不含密钥）。
- 微信公众号只换 appSecret 时明确拒绝并提示「微信公众号暂不支持只换密钥，请使用替换账号」，不调用任何微信接口。
- adapter：新增 `AdapterIdentityUnsupportedError`，平台在 `identifyConfiguration` 中抛出时原因原样传到 Console，不再被通用提示覆盖。
