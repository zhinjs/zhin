# 安全政策 | Security Policy

[English](#english) | [中文](#中文)

---

## 中文

### 🔒 支持的版本

我们为以下版本提供安全更新：

| 版本 | 支持状态 |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

### 📢 报告漏洞

Zhin.js 团队和社区非常重视安全问题。我们感谢您帮助我们保护项目的安全。

#### 如何报告

如果您发现了安全漏洞，请**不要**通过 GitHub Issues 公开报告。请通过以下方式私下向我们披露：

1. **主要方式**：通过 GitHub Security Advisory 私下报告
   - 访问项目的 [Security Advisories](https://github.com/zhinjs/zhin/security/advisories) 页面
   - 点击 "Report a vulnerability"

#### 报告内容应包括

为了帮助我们更快地理解和修复问题，请在报告中包含：

- 漏洞的详细描述
- 重现步骤（如果可能，提供 PoC）
- 受影响的版本
- 潜在影响和严重程度
- 您认为可能的修复方案（可选）
- 您的联系方式

#### 响应时间表

- **确认接收**：我们会在 48 小时内确认收到您的报告
- **初步评估**：5 个工作日内提供初步评估和预计修复时间
- **修复发布**：根据严重程度，我们将尽快发布修复版本
  - 严重漏洞：7-14 天
  - 中等漏洞：14-30 天
  - 低危漏洞：30-60 天

#### 漏洞奖励计划

目前我们没有正式的漏洞奖励计划，但我们会：

- 在修复公告中感谢报告者（如果您希望）
- 将您的贡献记录在项目的安全致谢列表中

### 🛡️ 安全最佳实践

#### 对于用户

1. **保持更新**
   - 始终使用最新的稳定版本
   - 定期检查并应用安全更新
   ```bash
   pnpm update @zhin.js/* --latest
   ```

2. **保护凭证**
   - 永远不要将 `.env` 文件提交到版本控制
   - 使用强密码保护 Web 控制台
   - 定期轮换 API 密钥和令牌

3. **访问控制**
   - 限制 Web 控制台的访问（使用防火墙规则）
   - 在生产环境中使用 HTTPS
   - 考虑使用反向代理（如 Nginx）增加安全层

4. **依赖安全**
   - 定期运行安全审计
   ```bash
   pnpm audit
   pnpm audit --fix  # 自动修复低风险漏洞
   ```

5. **配置安全**
   - 审查插件权限
   - 禁用不需要的功能
   - 使用最小权限原则配置机器人账号

6. **生产环境配置**
   - 避免在 `plugin_dirs` 中配置 `node_modules`（会监听大量文件）
   - 使用环境变量区分开发和生产配置
   ```bash
   # 生产环境启动
   NODE_ENV=production pnpm start
   ```
   - 在生产环境中仅加载必要的插件目录
   ```typescript
   plugin_dirs: [
     './plugins',  // ✅ 仅监听项目插件目录
     // 'node_modules',  // ❌ 避免监听整个 node_modules
   ]
   ```

#### 对于插件开发者

1. **输入验证**
   - 始终验证和清理用户输入
   - 使用 Schema 系统进行类型检查
   ```typescript
   import { Schema, defineSchema } from 'zhin.js'
   
   defineSchema(Schema.object({
     url: Schema.string().pattern(/^https?:\/\//),  // 验证 URL 格式
     count: Schema.number().min(1).max(100)         // 限制数值范围
   }))
   ```

2. **防止注入攻击**
   - 使用参数化查询，避免 SQL 注入
   ```typescript
   // ✅ 正确：使用参数化查询
   await db.model('users').findOne({ where: { id: userId } })
   
   // ❌ 错误：拼接 SQL
   await db.query(`SELECT * FROM users WHERE id = ${userId}`)
   ```

3. **敏感数据处理**
   - 不要在日志中记录敏感信息
   - 使用环境变量存储密钥
   - 加密存储敏感数据
   ```typescript
   // ✅ 正确：使用环境变量
   const apiKey = process.env.API_KEY
   
   // ❌ 错误：硬编码密钥
   const apiKey = 'sk-1234567890abcdef'
   ```

4. **权限控制**
   - 实现适当的权限检查
   - 使用中间件进行访问控制
   ```typescript
   addCommand(new MessageCommand('admin')
     .use(async (message, next) => {
       if (!message.sender.isAdmin) {
         return '权限不足'
       }
       return next()
     })
     .action(async () => {
       // 管理员操作
     })
   )
   ```

5. **依赖管理**
   - 仅使用可信赖的依赖包
   - 定期更新依赖到安全版本
   - 审查依赖的安全公告

6. **错误处理**
   - 不要泄露敏感的错误信息
   - 实现适当的错误边界
   ```typescript
   try {
     // 操作
   } catch (error) {
     logger.error('操作失败', error)  // 仅在日志中记录详细信息
     return '操作失败，请稍后重试'     // 向用户返回通用信息
   }
   ```

### ⚠️ 已知安全注意事项

1. **Web 控制台访问**
   - 默认配置下，Web 控制台监听所有接口（0.0.0.0）
   - 建议在生产环境中限制访问来源
   - 使用强密码并考虑启用双因素认证（未来版本）

2. **插件系统**
   - 插件在同一进程中运行，具有完整的系统访问权限
   - 仅安装来自可信来源的插件
   - 审查插件代码，特别是涉及文件系统和网络访问的部分

3. **配置文件**
   - TypeScript 配置文件（`zhin.config.ts`）在运行时执行
   - 不要从不可信来源加载配置文件

4. **热重载功能**
   - 开发环境功能，不建议在生产环境中启用
   - 可能导致未经授权的代码执行

5. **文件监听性能**
   - 避免监听 `node_modules` 等大型目录
   - 在生产环境中禁用文件监听（设置 `NODE_ENV=production`）
   - 监听大量文件可能导致服务器资源耗尽（inotify 限制）
   - 建议仅在 `plugin_dirs` 中指定实际插件目录路径

### 🔐 安全功能路线图

我们计划在未来版本中引入：

- [ ] 插件权限系统（细粒度权限控制）
- [ ] 代码签名验证（验证插件完整性）
- [ ] 审计日志（记录敏感操作）
- [ ] 双因素认证（增强控制台安全）
- [ ] 沙箱环境（隔离插件执行）
- [x] 自动安全扫描（CI/CD 集成）

### 📞 联系方式

- **安全问题**：[security@zhin.dev](mailto:security@zhin.dev)
- **一般问题**：[GitHub Issues](https://github.com/zhinjs/zhin/issues)
- **讨论**：[GitHub Discussions](https://github.com/zhinjs/zhin/discussions)

---

## English

### 🔒 Supported Versions

We provide security updates for the following versions:

| Version | Support Status     |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

### 📢 Reporting a Vulnerability

The Zhin.js team and community take security issues seriously. We appreciate your efforts to responsibly disclose your findings.

#### How to Report

If you discover a security vulnerability, please **DO NOT** report it publicly via GitHub Issues. Instead, please disclose it privately through one of the following methods:

1. **Preferred Method**: Email us at [security@zhin.dev](mailto:security@zhin.dev)
2. **Alternative**: Report privately via GitHub Security Advisory
   - Visit the project's [Security Advisories](https://github.com/zhinjs/zhin/security/advisories) page
   - Click "Report a vulnerability"

#### What to Include

To help us understand and fix the issue faster, please include:

- Detailed description of the vulnerability
- Steps to reproduce (provide PoC if possible)
- Affected versions
- Potential impact and severity
- Possible fix suggestions (optional)
- Your contact information

#### Response Timeline

- **Acknowledgment**: We will acknowledge receipt within 48 hours
- **Initial Assessment**: Initial assessment and estimated fix timeline within 5 business days
- **Fix Release**: Depending on severity, we will release a fix as soon as possible
  - Critical: 7-14 days
  - Medium: 14-30 days
  - Low: 30-60 days

#### Bug Bounty Program

We currently do not have a formal bug bounty program, but we will:

- Credit you in the security advisory (if you wish)
- List your contribution in the project's security acknowledgments

### 🛡️ Security Best Practices

#### For Users

1. **Keep Updated**
   - Always use the latest stable version
   - Regularly check and apply security updates
   ```bash
   pnpm update @zhin.js/* --latest
   ```

2. **Protect Credentials**
   - Never commit `.env` files to version control
   - Use strong passwords for Web console
   - Regularly rotate API keys and tokens

3. **Access Control**
   - Restrict Web console access (use firewall rules)
   - Use HTTPS in production
   - Consider using a reverse proxy (e.g., Nginx) for additional security

4. **Dependency Security**
   - Regularly run security audits
   ```bash
   pnpm audit
   pnpm audit --fix  # Auto-fix low-risk vulnerabilities
   ```

5. **Configuration Security**
   - Review plugin permissions
   - Disable unnecessary features
   - Use least privilege principle for bot accounts

6. **Production Environment Configuration**
   - Avoid configuring `node_modules` in `plugin_dirs` (watches too many files)
   - Use environment variables to distinguish dev and production configs
   ```bash
   # Production startup
   NODE_ENV=production pnpm start
   ```
   - Load only necessary plugin directories in production
   ```typescript
   plugin_dirs: [
     './plugins',  // ✅ Only watch project plugin directory
     // 'node_modules',  // ❌ Avoid watching entire node_modules
   ]
   ```

#### For Plugin Developers

1. **Input Validation**
   - Always validate and sanitize user input
   - Use Schema system for type checking
   ```typescript
   import { Schema, defineSchema } from 'zhin.js'
   
   defineSchema(Schema.object({
     url: Schema.string().pattern(/^https?:\/\//),  // Validate URL format
     count: Schema.number().min(1).max(100)         // Limit numeric range
   }))
   ```

2. **Prevent Injection Attacks**
   - Use parameterized queries to prevent SQL injection
   ```typescript
   // ✅ Correct: Use parameterized queries
   await db.model('users').findOne({ where: { id: userId } })
   
   // ❌ Wrong: Concatenate SQL
   await db.query(`SELECT * FROM users WHERE id = ${userId}`)
   ```

3. **Sensitive Data Handling**
   - Don't log sensitive information
   - Store secrets in environment variables
   - Encrypt sensitive data at rest
   ```typescript
   // ✅ Correct: Use environment variables
   const apiKey = process.env.API_KEY
   
   // ❌ Wrong: Hardcode secrets
   const apiKey = 'sk-1234567890abcdef'
   ```

4. **Permission Control**
   - Implement proper permission checks
   - Use middleware for access control
   ```typescript
   addCommand(new MessageCommand('admin')
     .use(async (message, next) => {
       if (!message.sender.isAdmin) {
         return 'Insufficient permissions'
       }
       return next()
     })
     .action(async () => {
       // Admin operations
     })
   )
   ```

5. **Dependency Management**
   - Only use trusted dependency packages
   - Regularly update dependencies to secure versions
   - Review security advisories for dependencies

6. **Error Handling**
   - Don't leak sensitive error information
   - Implement proper error boundaries
   ```typescript
   try {
     // Operations
   } catch (error) {
     logger.error('Operation failed', error)  // Log details only in logs
     return 'Operation failed, please try again later'  // Generic message to users
   }
   ```

### ⚠️ Known Security Considerations

1. **Web Console Access**
   - By default, Web console listens on all interfaces (0.0.0.0)
   - Recommend restricting access sources in production
   - Use strong passwords and consider enabling 2FA (future version)

2. **Plugin System**
   - Plugins run in the same process with full system access
   - Only install plugins from trusted sources
   - Review plugin code, especially filesystem and network access

3. **Configuration Files**
   - TypeScript config files (`zhin.config.ts`) execute at runtime
   - Don't load config files from untrusted sources

4. **Hot Reload Feature**
   - Development environment feature, not recommended for production
   - May lead to unauthorized code execution

5. **File Watching Performance**
   - Avoid watching large directories like `node_modules`
   - Disable file watching in production (set `NODE_ENV=production`)
   - Watching too many files can exhaust server resources (inotify limits)
   - Recommend specifying only actual plugin directories in `plugin_dirs`

### 🔐 Security Roadmap

We plan to introduce in future versions:

- [ ] Plugin permission system (fine-grained permission control)
- [ ] Code signing verification (verify plugin integrity)
- [ ] Audit logging (record sensitive operations)
- [ ] Two-factor authentication (enhance console security)
- [ ] Sandbox environment (isolate plugin execution)
- [x] Automated security scanning (CI/CD integration)

### 📞 Contact

- **Security Issues**: [security@zhin.dev](mailto:security@zhin.dev)
- **General Issues**: [GitHub Issues](https://github.com/zhinjs/zhin/issues)
- **Discussions**: [GitHub Discussions](https://github.com/zhinjs/zhin/discussions)

---

**Last Updated**: November 2025

