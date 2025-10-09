import { defineConfig } from 'zhin.js';
import path from "node:path";

export default defineConfig(async (env)=>{
  return {
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
      {
        name: 'zhin',
        context:'kook',
        token: env.KOOK_TOKEN,
        mode: 'websocket',
        logLevel:'off',
        ignore: 'bot',
      },
      {
        name: env.ICQQ_SCAN_UIN,
        context:'icqq',
        log_level:'off',
        platform:4
      },
      // {
      //   name: env.ONEBOT_NAME,
      //   context:'onebot11.wss',
      //   path:'/ws',
      //   access_token:env.ONEBOT_TOKEN
      // },
      
      // {
      //   context:'onebot11',
      //   name: env.ONEBOT_NAME,
      //   url:'wss://napcat.liucl.cn/ws',
      //   access_token:env.ONEBOT_TOKEN
      // },
      {
        context:'qq',
        name: 'zhin',
        appid:'102073979',
        secret:env.ZHIN_SECRET,
        intents:[
          "GUILDS",
          "GROUP_AT_MESSAGE_CREATE",
          "PUBLIC_GUILD_MESSAGES",
          "GUILD_MEMBERS",
          "DIRECT_MESSAGE",
          "C2C_MESSAGE_CREATE",
          "GUILD_MESSAGE_REACTIONS"
        ],
        logLevel: 'off',
        mode:'websocket',
        removeAt:true,
        sandbox:true,
      },
      {
        context:'qq',
        name: 'zhin2号',
        appid:'102005927',
        secret:env.ZHIN2_SECRET,
        intents:[
          "GUILDS",
          "GROUP_AT_MESSAGE_CREATE",
          "PUBLIC_GUILD_MESSAGES",
          "GUILD_MEMBERS",
          "DIRECT_MESSAGE",
          "C2C_MESSAGE_CREATE",
          "GUILD_MESSAGE_REACTIONS"
        ],
        logLevel: 'off',
        mode:'websocket',
        removeAt:true,
      },
      {
        name: env.ICQQ_LOGIN_UIN,
        context:'icqq',
        log_level:'off',
        password:env.ICQQ_PASSWORD,
        sign_api_addr: env.ICQQ_SIGN_ADDR,
        platform:2
      }
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
      'adapter-onebot11', // OneBot适配器
      'adapter-qq', // QQ官方机器人适配器
      'console',        // 🖥️ 控制台最后加载，处理静态文件
      'adapter-kook',
      'test-plugin'
    ],

    // 调试模式
    debug: env.DEBUG === 'true'
  }
})

