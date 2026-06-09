---
"@zhin.js/kernel": minor
"@zhin.js/core": minor
"@zhin.js/ai": minor
"@zhin.js/agent": minor
"@zhin.js/host-api": patch
"@zhin.js/adapter-github": patch
"@zhin.js/plugin-group-suite": patch
"@zhin.js/plugin-rss": patch
---

架构优化、类型安全提升与构建系统清理

**kernel** (minor)
- PluginBase.start() 提取 `mountAllContexts()` / `mountContext()` 可覆盖钩子

**core** (minor)
- Plugin.start() 覆盖 `mountAllContexts()` 支持 Context 挂载失败回滚
- Plugin.stop() 委托 `super.stop()` 消除重复代码
- Lifecycle 事件类型化：message.receive → Message, request.receive → Request, notice.receive → Notice

**ai** (minor)
- BaseProvider 提取 `request()` 公共方法，消除 fetch/fetchText/fetchStream 80% 重复代码
- 修复 fetch/fetchText 的 AbortController 泄漏

**agent** (minor)
- 为 7 个模块级单例添加 reset() 函数支持测试隔离
- 修复 8 处 `catch (e: any)` → `catch (e: unknown)`

**host-api / plugins** (patch)
- handlers-db.ts 移除 11 处 `as never` cast，修复 11 处 catch 类型标注
- adapter-github / plugin-group-suite / plugin-rss 移除 inject() 的 `as any` cast
