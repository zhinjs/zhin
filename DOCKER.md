# Zhin.js Docker 使用指南

## 镜像信息

- **镜像地址**: `ghcr.io/zhinjs/zhin:latest`
- **基础环境**: Node.js 22 + pnpm 9.0.2
- **预装工具**: `create-zhin-app`, `@zhin.js/cli`, `zhin.js`
- **支持架构**: `linux/amd64`, `linux/arm64`

## 快速开始

### 创建项目

**方式一：本地方式**

```bash
npm create zhin-app my-bot
# 或
pnpm create zhin-app my-bot
```

**方式二：Docker 方式**

```bash
# 交互式创建（推荐首次使用）
docker run -it -v $(pwd):/workspace -w /workspace ghcr.io/zhinjs/zhin create my-bot

# 快速创建（使用默认配置）
docker run -v $(pwd):/workspace -w /workspace ghcr.io/zhinjs/zhin create -y my-bot
```

### 运行项目

```bash
cd my-bot

# 方式一：直接运行
docker run -v $(pwd):/app -p 8086:8086 ghcr.io/zhinjs/zhin start

# 方式二：开发模式
docker run -it -v $(pwd):/app -p 8086:8086 ghcr.io/zhinjs/zhin dev

# 方式三：使用 Docker Compose（推荐生产环境）
docker compose up -d
```

## 命令参考

| 命令 | 说明 |
|------|------|
| `create <name>` | 交互式创建新项目 |
| `create -y <name>` | 快速创建项目（默认配置） |
| `start` | 生产模式运行 |
| `dev` | 开发模式运行（热重载） |
| `install` | 安装项目依赖 |
| `build` | 构建项目 |
| `shell` | 进入容器 shell |
| `help` | 显示帮助信息 |

## Docker Compose 部署

在项目目录下创建 `docker-compose.yml`：

```yaml
services:
  zhin:
    image: ghcr.io/zhinjs/zhin:latest
    container_name: zhin-bot
    restart: unless-stopped
    ports:
      - "8086:8086"
    env_file:
      - .env
    volumes:
      - .:/app
      - zhin-data:/app/data
      - zhin-modules:/app/node_modules
    command: start

volumes:
  zhin-data:
  zhin-modules:
```

运行：

```bash
docker compose up -d      # 启动
docker compose logs -f    # 查看日志
docker compose down       # 停止
```

## 数据持久化

| 路径 | 说明 |
|------|------|
| `/app/data` | 数据库、缓存文件（必须持久化） |
| `/app/node_modules` | 依赖包（建议持久化以加速启动） |

## 环境变量配置

通过 `.env` 文件配置敏感信息：

```bash
# .env
HTTP_USERNAME=admin
HTTP_PASSWORD=your_password
QQ_APPID=your_appid
QQ_SECRET=your_secret
```

## 常用命令

```bash
# 查看帮助
docker run ghcr.io/zhinjs/zhin help

# 进入容器
docker compose exec zhin shell

# 更新镜像
docker compose pull && docker compose up -d
```

## 镜像标签

| 标签 | 说明 |
|------|------|
| `latest` | 最新稳定版 |
| `vX.Y.Z` | 特定版本 |
| `sha-xxxxxx` | 特定提交 |
