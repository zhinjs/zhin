import { createApp } from 'zhin.js';

// 启动机器人
async function main() {
    try {
        // 异步创建机器人实例 (自动从配置文件加载)
        const app = await createApp();
        await app.start();
        
        // 优雅退出处理
        const shutdown = async (signal: string) => {
          await app.stop();
          process.exit(0);
        };

        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
    } catch (error) {
        console.error(error)
        process.exit(1);
    }
}

// 启动应用
main().catch(console.error);
