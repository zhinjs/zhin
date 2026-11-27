---
"@zhin.js/adapter": patch
"@zhin.js/adapter-line": patch
"@zhin.js/adapter-dingtalk": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-wechat-mp": patch
"zhin.js": patch
---

fix(adapters): LINE / 钉钉收到回调先确认再处理；钉钉、飞书支持只换 appSecret，微信公众号给出中文原因（#1250 b115）

- LINE Webhook、钉钉 HTTP 回调与 Stream ACK 改用 admit + handoff：事件交给 Runtime 后立即返回 200 / ACK，不再等整轮 Agent 回合；之后的处理失败只记日志。钉钉新增按 `msgId` 去重（并发重投共享同一次交接，成功后保留 24 小时，失败释放可重试）。钉钉 HTTP 回调交接失败返回 503（与 LINE 一致）；端点关闭时不再把该 `msgId` 记为已处理，Stream 也不 ACK。
- adapter：`identifyConfiguration` 新增可选的第四个参数 `{ role: 'previous' | 'next' }`（未改的适配器照常编译运行）。旧配置的密钥可能已失效，平台可对 `previous` 离线给出身份，只对 `next` 调接口核验。
- 钉钉实现 `identifyConfiguration`：身份只看 appKey（`apiBaseUrl` 是接口入口，可为反向代理，改它不再被当作换账号）；只用新 appSecret 调一次 `gettoken`，旧密钥已重置或吊销也能完成。失败带钉钉 errcode / errmsg（脱敏，不含密钥；errcode 非数字时为 `unknown`）。
- 飞书：旧配置离线给出身份（appId + 平台区域 origin），只用新密钥读取一次机器人信息核验。
- 微信公众号只换 appSecret 时明确拒绝并提示「微信公众号暂不支持只换密钥，请使用替换账号」，不调用任何微信接口。
- adapter：新增 `AdapterIdentityUnsupportedError`（`name` 为同名），平台在 `identifyConfiguration` 中抛出时原因经脱敏、截断（200 字符）后传到 Console，不再被通用提示覆盖；按品牌字段识别而非 `instanceof`，插件自带另一份副本也能识别。
- 兼容性：`@zhin.js/adapter-wechat-mp` 从 `zhin.js/adapter` 导入 `AdapterIdentityUnsupportedError`，需要随本次发布的 `zhin.js`（peer `workspace:^` 发布时解析为本次版本起）；只升级微信公众号适配器而保留旧版 `zhin.js` 会加载失败，请一并升级。
