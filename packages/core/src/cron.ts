import { CronExpressionParser, CronExpression } from 'cron-parser';

/**
 * Cron 定时任务类
 * 基于 cron-parser 实现的定时任务调度器
 */
export class Cron {
  private expression: CronExpression;
  private callback: () => void | Promise<void>;
  private timeoutId?: NodeJS.Timeout;
  private isRunning = false;
  private isDisposed = false;

  /**
   * 创建一个新的 Cron 实例
   * @param cronExpression - Cron 表达式 (例如: '0 0 * * *' 表示每天午夜执行)
   * @param callback - 要执行的回调函数
   */
  constructor(cronExpression: string, callback: () => void | Promise<void>) {
    try {
      this.expression = CronExpressionParser.parse(cronExpression);
      this.callback = callback;
    } catch (error) {
      throw new Error(`Invalid cron expression "${cronExpression}": ${(error as Error).message}`);
    }
  }

  /**
   * 启动定时任务
   */
  run(): void {
    if (this.isDisposed) {
      throw new Error('Cannot run a disposed cron job');
    }

    if (this.isRunning) {
      return; // 已经在运行中
    }

    this.isRunning = true;
    this.scheduleNext();
  }

  /**
   * 停止定时任务
   */
  stop(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
    this.isRunning = false;
  }

  /**
   * 销毁定时任务，释放资源
   */
  dispose(): void {
    this.stop();
    this.isDisposed = true;
  }

  /**
   * 获取下一次执行时间
   */
  getNextExecutionTime(): Date {
    if (this.isDisposed) {
      throw new Error('Cannot get next execution time for a disposed cron job');
    }
    
    // 重置表达式到当前时间
    this.expression.reset();
    return this.expression.next().toDate();
  }

  /**
   * 检查任务是否正在运行
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * 检查任务是否已被销毁
   */
  get disposed(): boolean {
    return this.isDisposed;
  }

  /**
   * 获取原始的 cron 表达式字符串
   */
  get cronExpression(): string {
    return this.expression.stringify();
  }

  /**
   * 调度下一次执行
   */
  private scheduleNext(): void {
    if (!this.isRunning || this.isDisposed) {
      return;
    }

    try {
      // 重置到当前时间并获取下一次执行时间
      this.expression.reset();
      const nextDate = this.expression.next().toDate();
      const now = new Date();
      const delay = nextDate.getTime() - now.getTime();

      // 如果延迟时间为负数或0，说明应该立即执行
      if (delay <= 0) {
        this.executeCallback();
        return;
      }

      // 设置定时器
      this.timeoutId = setTimeout(() => {
        this.executeCallback();
      }, delay);

    } catch (error) {
      console.error(`Error scheduling next cron execution: ${(error as Error).message}`);
      // 如果出错，停止任务
      this.stop();
    }
  }

  /**
   * 执行回调函数并调度下一次执行
   */
  private async executeCallback(): Promise<void> {
    if (!this.isRunning || this.isDisposed) {
      return;
    }

    try {
      // 执行回调函数
      await this.callback();
    } catch (error) {
      console.error(`Error executing cron callback: ${(error as Error).message}`);
    }

    // 调度下一次执行
    this.scheduleNext();
  }
}

/**
 * Cron 表达式格式说明:
 * 
 * 标准格式: "秒 分 时 日 月 周"
 * 
 * 字段说明:
 * - 秒: 0-59
 * - 分: 0-59  
 * - 时: 0-23
 * - 日: 1-31
 * - 月: 1-12 (或 JAN-DEC)
 * - 周: 0-7 (0和7都表示周日，或 SUN-SAT)
 * 
 * 特殊字符:
 * - 星号: 匹配任意值
 * - 问号: 用于日和周字段，表示不指定值
 * - 横线: 表示范围，如 1-5
 * - 逗号: 表示列表，如 1,3,5
 * - 斜杠: 表示步长，如 0/15 表示每15分钟
 * 
 * 常用示例:
 * - "0 0 0 * * *": 每天午夜执行
 * - "0 0/15 * * * *": 每15分钟执行  
 * - "0 0 12 * * *": 每天中午12点执行
 * - "0 0 0 1 * *": 每月1号午夜执行
 * - "0 0 0 * * 0": 每周日午夜执行
 */
