// zhin.js 开箱即用示例
import { createZhinApp, logger } from './packages/zhin/lib/index.js'

console.log('🚀 zhin.js 开箱即用示例')

async function main() {
    try {
        // 使用开箱即用的应用创建函数
        console.log('📦 创建 zhin.js 应用 (包含所有核心功能)...')
        const app = await createZhinApp({
            databases: [
                {
                    name: 'main',
                    type: 'sqlite',
                    database: './data/example.db'
                }
            ],
            bots: [
                {
                    name: 'console',
                    context: 'process'
                }
            ]
        })
        
        console.log('✅ 应用创建成功！')
        console.log('🎯 包含的功能:')
        console.log('  - 进程适配器 (adapter-process)')
        console.log('  - HTTP服务 (http)')
        console.log('  - Web控制台 (console)')
        console.log('  - SQLite数据库 (database-sqlite)')
        
        // 可以开始使用应用
        console.log('🎉 zhin.js 开箱即用验证成功！')
        
        // 清理
        await app.stop()
        
    } catch (error) {
        console.error('❌ 错误:', error)
    }
}

main()
