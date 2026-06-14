---
"@zhin.js/agent": patch
"@zhin.js/core": patch
"@zhin.js/host-api": patch
---

refactor: 网络策略统一、core 导出整理、Disposable 接口、Bot 图标修复

- 新增 `security/network-policy.ts` 统一 SSRF 防护、域名匹配、网络命令检测
- `core/index.ts` 移除死导出、统一结构
- 新增 `Disposable` 接口替代 `as any` dispose 调用
- `bridge.ts` MCP inputSchema 类型安全
- 脚手架依赖版本锁定（latest → ^major.minor.0）
- 修复 icqq/sandbox 客户端缺失 Bot 图标导入
