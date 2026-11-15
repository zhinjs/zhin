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

/**
 * ADR 0061 §4.3: an inbound message that settles as `unrecorded` fails the test unless its last
 * stage is on the phase allowlist (those only warn). From P6 the allowlist is empty.
 */
{
  const { readFileSync } = await import('node:fs')
  const allowlist = new Set<string>(JSON.parse(readFileSync(new URL('./packages/im/core/tests/fixtures/unrecorded-allowlist.json', import.meta.url), 'utf8')).stages)
  const { onUnrecordedInboundOutcome } = await import('./packages/im/core/src/plugin-runtime/im/inbound-outcome-ledger.ts')
  onUnrecordedInboundOutcome((record) => {
    if (allowlist.has(String(record.lastStage))) return
    throw new Error(`Inbound message settled as unrecorded at stage ${String(record.lastStage)} (ADR 0061 §4.1)`)
  })
}
