# test-bot

Zhin Bot Framework的测试机器人项目，用于演示和测试框架功能。

## 功能

- 进程管理演示
- ICQQ机器人演示
- 插件系统演示
- 消息处理演示

## 项目结构

```
test-bot/
├── data/                # 数据目录
│   ├── device.json     # ICQQ设备信息
│   └── image/          # 图片缓存
├── src/
│   ├── index.ts        # 主入口
│   └── plugins/        # 插件目录
│       └── test-plugin.ts  # 测试插件
├── package.json
├── tsconfig.json
└── zhin.config.ts      # 配置文件
```

## 测试插件功能

### 进程监控

发送"占用"消息可以查看当前进程的内存占用：
- RSS (常驻集大小)
- 堆内存使用量

### 消息处理

演示了以下功能：
- 中间件系统
- 消息拦截
- 消息修改
- 消息回复

### 上下文使用

演示了如何使用和依赖上下文：
- 进程上下文
- 日志记录
- 消息发送

## 配置说明

`zhin.config.ts`配置了：
- 进程管理适配器
- ICQQ机器人
- 插件加载

## 运行

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 生产模式
pnpm start
```

## 许可证

MIT License