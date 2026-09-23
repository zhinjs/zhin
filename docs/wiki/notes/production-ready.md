---
title: 启动后怎样确认可用？
---

# 进程已经启动，怎样确认 Bot 真正可用？

**分三步看：进程活着、Runtime 就绪、平台能实际收发。** 前两项有探针，最后一项必须在目标平台发起一次真实对话；单看“listening”日志不能证明 Bot 可用。

这套检查适合部署后验收。下面的 `8068` 是新项目默认值，使用时应换成终端显示或配置中的实际端口与 `http.base`。

## 先看 Runtime

```bash
curl --fail http://127.0.0.1:8068/pub/health
curl --fail http://127.0.0.1:8068/pub/ready
```

`/pub/health` 只说明 HTTP 进程可响应。`/pub/ready` 在首个 generation 尚未提交时返回 503；就绪时返回 200。需要把指定 Endpoint 或 Agent binding 纳入就绪要求，应在 `http.readiness` 明确配置。

拿到受保护的详细报告，可以用 `zhin doctor --live <API Base> --json`，或请求 `/api/system/readiness`。Doctor 未就绪、鉴权失败或请求失败都会返回非零退出码；先按报告中的具体原因处理。

## 最后走一次平台链路

就绪探针不测试平台传输是否在线，也不验证模型凭据。用目标账号发送一条消息，确认 Bot 收到并能回复；如果依赖主动推送，也单独发一条。把这次收发作为上线验收，而不是从探针结果推断。

就绪配置、鉴权与部署模板见[生产部署](/operations/production)；按症状排查见[故障排查](/troubleshooting/)。
