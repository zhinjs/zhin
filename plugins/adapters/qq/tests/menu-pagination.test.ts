import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { formatOutbound } from '../src/outbound.js';

/** Builds the real SDK request body so the test sees what QQ actually receives. */
async function buildSdkPayload(message: unknown): Promise<{ msg_type?: number; markdown?: { content?: string }; keyboard?: unknown }> {
  const require = createRequire(import.meta.url);
  const { MessageBuilder } = require(join(dirname(require.resolve('qq-official-bot/package.json')), 'lib/message/builder.js'));
  const built = await new MessageBuilder('appid', false, { id: 'source-msg' }).build(message);
  return built.messagePayload;
}

// Canonical payload produced by commandMenuReply for a multi-page menu on a
// native markdown + native keyboard endpoint (see core im-runtime.test.ts):
// [menu body text, markdown page title, keyboard].
const menuBody = '=== root 指令菜单 ===\n第 1/3 页 · 60 条指令 · 0 个子插件\n\n  /cmd1  - 指令一\n  /cmd2  - 指令二\n\n下一页：/菜单 --page 2';
const menuPayload = [
  { type: 'text', data: { text: menuBody } },
  { type: 'markdown', data: { content: '**指令菜单** · 第 1/3 页' } },
  { type: 'keyboard', data: { rows: [[
    { label: '上一页', payload: 'prev', disabled: true, style: 'secondary' },
    { label: '下一页', payload: 'next', disabled: false, style: 'primary' },
  ]] } },
];

describe('paginated command menu on QQ official', () => {
  it('keeps the command list alongside the page title and buttons', async () => {
    const body = await buildSdkPayload(formatOutbound(menuPayload));
    expect(body.msg_type).toBe(2);
    expect(body.keyboard).toBeDefined();
    expect(body.markdown?.content).toContain('/cmd1  - 指令一');
    expect(body.markdown?.content).toContain('/cmd2  - 指令二');
    expect(body.markdown?.content).toContain('**指令菜单** · 第 1/3 页');
  });

  it('merges every inline markdown segment of a button message into one, in order', () => {
    const out = formatOutbound([
      { type: 'markdown', data: { content: 'first' } },
      { type: 'markdown', data: { content: 'second' } },
      { type: 'keyboard', data: { rows: [[{ label: 'ok', payload: 'ok' }]] } },
    ]) as Array<{ type: string; data: { content?: string } }>;
    expect(out.filter(part => part.type === 'markdown')).toEqual([{ type: 'markdown', data: { content: 'first\n\nsecond' } }]);
  });
});
