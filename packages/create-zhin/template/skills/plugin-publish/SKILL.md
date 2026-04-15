---
name: plugin-publish
description: "发布 Zhin.js 插件到 npm 和 Zhin 插件市场。Use when asked to publish a plugin, prepare for release, check publish readiness, or submit to the Zhin plugin marketplace. 引导完成发布前检查、版本管理和提交流程。"
keywords:
  - 发布
  - publish
  - npm
  - 插件市场
  - marketplace
  - release
  - 版本
  - version
  - changeset
tags:
  - development
  - plugin
  - publish
  - release
---

# Zhin 插件发布

引导将 Zhin.js 插件发布到 npm 和 Zhin 插件市场，确保包结构、元数据和质量符合社区标准。

## 适用场景

- 用户说"发布插件"、"提交到插件市场"、"准备发版"
- 插件开发完成需要分享给社区
- 需要检查插件是否满足发布条件

## 发布前检查清单

### 第 1 步：包元数据检查

验证 `package.json` 必需字段：

```json
{
  "name": "zhin.js-{name}",          // ✅ 社区前缀
  "version": "0.1.0",                 // ✅ 语义化版本
  "type": "module",                    // ✅ ESM
  "description": "插件简介",           // ✅ 非空描述
  "main": "./lib/index.js",           // ✅ 入口指向编译产物
  "types": "./lib/index.d.ts",        // ✅ 类型声明
  "exports": {
    ".": {
      "types": "./lib/index.d.ts",
      "development": "./src/index.ts", // ✅ 开发条件导出
      "import": "./lib/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": [                           // ✅ 发布文件白名单
    "src", "lib", "client", "dist",
    "skills", "tools",
    "README.md", "CHANGELOG.md"
  ],
  "keywords": ["zhin.js", "plugin"],   // ✅ 包含 zhin.js 关键词
  "peerDependencies": {
    "zhin.js": ">=x.x.x"              // ✅ 声明框架兼容版本
  },
  "license": "MIT",                    // ✅ 开源协议
  "repository": { "url": "..." },      // 推荐：仓库地址
  "homepage": "...",                    // 推荐：文档地址
  "author": "..."                       // 推荐：作者信息
}
```

**插件市场识别条件：**
- `name` 以 `zhin.js-` 开头（社区）或 `@zhin.js/` 开头（官方）
- `keywords` 包含 `zhin.js`
- `peerDependencies` 包含 `zhin.js`

### 第 2 步：代码质量检查

```bash
# 1. 类型检查
pnpm build            # 确保 tsc 编译通过，无类型错误

# 2. 运行测试
pnpm test             # 确保所有测试通过

# 3. 覆盖率检查
pnpm test:coverage    # 确保覆盖率达标
```

**质量底线：**
- [ ] `tsc` 编译零错误
- [ ] 所有测试通过
- [ ] 语句覆盖率 ≥ 60%
- [ ] 无 `any` 类型滥用
- [ ] 无未处理的 TODO/FIXME 阻塞发布

### 第 3 步：文档检查

**README.md 必须包含：**
- [ ] 插件功能简介
- [ ] 安装步骤（`pnpm add zhin.js-{name}`）
- [ ] 配置说明（配置项及默认值）
- [ ] 命令列表（如有）
- [ ] AI 工具说明（如有）
- [ ] 使用示例

**CHANGELOG.md 必须包含：**
- [ ] 当前版本的变更记录
- [ ] 遵循 [Keep a Changelog](https://keepachangelog.com/) 格式

**关键词：** 有 `skills/` 目录时，确认 SKILL.md 的 description 准确描述插件能力。

### 第 4 步：构建产物检查

```bash
# 确保 lib/ 目录存在且完整
ls lib/

# 检查将要发布的文件
npm pack --dry-run
```

确认 `npm pack` 输出的文件列表：
- ✅ 包含 `lib/`（编译后的 JS + d.ts）
- ✅ 包含 `src/`（源码，供开发模式使用）
- ✅ 包含 `skills/`（AI 技能描述）
- ✅ 包含 `README.md`、`CHANGELOG.md`
- ❌ 不包含 `node_modules/`、`tests/`、`.env`
- ❌ 不包含 `coverage/`、`.DS_Store`

### 第 5 步：版本管理

**语义化版本规则：**
- `patch` (0.1.0 → 0.1.1)：bug 修复、文档更新
- `minor` (0.1.0 → 0.2.0)：新增功能、新增命令
- `major` (0.1.0 → 1.0.0)：破坏性变更、API 不兼容

```bash
# 更新版本号
npm version patch   # 或 minor / major

# 使用 Changesets（如项目已配置）
pnpm changeset      # 创建变更记录
pnpm changeset version  # 更新版本
```

### 第 6 步：发布

```bash
# 发布到 npm
npm publish --access public

# 如果是 scoped 包（@zhin.js/xxx），需要 --access public
npm publish --access public
```

**首次发布：**
1. 确认已登录 npm：`npm whoami`
2. 如未登录：`npm login`
3. 确认包名未被占用：`npm view zhin.js-{name}`

### 第 7 步：发布后验证

```bash
# 1. 等待 npm 索引更新（通常 1-2 分钟）

# 2. 在新项目中测试安装
pnpm add zhin.js-{name}

# 3. 确认插件可正常加载
# 在 zhin.config 中添加插件名，启动 bot 验证
```

## 常见问题

### 包名已被占用
- 社区插件前缀固定为 `zhin.js-`
- 如果被占用，考虑更具体的名称如 `zhin.js-music-search`

### 发布时 files 不对
- 检查 `.gitignore` 和 `.npmignore`
- 使用 `npm pack --dry-run` 预检

### peerDependencies 版本范围
- 使用 `>=x.x.x` 而不是精确版本
- 确保与当前 zhin.js 最新版本兼容

## 检查清单（发布门禁）

- [ ] `name` 遵循 `zhin.js-{name}` 命名规范
- [ ] `keywords` 包含 `zhin.js`
- [ ] `peerDependencies` 声明 `zhin.js`
- [ ] `type: "module"` 已设置
- [ ] `exports` 包含 types + development + import
- [ ] `files` 白名单正确（含 src、lib、skills）
- [ ] `tsc` 编译通过
- [ ] 所有测试通过
- [ ] 覆盖率达标（≥ 60% statements）
- [ ] README.md 完整
- [ ] CHANGELOG.md 更新
- [ ] SKILL.md description 准确（如有 skills/）
- [ ] `npm pack --dry-run` 文件列表正确
- [ ] 版本号已更新
