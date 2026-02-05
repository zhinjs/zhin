# ===========================================
# Zhin.js Docker 镜像
# 支持创建项目和运行项目
# ===========================================

FROM node:22-alpine

LABEL org.opencontainers.image.source="https://github.com/zhinjs/zhin"
LABEL org.opencontainers.image.description="Zhin.js Bot Framework"
LABEL org.opencontainers.image.licenses="MIT"

# 安装必要的运行时依赖和构建工具
RUN apk add --no-cache \
    tini \
    python3 \
    make \
    g++ \
    git

# 启用 corepack 并安装 pnpm
RUN corepack enable && corepack prepare pnpm@9.0.2 --activate

# 全局安装 zhin.js CLI 和脚手架
RUN pnpm add -g create-zhin-app @zhin.js/cli zhin.js

# 创建非 root 用户
RUN addgroup -g 1001 -S zhin && \
    adduser -S zhin -u 1001 -G zhin

# 复制入口脚本
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# 设置工作目录
WORKDIR /app

# 设置目录权限
RUN chown -R zhin:zhin /app

# 切换到非 root 用户
USER zhin

# 设置环境变量
ENV NODE_ENV=production
ENV PNPM_HOME=/home/zhin/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH

# 暴露默认端口
EXPOSE 8086

# 使用 tini 作为 init 进程
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]

# 默认显示帮助
CMD ["help"]
