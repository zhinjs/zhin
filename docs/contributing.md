# 🤝 贡献指南

感谢您对 Zhin.js 项目的关注！本指南将帮助您了解如何为项目做出贡献。

## 🎯 贡献方式

### 报告问题
- 🐛 **Bug 报告**: 使用 [Bug 报告模板](https://github.com/zhinjs/zhin/issues/new?template=bug_report.yml)
- ✨ **功能请求**: 使用 [功能请求模板](https://github.com/zhinjs/zhin/issues/new?template=feature_request.yml)
- 💬 **讨论**: 在 [Discussions](https://github.com/zhinjs/zhin/discussions) 中参与讨论

### 代码贡献
- 🔧 **修复 Bug**: 修复已知问题
- ✨ **新功能**: 实现新功能
- 📚 **文档**: 改进文档
- 🧪 **测试**: 添加或改进测试

## 🚀 开发环境设置

### 1. 克隆仓库
```bash
git clone https://github.com/zhinjs/zhin.git
cd zhin
```

### 2. 安装依赖
```bash
# 使用 pnpm (推荐)
pnpm install

# 或使用 npm
npm install
```

### 3. 构建项目
```bash
# 构建所有包
pnpm build

# 构建特定包
pnpm build --filter @zhinjs/core
```

### 4. 运行测试
```bash
# 运行所有测试
pnpm test

# 运行特定包的测试
pnpm test --filter @zhinjs/core
```

### 5. 开发模式
```bash
# 启动开发服务器
pnpm dev

# 监听模式构建
pnpm build:watch
```

## 📝 代码规范

### TypeScript 规范
- 使用 TypeScript 编写所有代码
- 遵循严格的类型检查
- 使用 ESLint 和 Prettier 格式化代码

### 代码风格
```typescript
// ✅ 好的示例
interface UserConfig {
  name: string;
  age: number;
  email?: string;
}

class UserManager {
  private users: Map<string, UserConfig> = new Map();
  
  async addUser(user: UserConfig): Promise<void> {
    // 实现逻辑
  }
}

// ❌ 避免的写法
function addUser(user: any) {
  // 避免使用 any 类型
}
```

### 提交信息规范
使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
feat: 添加新功能
fix: 修复 bug
docs: 更新文档
style: 代码格式调整
refactor: 代码重构
test: 添加测试
chore: 构建过程或辅助工具的变动
```

示例：
```bash
git commit -m "feat: 添加用户认证功能"
git commit -m "fix: 修复消息解析错误"
git commit -m "docs: 更新 API 文档"
```

## 🔧 开发流程

### 1. 创建分支
```bash
# 从 main 分支创建新分支
git checkout main
git pull origin main
git checkout -b feature/your-feature-name

# 或修复 bug
git checkout -b fix/your-bug-fix
```

### 2. 开发功能
- 编写代码
- 添加测试
- 更新文档
- 确保所有测试通过

### 3. 提交代码
```bash
# 添加修改的文件
git add .

# 提交更改
git commit -m "feat: 添加新功能"

# 推送到远程仓库
git push origin feature/your-feature-name
```

### 4. 创建 Pull Request
1. 在 GitHub 上创建 Pull Request
2. 填写详细的描述
3. 关联相关 Issue
4. 等待代码审查

## 🧪 测试指南

### 单元测试
```typescript
// tests/example.test.ts
import { describe, it, expect } from 'vitest';
import { createApp } from '@zhinjs/core';

describe('App', () => {
  it('should create app instance', async () => {
    const app = await createApp();
    expect(app).toBeDefined();
  });
});
```

### 集成测试
```typescript
// tests/integration.test.ts
import { describe, it, expect } from 'vitest';
import { createApp } from '@zhinjs/core';

describe('Integration Tests', () => {
  it('should handle message flow', async () => {
    const app = await createApp({
      bots: [{ name: 'test-bot', context: 'process' }]
    });
    
    await app.start();
    
    // 测试消息处理逻辑
    // ...
    
    await app.stop();
  });
});
```

### 测试覆盖率
确保测试覆盖率达到要求：
```bash
# 运行测试并生成覆盖率报告
pnpm test:coverage
```

## 📚 文档贡献

### 文档结构
```
docs/
├── guide/           # 指南文档
├── api/            # API 文档
├── plugin/         # 插件开发文档
├── adapter/        # 适配器开发文档
├── examples/       # 示例代码
└── contributing.md # 贡献指南
```

### 文档规范
- 使用 Markdown 格式
- 包含代码示例
- 添加适当的链接
- 保持内容更新

### 添加新文档
1. 在相应目录创建 `.md` 文件
2. 更新 `README.md` 中的链接
3. 确保文档格式正确

## 🔍 代码审查

### 审查要点
- **功能正确性**: 代码是否按预期工作
- **代码质量**: 是否遵循最佳实践
- **性能影响**: 是否影响性能
- **安全性**: 是否存在安全漏洞
- **可维护性**: 代码是否易于理解和维护

### 审查流程
1. 自动检查 (CI/CD)
2. 代码审查
3. 测试验证
4. 合并代码

## 🐛 Bug 报告

### 报告前检查
- [ ] 搜索现有 Issue
- [ ] 确认是 Bug 还是功能请求
- [ ] 收集相关信息

### 报告内容
- **问题描述**: 清晰描述问题
- **重现步骤**: 详细的重现步骤
- **预期行为**: 期望的正确行为
- **实际行为**: 实际发生的行为
- **环境信息**: 操作系统、Node.js 版本等
- **错误日志**: 相关的错误信息

### 示例报告
```markdown
## 问题描述
在发送消息时出现解析错误

## 重现步骤
1. 创建新的机器人实例
2. 发送包含特殊字符的消息
3. 观察错误

## 预期行为
消息应该正常发送

## 实际行为
抛出解析错误异常

## 环境信息
- 操作系统: macOS 14.0
- Node.js 版本: 20.19.0
- Zhin.js 版本: 1.0.0

## 错误日志
```
Error: Message parsing failed
    at MessageParser.parse (src/parser.ts:45:12)
    at Bot.sendMessage (src/bot.ts:123:8)
```
```

## ✨ 功能请求

### 请求前检查
- [ ] 搜索现有 Issue
- [ ] 确认功能是否已存在
- [ ] 考虑实现复杂度

### 请求内容
- **功能描述**: 详细描述新功能
- **使用场景**: 说明使用场景
- **实现建议**: 提供实现建议
- **替代方案**: 考虑其他解决方案

## 🏷️ 标签说明

### Issue 标签
- `bug`: Bug 报告
- `enhancement`: 功能请求
- `question`: 问题咨询
- `documentation`: 文档相关
- `good first issue`: 适合新手的 Issue
- `help wanted`: 需要帮助的 Issue
- `priority: high`: 高优先级
- `priority: medium`: 中优先级
- `priority: low`: 低优先级

### PR 标签
- `ready for review`: 准备审查
- `work in progress`: 进行中
- `needs testing`: 需要测试
- `breaking change`: 破坏性变更

## 📞 获取帮助

### 社区支持
- 💬 [Discussions](https://github.com/zhinjs/zhin/discussions)
- 📧 邮件支持
- 📖 [文档](https://zhin.js.org)

### 开发支持
- 🔧 开发环境问题
- 🐛 调试帮助
- 📚 代码审查

## 🎉 贡献者

感谢所有为 Zhin.js 项目做出贡献的开发者！

### 如何成为贡献者
1. 提交有价值的贡献
2. 积极参与社区讨论
3. 帮助其他开发者
4. 维护项目质量

## 📄 许可证

本项目采用 MIT 许可证，详见 [LICENSE](https://github.com/zhinjs/zhin/blob/main/LICENSE) 文件。

---

再次感谢您的贡献！让我们一起打造更好的 Zhin.js 框架！ 🚀
