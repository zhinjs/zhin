import { describe, expect, it } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import listCommand from '../commands/juejin-draft/list/index.ts';
import showCommand from '../commands/juejin-draft/show/[id]/index.ts';
import editCommand from '../commands/juejin-draft/edit/[id]/index.ts';
import sendCommand from '../commands/juejin-draft/send/[id]/index.ts';
import dropCommand from '../commands/juejin-draft/drop/[id]/index.ts';
import loginStatusCommand from '../commands/juejin-login/status/index.ts';
import { createJuejinHarness } from './juejin-harness.js';
import { ARTICLE, fakeFetch } from './juejin-fake.js';

const commands = [listCommand, showCommand, editCommand, sendCommand, dropCommand, loginStatusCommand];

async function setup() {
  const fake = fakeFetch({ pages: [[]] });
  const harness = await createJuejinHarness({ id: 'jj', articles: [ARTICLE], cookie: 'sessionid=offline' }, { fetch: fake.fetch });
  const ctx = (params: Record<string, unknown> = {}, args: string[] = []) => ({ ...harness.context,
    params, args, locale: 'zh-CN', formatCommand: (path: string) => path }) as never;
  return { harness, posts: fake.posts, ctx };
}

describe('juejin-draft commands', () => {
  it('are branded and master-only', () => {
    for (const command of commands) {
      expect(parseCommandDefinition(command)).toBe(command);
      expect(command.permit).toEqual(['owner']);
    }
  });

  it('list → edit → send, and drop; nothing is posted before approval', async () => {
    const { harness, posts, ctx } = await setup();
    const thread = { endpoint: { id: 'e', adapter: 'juejin' }, kind: 'channel' as const, id: `article:${ARTICLE}:7000000000000000100` };
    await harness.send({ conversation: thread, payload: '初稿' }).catch(() => undefined);
    const id = harness.endpoint.drafts.list()[0]!.id;

    expect(String(await listCommand.execute(ctx()))).toContain(id);
    expect(String(await showCommand.execute(ctx({ id })))).toContain('初稿');
    expect(String(await editCommand.execute(ctx({ id }, [])))).toContain('用法');
    expect(String(await editCommand.execute(ctx({ id }, ['终稿', '谢谢'])))).toContain('终稿 谢谢');
    expect(posts).toHaveLength(0);
    expect(String(await sendCommand.execute(ctx({ id })))).toContain(`https://juejin.cn/post/${ARTICLE}`);
    expect(posts[0]).toMatchObject({ reply_content: '终稿 谢谢', reply_to_comment_id: '7000000000000000100' });

    await harness.send({ conversation: thread, payload: '另一条' }).catch(() => undefined);
    const other = harness.endpoint.drafts.list()[0]!.id;
    expect(String(await dropCommand.execute(ctx({ id: other })))).toContain('已丢弃');
    expect(String(await sendCommand.execute(ctx({ id: 'nope' })))).toContain('找不到');
    expect(String(await loginStatusCommand.execute(ctx()))).toContain('已登录');
  });
});
