# Windows 初始化指南

Windows 用户在首次初始化 Zhin.js 项目时可能遇到一些常见问题。本指南提供详细的排查步骤和解决方案。

## 快速开始（Windows）

### 前置要求

- **Node.js**: 20.19.0+ 或 22.12.0+
  - 下载地址：https://nodejs.org
  - 验证: 打开 PowerShell，运行 `node --version`
  
- **pnpm**: 9.0+
  - 安装: `npm install -g pnpm`
  - 验证: 运行 `pnpm --version`

### 标准初始化流程

1. **创建新项目**
   ```powershell
   npm create zhin-app my-bot
   cd my-bot
   ```
   
   或从现有项目初始化：
   ```powershell
   cd your-project
   pnpm install
   ```

2. **启动开发服务器**（推荐首先尝试）
   ```powershell
   pnpm dev
   ```
   
   此命令会启动热重载开发环境，任何代码修改都会自动重新加载。
   
   **预期输出**:
   ```
   ✅ 机器人已启动
   💻 Web 控制台: http://localhost:8086
   ```

3. **生产启动**（可选）
   ```powershell
   pnpm start
   ```

4. **访问 Web 控制台**
   打开浏览器，访问：`http://localhost:8086`

---

## 常见问题排查

### 问题 1：首次 `pnpm install` 后无法运行命令

**症状**：
```
❌ 无法找到命令 `zhin`
```

**原因**: 
- 首次安装时 CLI 工具可能没有完全编译
- zhin.js 包的依赖可能不完整

**解决方案**（按顺序尝试）：

#### 方案 A：运行 `pnpm install` 再次完整安装（推荐）
```powershell
pnpm install
```

> 这会修复大多数情况下的依赖问题。由于 monorepo 结构需要多个包的相互依赖，首次安装有可能不完整。

#### 方案 B：清理缓存后重新安装
```powershell
# 删除 node_modules 和锁文件
Remove-Item -Recurse node_modules
Remove-Item pnpm-lock.yaml

# 重新安装
pnpm install
```

#### 方案 C：使用 `npx` 替代全局 `zhin` 命令
```powershell
# 使用 npm scripts 代替
pnpm dev       # 开发模式
pnpm start     # 生产启动

# 如果需要其他 zhin 命令，使用 npx
npx zhin start
npx zhin build
npx zhin setup
```

### 问题 2：`pnpm start` 报错 "spawn tsx ENOENT"

**症状**：
```
❌ 启动失败: spawn tsx ENOENT
```

**原因**: 
- Windows 上 `tsx` 不在 PATH 中（或未正确安装）
- 这通常由于 pnpm install 不完整导致

**解决方案**：

1. **运行 `pnpm install` 修复依赖**（首选）
   ```powershell
   pnpm install
   ```
   
   错误提示已改进，会自动建议：
   ```
   ❌ 启动失败: 缺失必要的依赖模块（可能是 tsx）
   💡 请运行以下命令以安装或修复依赖：
      pnpm install
   ```

2. **检查 node_modules 是否存在**
   ```powershell
   # 检查是否有 node_modules 文件夹
   ls node_modules | Select-Object -First 5
   
   # 如果不存在，运行
   pnpm install
   ```

3. **使用 `pnpm dev` 而非 `pnpm start`**（开发阶段）
   ```powershell
   pnpm dev
   ```

### 问题 3：`pnpm dev` 正常，但 `pnpm start` 失败

**症状**：
```
🔄 正在重启机器人...
❌ 子进程启动失败: spawn tsx ENOENT
```

**原因**：
- start 命令在生产环境下的启动方式与 dev 不一致（现已修复）
- 如果是旧版本，请更新框架版本

**解决方案**：

1. **更新到最新版本**
   ```powershell
   pnpm add zhin.js@latest
   pnpm install
   ```

2. **重新运行**
   ```powershell
   pnpm start
   ```

---

## 全局 CLI 配置（可选）

如果想在任何目录下直接运行 `zhin` 命令，可以全局链接 CLI：

```powershell
# 在项目根目录执行
pnpm link
```

然后就可以在任何地方使用：
```powershell
zhin start
zhin dev
zhin build
```

**取消全局链接**：
```powershell
pnpm unlink -g @zhin.js/cli
```

> 注意：全局链接不是必需的，使用 `pnpm start` 或 `npx zhin start` 也能正常工作。

---

## PowerShell 执行策略（如果有脚本执行限制）

如果遇到脚本执行权限问题，可以临时调整执行策略：

```powershell
# 查看当前执行策略
Get-ExecutionPolicy

# 临时调整为允许运行脚本
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# 运行后恢复为受限
Set-ExecutionPolicy -ExecutionPolicy Restricted -Scope CurrentUser
```

---

## 调试技巧

### 查看更详细的错误信息

开发模式下查看详细日志：
```powershell
pnpm dev --verbose
```

### 检查依赖是否完整

```powershell
# 检查 tsx 是否存在
ls node_modules | findstr tsx

# 检查 zhin.js 是否存在
ls node_modules | findstr "zhin"
```

### 使用 `pnpm why` 排查依赖链

```powershell
# 查看某个包为什么被安装
pnpm why tsx
pnpm why zhin.js
```

---

## 更多帮助

- 官方文档: https://zhin.js.org
- GitHub Issues: https://github.com/zhinjs/zhin/issues
- 配置文档: [docs/essentials/configuration.md](./configuration.md)
- 命令参考: [docs/essentials/commands.md](./commands.md)

---

## 版本要求

| 工具 | 最低版本 | 推荐版本 |
|------|---------|---------|
| Node.js | 20.19.0 | 22.12.0+ |
| pnpm | 9.0.0 | 9.1.0+ |
| TypeScript | 5.3.0 | 5.9.0+ |

---

## 最后排查清单

如果仍然存在问题，请按以下清单逐项检查：

- [ ] Node.js 版本是否满足 20.19.0+？（`node --version`）
- [ ] pnpm 版本是否满足 9.0+？（`pnpm --version`）
- [ ] 是否完整运行过 `pnpm install`？
- [ ] 当前目录是否为项目根目录？（包含 `package.json` 和 `zhin.config.yml`）
- [ ] `node_modules` 文件夹是否存在？
- [ ] 是否尝试过 `pnpm dev` 而非 `pnpm start`？
- [ ] 在个人防火墙中是否允许了 Node.js？

如果以上都已检查，请收集错误信息并提交 Issue。
