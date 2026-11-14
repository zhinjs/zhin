---
"@zhin.js/core": patch
"@zhin.js/middleware": patch
"@zhin.js/handler": patch
---

`UserFacingError` 扩展到中间件与事件处理器（#1250）：入站中间件（`defineMiddleware`）或事件处理器（`defineHandler`）抛出的 `UserFacingError` 会经正常出站链回复到该会话（中间件以自身为回复作者；处理器在消息 / 通知 / 请求的会话里回复，然后继续下一个处理器）；其他错误仍只记日志。新增内部扩展点：`MiddlewareResultPolicy.refuse` 与 `HandlerDispatchOptions.recover`。
