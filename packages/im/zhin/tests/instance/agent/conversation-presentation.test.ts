/** #1250: out-of-turn cards spell commands with the Endpoint's real prefix, in the recipient's language. */
import { describe, expect, it } from 'vitest';
import { managementCommandText } from '@zhin.js/agent';
import { ToolApprovalQueue, resolveToolHardGateImApproval } from '@zhin.js/agent/security';
import { ImToolApprovalChannel, type ImApprovalDeliveryTarget } from '@zhin.js/agent/runtime';
import { ImRuntime, MessageDispatcher } from '@zhin.js/core/runtime';
import type { SendContent } from '@zhin.js/core';
import { cardText } from './card-text.js';
import {
  childPluginId, featureId, projectLocaleToken, rootPluginId, userLocalePreferencesToken,
  type Locale, type RuntimeSnapshot, type SnapshotReader,
} from '@zhin.js/plugin-runtime';
import { createConversationPresentationResolver } from '../../../src/instance/agent/conversation-presentation.js';

const root = rootPluginId();
const qq = childPluginId(root, 'qq');
const ENDPOINT_ID = 'qq-endpoint-capability';

/** Root resources the IM runtime installs (its outbound command environment among them). */
function imResources(commandPrefix?: string): Map<string, unknown> {
  const provided = new Map<string, unknown>();
  new ImRuntime(commandPrefix === undefined ? {} : { commandPrefix })
    .install({ provide: (token: { id: string }, value: unknown) => { provided.set(token.id, value); } } as never);
  return provided;
}

function snapshot(qqConfig: unknown, options: { projectLocale?: Locale; preferred?: Record<string, Locale>; im?: Map<string, unknown> | null } = {}): RuntimeSnapshot {
  const adapters = {
    $projection: 'zhin.adapter-index/1',
    resolve: (adapter: string, key: string) => adapter === 'qq' && (key === 'bot-1' || key === ENDPOINT_ID) ? ENDPOINT_ID : undefined,
    clientAdapter: () => 'qq',
    owner: () => qq,
    endpointEntry: () => ({ desired: { endpointId: 'bot-1' } }),
  };
  const preferences = {
    get: async (_endpoint: unknown, senderId: string) => options.preferred?.[senderId],
    set: async () => undefined,
  };
  return {
    generation: 1, root,
    config: new Map<string, unknown>([[qq, qqConfig]]),
    resources: new Map([[root, new Map<string, unknown>([
      ...(options.im === null ? [] : options.im ?? imResources()),
      [projectLocaleToken.id, options.projectLocale ?? 'zh-CN'],
      [userLocalePreferencesToken.id, preferences],
    ])]]),
    capabilities: new Map(), tree: new Map(),
    projections: new Map([[featureId('zhin.adapter'), adapters]]),
  } as unknown as RuntimeSnapshot;
}

function reader(value: RuntimeSnapshot): SnapshotReader {
  return { acquire: () => ({ value, release() {} }) } as unknown as SnapshotReader;
}

const dm = { kind: 'private' as const, id: 'admin-1' };

describe('createConversationPresentationResolver', () => {
  it('uses the same prefix as the inbound dispatcher: default none, adapter-wide, per-endpoint override', async () => {
    for (const [config, expected] of [[{}, ''], [{ commandPrefix: '#' }, '#'], [{ commandPrefix: '#', endpoints: [{ id: 'bot-1', commandPrefix: '/' }] }, '/']] as const) {
      const value = snapshot(config);
      const resolve = createConversationPresentationResolver(() => reader(value));
      const presentation = await resolve({ platform: 'qq', endpoint: 'bot-1', conversation: dm, recipientId: 'admin-1' });
      expect(presentation).toEqual({ locale: 'zh-CN', commandPrefix: expected });
      // The inbound dispatcher, for a message in the same conversation.
      const inbound = { conversation: { endpoint: { id: ENDPOINT_ID, adapter: 'qq' }, ...dm }, endpointId: 'bot-1' };
      expect(new MessageDispatcher().prefixOf(inbound as never, value)).toBe(expected);
    }
  });

  it('resolves by capability id too, and uses the recipient\'s language preference, else the project language', async () => {
    const value = snapshot({ commandPrefix: '!' }, { projectLocale: 'en', preferred: { 'admin-2': 'zh-CN' } });
    const resolve = createConversationPresentationResolver(() => reader(value));
    expect(await resolve({ platform: 'qq', endpoint: ENDPOINT_ID, conversation: dm, recipientId: 'admin-1' }))
      .toEqual({ locale: 'en', commandPrefix: '!' });
    expect(await resolve({ platform: 'qq', endpoint: 'bot-1', conversation: { kind: 'private', id: 'admin-2' }, recipientId: 'admin-2' }))
      .toEqual({ locale: 'zh-CN', commandPrefix: '!' });
    expect(await resolve({ platform: 'qq', endpoint: 'bot-1', conversation: { kind: 'group', id: '42' } }))
      .toEqual({ locale: 'en', commandPrefix: '!' });
  });

  it('follows the IM runtime\'s static commandPrefix override, like its inbound dispatcher', async () => {
    const value = snapshot({ commandPrefix: '#' }, { im: imResources('!') });
    const resolve = createConversationPresentationResolver(() => reader(value));
    expect(await resolve({ platform: 'qq', endpoint: 'bot-1', conversation: dm, recipientId: 'admin-1' }))
      .toEqual({ locale: 'zh-CN', commandPrefix: '!' });
    // Without the IM runtime's environment the prefix is unknown: the card then asks for it.
    const bare = createConversationPresentationResolver(() => reader(snapshot({ commandPrefix: '#' }, { im: null })));
    expect(await bare({ platform: 'qq', endpoint: 'bot-1', conversation: dm })).toEqual({ locale: 'zh-CN' });
  });

  it('knows no prefix for an unknown Endpoint or without a readable generation', async () => {
    const resolve = createConversationPresentationResolver(() => reader(snapshot({ commandPrefix: '#' })));
    expect(await resolve({ platform: 'qq', endpoint: 'gone', conversation: dm })).toEqual({ locale: 'zh-CN' });
    expect(await createConversationPresentationResolver(() => undefined)({ platform: 'qq', endpoint: 'bot-1', conversation: dm })).toBeUndefined();
    const closed = { acquire: () => { throw new Error('closed'); } } as unknown as SnapshotReader;
    expect(await createConversationPresentationResolver(() => closed)({ platform: 'qq', endpoint: 'bot-1', conversation: dm })).toBeUndefined();
  });

  for (const prefix of ['', '#', '/']) {
    it(`prefix ${JSON.stringify(prefix)}: card → copied command → ingress strip → settled`, async () => {
      const value = snapshot(prefix ? { commandPrefix: prefix } : {});
      const resolve = createConversationPresentationResolver(() => reader(value));
      const queue = new ToolApprovalQueue();
      const sent: string[] = [];
      const push = (content: SendContent) => { sent.push(cardText(content)); };
      const channel = new ImToolApprovalChannel({
        queue,
        settings: () => resolveToolHardGateImApproval({ enabled: true, approverIds: { qq: ['admin-1'] } }),
        send: async (_target, content) => { push(content); },
        // As the Host wires it (host-installer): the private recipient's own language preference.
        resolvePresentation: (target: ImApprovalDeliveryTarget) => resolve({
          platform: target.platform, endpoint: target.endpointKey, conversation: target.conversation,
          ...(target.conversation.kind === 'private' ? { recipientId: target.conversation.id } : {}),
        }),
      });
      channel.start();
      const card = queue.enqueue({
        toolName: 'group_kick', category: 'member', sessionKey: 'qq:bot-1:group:42', requesterId: 'm', turnId: 't',
        args: { user_id: 9 }, origin: { platform: 'qq', endpointKey: 'bot-1', scope: 'group', sceneId: '42' },
      });
      await channel.drain();
      const typed = sent[0]!.split('\n').find(line => line.startsWith('批准：'))!.slice('批准：'.length);
      expect(typed).toBe(`${prefix}approve ${card.id}`);
      const commandText = managementCommandText(typed, prefix);
      expect(channel.handleCommand({ platform: 'qq', scope: 'private', sceneId: 'admin-1', senderId: 'admin-1', commandText }))
        .toContain('已批准');
      expect(queue.get(card.id)?.status).toBe('approved');
    });
  }
});
