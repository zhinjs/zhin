import { LogTransport } from '@zhin.js/logger'
import { Plugin } from '@zhin.js/core'
import { AppConfig } from './types.js'

/**
 * 数据库日志传输器
 * 将日志存储到数据库，并自动清理旧日志
 */
export class DatabaseLogTransport implements LogTransport {
  private plugin: Plugin
  private stripAnsiRegex = /\x1b\[[0-9;]*m/g
  private cleanupTimer?: NodeJS.Timeout
  private maxDays: number
  private maxRecords: number
  private cleanupInterval: number

  constructor(plugin: Plugin) {
    this.plugin = plugin
    const configService = plugin.inject('config')!
    const appConfig = configService.get<AppConfig>('zhin.config.yml')
    // 从配置读取日志清理策略
    const logConfig = appConfig.log || {}
    this.maxDays = logConfig.maxDays || 7 // 默认保留 7 天
    this.maxRecords = logConfig.maxRecords || 10000 // 默认最多 10000 条
    this.cleanupInterval = logConfig.cleanupInterval || 24 // 默认 24 小时清理一次
    
    // 启动定时清理
    this.startCleanup()
    
    // 插件销毁时停止清理任务
    plugin.onDispose(() => this.stopCleanup())
  }

  /**
   * 启动定时清理任务
   */
  private startCleanup(): void {
    // 立即执行一次清理
    this.cleanupOldLogs().catch(err => {
      this.plugin.logger.error('[DatabaseLogTransport] Initial cleanup failed:', err.message)
    })

    // 设置定时任务
    this.cleanupTimer = setInterval(() => {
      this.cleanupOldLogs().catch(err => {
        this.plugin.logger.error('[DatabaseLogTransport] Scheduled cleanup failed:', err.message)
      })
    }, this.cleanupInterval * 60 * 60 * 1000) // 转换为毫秒
  }

  /**
   * 清理旧日志
   */
  private async cleanupOldLogs(): Promise<void> {
    const db=this.plugin.inject('database')
    if (!db) {
      return
    }

    try {
      const LogModel = db.models.get('SystemLog')
      if (!LogModel) {
        return
      }

      // 1. 按时间清理：删除超过 maxDays 天的日志
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - this.maxDays)
      
      const deletedData = await LogModel
        .delete({ timestamp: { $lt: cutoffDate } })
      const deletedCount = typeof deletedData === 'number' ? deletedData : deletedData.length
      // 2. 按数量清理：如果日志总数超过 maxRecords，删除最旧的
      const total = await LogModel.select()
      const totalCount = total.length

      if (totalCount > this.maxRecords) {
        const excessCount = totalCount - this.maxRecords
        
        // 查找最旧的 excessCount 条日志的 ID
        const oldestLogs: any[] = await LogModel.select('id','timestamp').orderBy('timestamp', 'ASC').limit(excessCount)
        
        const idsToDelete = oldestLogs.map((log: any) => log.id)
        
        if (idsToDelete.length > 0) {
          await LogModel
            .delete({ id: { $in: idsToDelete } })
        }
      }

      this.plugin.logger.info(
        `[DatabaseLogTransport] Log cleanup completed. ` +
        `Deleted ${deletedData || 0} logs older than ${this.maxDays} days. ` +
        `Current total: ${Math.max(0, totalCount - (deletedCount || 0))} logs.`
      )
    } catch (error) {
      // 静默处理错误
      this.plugin.logger.debug('[DatabaseLogTransport] Cleanup error:', (error as Error).message,(error as Error).stack)
    }
  }

  /**
   * 停止清理任务
   */
  public stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = undefined
    }
  }

  /**
   * 移除 ANSI 颜色代码
   */
  private stripAnsi(str: string): string {
    return str.replace(this.stripAnsiRegex, '')
  }

  write(message: string): void {
    // 移除 ANSI 颜色代码
    const cleanMessage = this.stripAnsi(message)
    
    // 解析日志消息
    // 格式: [09-08 04:07:55.852] [INFO] [MyApp]: message
    const logRegex = /\[[\d-]+ [\d:.]+\] \[(\w+)\] \[([^\]]+)\]: ([\s\S]+)/
    const match = cleanMessage.match(logRegex)
    
    if (match) {
      const [, level, name, msg] = match
      const source = name.split(':')[0] // 取第一部分作为 source
      
      // 异步存储到数据库，不阻塞日志输出
      this.saveToDatabase(level.toLowerCase(), name, msg.trim(), source).catch(err => {
        // 避免日志存储失败导致应用崩溃
        console.error('[DatabaseLogTransport] Failed to save log:', err.message)
      })
    }
  }

  /**
   * 保存日志到数据库
   */
  private async saveToDatabase(level: string, name: string, message: string, source: string): Promise<void> {
    const databaseService=this.plugin.inject('database')
    if (!databaseService) {
      return // 没有数据库则跳过
    }

    try {
      const LogModel = databaseService.models.get('SystemLog')
      if (!LogModel) {
        return // 模型不存在则跳过
      }

      await LogModel.insert({
        level,
        name,
        message,
        source,
        timestamp: new Date()
      })
    } catch (error) {
      // 静默处理错误，避免干扰主流程
    }
  }
}

