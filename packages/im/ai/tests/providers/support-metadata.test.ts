import { builtinAiProviders } from '../../src/providers/index.js';

it('declares display classification without changing registered products or authentication contracts', () => {
  expect(
    builtinAiProviders.map((driver) => [
      driver.id,
      driver.contractVersion,
      driver.authentication.methods,
    ])
  ).toEqual([
    ['openai', '1', ['api-key']],
    ['anthropic', '1', ['api-key']],
    ['google', '1', ['api-key']],
    ['deepseek', '1', ['api-key']],
    ['minimax', '1', ['api-key']],
    ['ollama', '1', ['none', 'api-key']],
    ['openai-compatible', '1', ['api-key']],
    ['cloudflare', '1', ['api-key']],
    ['codex-subscription', '1', ['oauth']],
    ['claude-subscription', '1', ['oauth']],
    ['opencode-go', '1', ['api-key']],
    ['opencode-zen', '1', ['api-key']],
    ['antigravity', '1', ['oauth']],
  ]);
  const experimental = builtinAiProviders.filter(
    (driver) => driver.support?.status === 'experimental'
  );
  expect(experimental.map((driver) => driver.id)).toEqual([
    'claude-subscription',
    'antigravity',
  ]);
  for (const driver of experimental)
    expect(driver.support).toEqual({
      status: 'experimental',
      notice:
        '实验 · 不受官方支持 · 可能违反供应商条款 · 风险由使用者自行承担。',
    });
  for (const driver of builtinAiProviders.filter(
    (driver) => !experimental.includes(driver)
  ))
    expect(driver.support?.status).toBe('standard');
  expect(
    builtinAiProviders.find((driver) => driver.id === 'codex-subscription')
      ?.support?.notice
  ).toBe('未经 OpenAI 对第三方客户端的明确授权。');
  for (const driver of builtinAiProviders)
    expect(driver.support?.notice ?? '').not.toMatch(/验收|实号|计费/);
});
