# Zhin.js Docker 使用指南

> 本文档面向 Docker 用户，带你上手。

## 这个 Docker 镜像是什么？

我们把 Zhin.js 运行所需的一切（Node.js、pnpm、CLI 工具）都打包进了一个 Docker 镜像里。
你不需要在自己电脑或服务器上安装 Node.js，只要有 Docker 就能创建和运行 Zhin 机器人。

**镜像地址**：`ghcr.io/zhinjs/zhin:latest`

## 前置条件

只需安装 Docker：
- **macOS / Windows**：安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/) 或 [OrbStack](https://orbstack.dev/)
- **Linux 服务器**：`curl -fsSL https://get.docker.com | sh`

安装后终端运行 `docker --version` 能看到版本号即可。

---

## 从零开始：3 步跑起一个机器人

### 第 1 步：创建项目

打开终端，`cd` 到你想放项目的目录，然后运行：

```bash
docker run -it --rm \
  -v $(pwd):/workspace \
  -w /workspace \
  ghcr.io/zhinjs/zhin create my-bot
```
运行完成后，你的当前目录下会多出一个 `my-bot/` 文件夹。

> 如果不想交互，加 `-y` 跳过所有提问：  
> `docker run --rm -v $(pwd):/workspace -w /workspace ghcr.io/zhinjs/zhin create -y my-bot`

### 第 2 步：启动项目

```bash
cd my-bot

docker run --rm \
  -v $(pwd):/app \
  -p 8086:8086 \
  ghcr.io/zhinjs/zhin start
```

首次启动时，容器会**自动安装依赖**（你会看到 `📦 正在安装依赖...`），之后就直接启动了。

启动成功后你会看到类似输出：
```
[INFO] [Zhin:CLI]: ✓ 机器人已启动
[INFO] [Zhin:http]: HTTP 服务已启动 (port=8086)
[INFO] [Zhin:console]: Web 控制台已启动
```

此时打开浏览器访问 `http://localhost:8086` 即可看到 Web 控制台。

按 **Ctrl+C** 可以停止。

### 第 3 步（可选）：开发模式

如果你想边改代码边看效果（热重载），用 `dev` 代替 `start`：

```bash
docker run -it --rm \
  -v $(pwd):/app \
  -p 8086:8086 \
  ghcr.io/zhinjs/zhin dev
```

修改 `my-bot/` 里的文件后，容器会自动重新加载。

---

## 内置命令一览

镜像最后面的那个词就是"内置命令"，不同命令做不同事情：

| 命令 | 用途 | 示例 |
|------|------|------|
| `create <名称>` | 创建新项目 | `... ghcr.io/zhinjs/zhin create my-bot` |
| `create -y <名称>` | 快速创建（跳过提问） | `... ghcr.io/zhinjs/zhin create -y my-bot` |
| `start` | 生产模式启动 | `... ghcr.io/zhinjs/zhin start` |
| `dev` | 开发模式启动（热重载） | `... ghcr.io/zhinjs/zhin dev` |
| `install` | 安装项目依赖 | `... ghcr.io/zhinjs/zhin install` |
| `build` | 构建项目 | `... ghcr.io/zhinjs/zhin build` |
| `shell` | 进入容器终端（调试用） | `... ghcr.io/zhinjs/zhin shell` |
| `help` | 显示帮助 | `... ghcr.io/zhinjs/zhin help` |

> `...` 代表前面的 `docker run --rm -v ...` 等参数，根据命令需要搭配不同的挂载和端口参数。

---

## 生产部署：使用 Docker Compose

手动敲 `docker run ...` 参数太长，生产环境推荐用 Docker Compose——把所有参数写进一个文件里，一条命令搞定。

在 `my-bot/` 目录下创建 `docker-compose.yml`：

```yaml
services:
  zhin:
    image: ghcr.io/zhinjs/zhin:latest
    container_name: zhin-bot
    restart: unless-stopped       # 崩溃后自动重启
    environment:
      - NODE_ENV=production
      - TZ=Asia/Shanghai          # 时区
    ports:
      - "8086:8086"
    env_file:
      - .env                      # 敏感配置（API 密钥等）
    volumes:
      - .:/app                    # 项目代码
      - zhin-data:/app/data       # 数据库等持久数据
      - zhin-modules:/app/node_modules  # 依赖缓存
    command: start
    healthcheck:
      test: ["CMD-SHELL", "wget -q --spider http://localhost:8086/pub/health || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s

volumes:
  zhin-data:
  zhin-modules:
```

然后只需：

```bash
docker compose up -d       # 后台启动（-d 表示 detach，不占终端）
docker compose logs -f     # 看实时日志
docker compose down        # 停止并删除容器
docker compose restart     # 重启
```

---

## 配置敏感信息

在 `my-bot/` 目录下创建 `.env` 文件（**不要**提交到 Git）：

```bash
# .env
HTTP_USERNAME=admin
HTTP_PASSWORD=your_password
QQ_APPID=your_appid
QQ_SECRET=your_secret
```

Docker Compose 会自动读取这个文件。

## 数据持久化

| 容器内路径 | 说明 | 是否必须持久化 |
|-----------|------|---------------|
| `/app/data` | 数据库、缓存 | ✅ 必须（否则重启后数据丢失） |
| `/app/node_modules` | npm 依赖包 | 建议（避免每次重启都重新安装） |

如果用 Docker Compose，上面的配置已经帮你处理好了。

## 镜像版本

| 标签 | 含义 | 用法 |
|------|------|------|
| `latest` | 最新稳定版 | `ghcr.io/zhinjs/zhin:latest` |
| `1.0.0` | 锁定具体版本 | `ghcr.io/zhinjs/zhin:1.0.0` |
| `1.0` | 锁定主次版本 | `ghcr.io/zhinjs/zhin:1.0` |
| `sha-abc1234` | 锁定某次提交 | `ghcr.io/zhinjs/zhin:sha-abc1234` |

> 生产环境建议锁定版本号，不要用 `latest`，避免自动更新导致意外。

## 常见问题

### Q: 首次运行很慢？
首次 `docker run` 需要下载镜像（约 200MB），之后都是秒启动。首次 `start`/`dev` 需要安装 npm 依赖，也需要一些时间。

### Q: 端口被占用？
把 `-p 8086:8086` 改成 `-p 9090:8086`，意思是用你电脑的 9090 端口映射容器的 8086。

### Q: 怎么更新镜像？
```bash
docker pull ghcr.io/zhinjs/zhin:latest   # 拉取最新镜像
docker compose up -d                      # 重新启动（如果用 Compose）
```

### Q: 怎么进容器排查问题？
```bash
# 用 Compose 启动的
docker compose exec zhin shell

# 手动启动一个临时容器
docker run -it --rm -v $(pwd):/app ghcr.io/zhinjs/zhin shell
```

---

## 本地构建镜像

如需自行构建：

```bash
git clone https://github.com/zhinjs/zhin.git
cd zhin
docker build -t zhin:local .
docker run --rm zhin:local help
```
