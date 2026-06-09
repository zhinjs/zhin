process.env.NODE_ENV = 'test'

/** 默认跳过 L4 实机 smoke；显式 `L4_SKIP_PLATFORM=0` 且配置 token 时可跑 */
if (process.env.L4_SKIP_PLATFORM == null || process.env.L4_SKIP_PLATFORM === '') {
  process.env.L4_SKIP_PLATFORM = '1'
}
