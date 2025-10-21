import { defineConfig,LogLevel } from 'zhin.js';
import path from "node:path";

export default defineConfig(async (env)=>{
  return {
    log_level: LogLevel.INFO,
    database: {
      dialect: 'sqlite',
      filename: './data/test.db'
    },
    // 机器人配置
    bots: [
      {
        name:`${process.pid}`,
        context:'process'
      },
    ],
    // 插件目录
    plugin_dirs: [
      env.PLUGIN_DIR || './src/plugins',
      'node_modules',
        path.join('node_modules','@zhin.js'),
    ],
    // 要加载的插件列表
    plugins: [
      'http',           // 🚀 HTTP先加载，注册基础API路由
      'adapter-process',
      'adapter-icqq',   // 🤖 ICQQ适配器注册 /api/icqq/* 路由
      'adapter-kook',   // KOOK适配器
      'adapter-discord', // Discord适配器
      'adapter-onebot11', // OneBot适配器
      'adapter-qq', // QQ官方机器人适配器
      'console',        // 🖥️ 控制台最后加载，处理静态文件
      'test-plugin',
      'test-jsx',
      'music'
    ],

    // 调试模式
    debug: env.DEBUG === 'true'
  }
})

