import { Cron, remove } from "@zhin.js/core";

/**
 * Cron 定时任务服务
 * 管理所有插件注册的定时任务
 */
export class CronService extends Array<Cron> {
    constructor() {
        super();
    }

    /**
     * 添加定时任务
     */
    addCron(cron: Cron): void {
        this.push(cron);
        // 自动启动任务
        if (!cron.running) {
            cron.run();
        }
    }

    /**
     * 移除定时任务
     */
    removeCron(cron: Cron): void {
        // 停止任务
        if (cron.running) {
            cron.stop();
        }
        remove(this, cron);
    }

    /**
     * 停止所有任务
     */
    stopAll(): void {
        for (const cron of this) {
            if (cron.running) {
                cron.stop();
            }
        }
        // 清空数组，释放引用
        this.length = 0;
    }

    /**
     * 启动所有任务
     */
    startAll(): void {
        for (const cron of this) {
            if (!cron.running && !cron.disposed) {
                cron.run();
            }
        }
    }

    /**
     * 获取所有任务的状态
     */
    getStatus(): Array<{
        expression: string;
        running: boolean;
        nextExecution: Date | null;
    }> {
        return this.map(cron => ({
            expression: cron.cronExpression,
            running: cron.running,
            nextExecution: cron.running ? cron.getNextExecutionTime() : null,
        }));
    }

    /**
     * 获取运行中的任务数量
     */
    get runningCount(): number {
        return this.filter(cron => cron.running).length;
    }
}

