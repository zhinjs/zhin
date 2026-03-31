# 安全检查清单

逐项检查，标记状态：✅ 通过 / ⚠️ 需关注 / ❌ 发现问题

## 1. 代码执行 [严重]

- [ ] **eval / Function 构造器**
  - 搜索：`eval(`, `new Function(`, `Function(`
  - 重点文件：`packages/agent/src/builtin-tools.ts`, `packages/kernel/src/`
  - 验证：所有动态代码执行是否有沙箱隔离

- [ ] **Shell 命令执行**
  - 搜索：`exec(`, `execSync(`, `spawn(`, `child_process`
  - 重点文件：`basic/cli/src/commands/doctor.ts`
  - 验证：所有命令参数是否经过转义，是否使用 `execFile` 替代 `exec`

- [ ] **动态导入**
  - 搜索：`import(` 拼接用户输入的路径
  - 重点文件：`packages/core/src/plugin.ts`（热重载机制）
  - 验证：导入路径是否限制在安全目录内

## 2. 注入攻击 [严重]

- [ ] **SQL 注入**
  - 重点文件：`basic/database/src/`
  - 验证：所有 SQL 查询是否使用参数化绑定
  - 检查 `where` 条件构建是否拼接字符串

- [ ] **命令注入**
  - 重点文件：`packages/agent/src/builtin-tools.ts`
  - 验证：bash 命令参数是否经过 `checkBashCommandSafety()`
  - 检查正则 `[\s;|&]` 分割是否可被绕过

- [ ] **XSS / HTML 注入**
  - 重点文件：`packages/satori/src/html-to-svg.ts`
  - 验证：用户输入是否在 HTML 渲染前转义
  - 检查 SVG 输出是否包含 `<script>` 等危险标签

## 3. 认证与授权 [高]

- [ ] **Token 比较**
  - 文件：`plugins/services/http/src/index.ts`
  - 验证：是否使用 `crypto.timingSafeEqual()` 防止时序攻击
  - 当前状态：使用 `===` 直接比较（⚠️ 时序攻击风险）

- [ ] **Token 传输**
  - 验证：是否仅接受 `Authorization: Bearer` 头
  - 当前状态：同时接受 `query.token`（⚠️ 日志泄漏风险）

- [ ] **错误信息**
  - 验证：401 响应是否区分 "missing" 和 "invalid"
  - 当前状态：区分两种错误（⚠️ 可枚举 token 存在性）

- [ ] **公共路径**
  - 验证：`/pub/` 前缀路径不暴露敏感数据
  - 检查是否有 API 意外放行

## 4. 敏感信息 [高]

- [ ] **硬编码凭据**
  - 搜索关键词：`token`, `password`, `secret`, `apiKey`, `api_key`
  - 排除：类型定义、接口声明
  - 验证：所有凭据从配置文件或环境变量读取

- [ ] **日志泄漏**
  - 搜索 `logger.info`, `logger.debug`, `console.log`
  - 验证：不输出 token、密码等敏感字段
  - 检查错误堆栈是否包含请求体中的敏感信息

- [ ] **错误响应**
  - 验证：HTTP 错误响应不包含堆栈跟踪
  - 验证：不暴露内部文件路径、数据库结构

## 5. 文件访问 [中]

- [ ] **路径遍历**
  - 搜索文件读写操作中的用户输入
  - 验证：路径经过 `path.resolve` + 边界检查
  - 重点：`packages/agent/src/file-policy.ts` 黑名单完整性

- [ ] **文件上传**
  - 检查是否有文件上传功能
  - 验证：文件类型白名单、大小限制

## 6. 依赖安全 [低]

- [ ] **已知漏洞**
  - 运行 `pnpm audit`
  - 检查 `pnpm-lock.yaml` 中高危依赖版本

- [ ] **原型污染**
  - 搜索 `Object.assign(`, `_.merge(`, `_.extend(`
  - 验证：对象合并操作是否使用安全方法
