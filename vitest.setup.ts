process.env.NODE_ENV = 'test'

/** 默认跳过 L4 实机 smoke；显式 `L4_SKIP_PLATFORM=0` 且配置 token 时可跑 */
if (process.env.L4_SKIP_PLATFORM == null || process.env.L4_SKIP_PLATFORM === '') {
  process.env.L4_SKIP_PLATFORM = '1'
}

/**
 * 测试环境下 kook-client 等第三方库在构造函数中向 process 注入 uncaughtException 监听器，
 * 每个测试用例创建新 Endpoint 时会累积。提高限制以避免 MaxListenersExceededWarning。
 * 生产环境中 Endpoint 正常 disconnect 时会清理这些监听器。
 */
process.setMaxListeners(30)
