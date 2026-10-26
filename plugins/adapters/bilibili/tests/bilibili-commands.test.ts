import { describe, expect, it, vi } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import listCommand from '../commands/bili-draft/list/index.ts';
import showCommand from '../commands/bili-draft/show/[id]/index.ts';
import editCommand from '../commands/bili-draft/edit/[id]/index.ts';
import sendCommand from '../commands/bili-draft/send/[id]/index.ts';
import dropCommand from '../commands/bili-draft/drop/[id]/index.ts';
import { BilibiliEndpoint } from '../src/endpoint.js';
import { resolveBilibiliConfig } from '../src/protocol.js';
import type { BilibiliFetch } from '../src/client.js';
import { bilibiliEndpointRegistryToken } from '../src/bilibili-runtime-state.js';

const commands = [listCommand, showCommand, editCommand, sendCommand, dropCommand];

function setup() {
  const posts: string[] = [];
  const fetch: BilibiliFetch = vi.fn(async (url: string, init) => {
    if (url.includes('/x/v2/reply/add')) {
      posts.push(String(init?.body));
      return { ok: true, status: 200, json: async () => ({ code: 0, data: { rpid_str: '777' } }) };
    }
    throw new Error(`unexpected ${url}`);
  });
  const endpoint = new BilibiliEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'bili-cmd'),
    autoPoll: false,
    fetch,
    config: resolveBilibiliConfig({ id: 'bili', sessdata: 's', biliJct: 'c' }),
  });
  const registry = new Map([['bili', endpoint]]);
  const use = ((token: unknown) => {
    if (token !== bilibiliEndpointRegistryToken) throw new Error('unexpected token');
    return registry;
  }) as never;
  const ctx = (params: Record<string, unknown> = {}, args: string[] = []) => ({ params, args, use }) as never;
  return { endpoint, posts, ctx };
}

describe('bili-draft commands', () => {
  it('are branded and master-only', () => {
    for (const command of commands) {
      expect(parseCommandDefinition(command)).toBe(command);
      expect(command.permit).toEqual(['role(master)']);
    }
  });

  it('list → edit → send, and drop', async () => {
    const { endpoint, posts, ctx } = setup();
    const thread = { endpoint: { id: 'e', adapter: 'bilibili' }, kind: 'channel' as const, id: 'video:1:2' };
    await endpoint.send({ conversation: thread, payload: '初稿' }).catch(() => undefined);
    const id = endpoint.drafts.list()[0]!.id;

    expect(String(await listCommand.execute(ctx()))).toContain(id);
    expect(String(await showCommand.execute(ctx({ id })))).toContain('初稿');
    expect(String(await editCommand.execute(ctx({ id }, [])))).toContain('用法');
    expect(String(await editCommand.execute(ctx({ id }, ['终稿', '谢谢'])))).toContain('终稿 谢谢');
    expect(posts).toHaveLength(0);
    expect(String(await sendCommand.execute(ctx({ id })))).toContain('#reply777');
    expect(posts[0]).toContain(encodeURIComponent('终稿 谢谢').replace(/%20/g, '+'));

    await endpoint.send({ conversation: thread, payload: '另一条' }).catch(() => undefined);
    const other = endpoint.drafts.list()[0]!.id;
    expect(String(await dropCommand.execute(ctx({ id: other })))).toContain('已丢弃');
    expect(String(await sendCommand.execute(ctx({ id: 'nope' })))).toContain('找不到');
  });
});
