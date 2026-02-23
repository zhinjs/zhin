import { Cron as Croner } from 'croner';

/**
 * Cron 定时任务类
 * 基于 croner 实现的定时任务调度器 (无需 Luxon，内存占用更小)
 */
export class Cron {
  private job: Croner | null = null;
  id:string = '';
  private callback: () => void | Promise<void>;
  private isDisposed = false;
  private _cronExpression: string;

  /**
   * 创建一个新的 Cron 实例
   * @param cronExpression - Cron 表达式 (例如: '0 0 * * *' 表示每天午夜执行)
   * @param callback - 要执行的回调函数
   */
  constructor(cronExpression: string, callback: () => void | Promise<void>) {
    this.id=Math.random().toString(36).substring(2, 10);
    try {
      this._cronExpression = cronExpression;
      this.callback = callback;
      
      // 验证 cron 表达式是否有效 (不启动)
      const testJob = new Croner(cronExpression, { paused: true });
      testJob.stop();
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

    if (this.job) {
      return; // 已经在运行中
    }

    // 创建并启动任务
    this.job = new Croner(this._cronExpression, async () => {
      try {
        await this.callback();
      } catch (error) {
        console.error(`Error executing cron callback: ${(error as Error).message}`);
      }
    });
  }

  /**
   * 停止定时任务
   */
  stop(): void {
    if (this.job) {
      this.job.stop();
      this.job = null;
    }
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
    
    // 创建临时任务来获取下次执行时间
    const tempJob = new Croner(this._cronExpression, { paused: true });
    const nextRun = tempJob.nextRun();
    tempJob.stop();
    
    if (!nextRun) {
      throw new Error('Cannot determine next execution time');
    }
    
    return nextRun;
  }

  /**
   * 检查任务是否正在运行
   */
  get running(): boolean {
    return this.job !== null;
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
    return this._cronExpression;
  }
}

/**
 * Cron 表达式格式说明:
 * 
 * 标准格式: "分 时 日 月 周" (5 字段)
 * 
 * 字段说明:
 * - 分: 0-59
 * - 时: 0-23
 * - 日: 1-31
 * - 月: 1-12 (或 JAN-DEC)
 * - 周: 0-7 (0和7都表示周日，或 SUN-SAT)
 * 
 * > croner 也支持 6 字段格式 "秒 分 时 日 月 周"，但推荐使用 5 字段格式。
 * 
 * 特殊字符:
 * - 星号: 匹配任意值
 * - 问号: 用于日和周字段，表示不指定值
 * - 横线: 表示范围，如 1-5
 * - 逗号: 表示列表，如 1,3,5
 * - 斜杠: 表示步长，如 */15 表示每15分钟
 * 
 * 常用示例:
 * - "0 0 * * *": 每天午夜执行
 * - "*/15 * * * *": 每15分钟执行  
 * - "0 12 * * *": 每天中午12点执行
 * - "0 0 1 * *": 每月1号午夜执行
 * - "0 0 * * 0": 每周日午夜执行
 */
