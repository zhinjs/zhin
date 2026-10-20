# 性能与生命周期检查清单

## generation 与资源释放

- [ ] 每个 listener、timer、watcher、socket、route 和 Host registration 都有 disposer，并归属当前 generation。
- [ ] 启动中途失败会逆序回滚；stop/reload 幂等；旧 generation 的迟到事件不会关闭或污染新实例。
- [ ] WS/SSE/心跳/重连使用 `createEndpointLifecycle`，重点验证 backoff、watchdog、AbortSignal 和 stale event 隔离。
- [ ] 没有模块级 current/latest 单例跨 generation 泄漏。

## 有界状态

- [ ] Map/Set、会话历史、消息缓存、幂等 key、审计队列和 outbox 有删除、TTL、容量或 compaction。
- [ ] Tool/Feature/Adapter 投影在 owner 卸载时同步删除，不保留旧闭包或平台 Client。
- [ ] 日志与错误队列在背压时有明确策略，close 会 flush 或给出可观测失败。

## 热路径

- [ ] 消息解析、命令匹配、Tool 投影和渲染不重复做昂贵解析；缓存绑定到正确 generation。
- [ ] 热路径没有同步文件 I/O、大对象深拷贝、无界 `JSON.stringify` 或每次重新编译正则。
- [ ] 外部 HTTP、数据库和模型请求有 timeout/abort；并发与重试有上限且避免放大外部副作用。

## 异步正确性

- [ ] fire-and-forget Promise 有可观察的错误处理；abort/timeout 与 finally 清理一致。
- [ ] 并发更新共享状态时有 owner、版本或事务边界；未知外部结果不会被盲目重试。
- [ ] 性能结论有基线与相同负载下的测量；静态猜测只列为待验证，不作为确定回归。
