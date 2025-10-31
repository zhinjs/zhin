import { defineConfig,LogLevel } from "zhin.js";
export default defineConfig(async () => {
  return {
    database: {
      dialect: "sqlite",
      filename: "./data/test.db"
    },
    bots: [
      {
        name: "40523",
        context: "process"
      },
      {
        name: "zhin",
        context: "kook",
        token: "${KOOK_TOKEN}",
        mode: "websocket",
        logLevel: "off",
        ignore: "bot",
        data_dir: "./data"
      },
      {
        name: "zhinBot",
        context: "discord",
        token: process.env.DISCORD_ZHIN_TOKEN
      },
      {
        context: "qq",
        name: "zhin",
        appid: "102073979",
        secret: process.env.ZHIN_SECRET,
        intents: [
          "GUILDS",
          "GROUP_AT_MESSAGE_CREATE",
          "PUBLIC_GUILD_MESSAGES",
          "GUILD_MEMBERS",
          "DIRECT_MESSAGE",
          "C2C_MESSAGE_CREATE",
          "GUILD_MESSAGE_REACTIONS"
        ],
        logLevel: "off",
        mode: "websocket",
        removeAt: true,
        sandbox: true,
        data_dir: "./data"
      },
      {
        context: "qq",
        name: "zhin2号",
        appid: "102005927",
        secret: process.env.ZHIN2_SECRET,
        intents: [
          "GUILDS",
          "GROUP_AT_MESSAGE_CREATE",
          "PUBLIC_GUILD_MESSAGES",
          "GUILD_MEMBERS",
          "DIRECT_MESSAGE",
          "C2C_MESSAGE_CREATE",
          "GUILD_MESSAGE_REACTIONS"
        ],
        logLevel: "off",
        mode: "websocket",
        removeAt: true,
        data_dir: "./data"
      },
      {
        name: process.env.ICQQ_LOGIN_UIN,
        context: "icqq",
        log_level: "off",
        password: process.env.ONEBOT_TOKEN,
        sign_api_addr: process.env.ICQQ_SIGN_ADDR,
        platform: 2,
        data_dir: "./data",
        scope: "icqqjs"
      },
      {
        name: process.env.ICQQ_SCAN_UIN,
        context: "icqq",
        log_level: "off",
        password: process.env.ONEBOT_TOKEN,
        sign_api_addr: process.env.ICQQ_SIGN_ADDR,
        ver: "9.1.70",
        platform: 2,
        data_dir: "./data"
      }
    ],
    log_level: 1,
    log: {
      maxDays: 7,
      maxRecords: 10000,
      cleanupInterval: 24
    },
    plugin_dirs: [
      "./src/plugins",
      "node_modules",
      "node_modules/@zhin.js"
    ],
    plugins: [
      "http",
      "adapter-process",
      "adapter-icqq",
      "adapter-kook",
      "adapter-discord",
      "adapter-onebot11",
      "adapter-qq",
      "console",
      "test-plugin",
      "test-jsx",
      "music"
    ],
    debug: false,
    'test-jsx': {
      test: "test",
      union: "option2",
      testField: "defaultValue2",
      testArray: [],
      testTurple: [],
      testObject: {
        nestedField: "nestedDefault"
      },
      testNumber: 3,
      testBoolean: true
    },
    http: {
      port: 8086,
      username: process.env.username,
      password: process.env.ONEBOT_TOKEN,
      base: "/api"
    }
  }
});