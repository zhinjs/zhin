// ================================================================================================
// zhin.js - 开箱即用的机器人框架
// ================================================================================================

// 导出核心框架
export * from '@zhin.js/core'
import logger from '@zhin.js/logger'
import { AppConfig, App, Config } from '@zhin.js/core'
import path from 'path'
import fs from 'fs'

// 重新导出 logger（作为独立的工具）
export { default as logger } from '@zhin.js/logger'

export async function createApp(config?:Partial<AppConfig>): Promise<App>
export async function createApp(config_file?:string): Promise<App>
export async function createApp(config_param?:string|Partial<AppConfig>): Promise<App>  {
    const envFiles=['.env',`.env.${process.env.NODE_ENV}`].filter(f=>fs.existsSync(path.join(process.cwd(),f)))
    if(config_param===undefined){
        config_param=Config.supportedExtensions.map(ext=>`zhin.config${ext}`).find(f=>fs.existsSync(path.join(process.cwd(),f)))
    }
    if(config_param===undefined) throw new Error('No configuration file found and no configuration provided.')
    const app= new App(config_param as string);
    app.watching(envFiles,()=>{
        console.log('Environment file changed, exiting to reload...')
        process.exit(51)
    })
    return app
}