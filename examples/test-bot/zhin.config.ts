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
      "console",
      "mcp",
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
      port: 8087,
      username: process.env.username,
      password: process.env.ONEBOT_TOKEN,
      base: "/api"
    },
    mcp: {
      enabled: true,
      path: "/mcp"
    }
  }
});