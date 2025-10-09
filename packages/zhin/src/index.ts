// ================================================================================================
// zhin.js - 开箱即用的机器人框架
// ================================================================================================

// 导出核心框架
export * from '@zhin.js/core'
import logger from '@zhin.js/logger'
import { AppConfig, App } from '@zhin.js/core'
import { loadConfig } from '@zhin.js/core'
import path from 'path'
import fs from 'fs'

// 重新导出 logger（作为独立的工具）
export { default as logger } from '@zhin.js/logger'

export async function createApp(config?: Partial<AppConfig>): Promise<App> {
    let finalConfig: AppConfig,configPath:string='';
    const envFiles=['.env',`.env.${process.env.NODE_ENV}`]
        .filter(filename=>fs.existsSync(path.join(process.cwd(),filename)))
    if (!config || Object.keys(config).length === 0) {
        try {
            logger.info('🔍 正在查找配置文件...');
            [configPath,finalConfig] = await loadConfig();
            logger.info('✅ 配置文件加载成功');
        } catch (error) {
            logger.warn('⚠️  配置文件加载失败，使用默认配置', { 
                error: error instanceof Error ? error.message : String(error) 
            });
            finalConfig = Object.assign({}, App.defaultConfig);
        }
    } else {
        finalConfig = Object.assign({}, App.defaultConfig, config);
    }
    const app= new App(finalConfig);
    app.watching(envFiles,()=>{
        process.exit(51)
    })
    if(configPath){
        app.watching(configPath,()=>{
            process.exit(51);
        })
    }
    return app
}