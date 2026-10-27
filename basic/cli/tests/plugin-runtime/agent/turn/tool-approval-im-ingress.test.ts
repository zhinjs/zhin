import { RuntimeMessage } from '../../../../../../packages/im/core/src/plugin-runtime/im/contracts.js';
import { describe, expect, it, vi } from 'vitest';
import { AiControlPlane, DecisionEventLog } from '@zhin.js/agent';
import { ToolApprovalQueue, resolveToolHardGateImApproval } from '@zhin.js/agent/security';
import { rootPluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { AgentTurnIngressRoute } from '../../../../src/plugin-runtime/agent/turn/ingress-route.js';
import { ImToolApprovalChannel } from '../../../../src/plugin-runtime/agent/tool-approval-im-channel.js';

const endpoint = { adapter: 'root', id: 'root\u0000zhin.adapter\u0000fixture' };
const BUSINESS_GROUP = 'g42';

function harness() {
  const queue = new ToolApprovalQueue();
  const toolApprovalIm = new ImToolApprovalChannel({
    queue,
    settings: () => resolveToolHardGateImApproval({ enabled: true, approverIds: { fixture: ['admin-1'] } }),
    send: async () => undefined,
  });
  const card = queue.enqueue({
    toolName: 'group_kick',
    category: 'member',
    sessionKey: `fixture:bot:group:${BUSINESS_GROUP}`,
    turnId: 'turn-1',
    args: { user_id: 9 },
    origin: { platform: 'fixture', endpointKey: 'bot', scope: 'group', sceneId: BUSINESS_GROUP },
  });
  const snapshot = { root: rootPluginId(), resources: new Map(), tree: new Map(), projections: new Map(), capabilities: new Map() } as unknown as RuntimeSnapshot;
  const executeLeased = vi.fn(async () => ({ status: 'completed', output: [] }));
  const observeInbound = vi.fn(async () => ({ blocked: null }));
  const route = new AgentTurnIngressRoute({
    projectRoot: process.cwd(),
    runtime: { executeLeased } as never,
    im: { createInteraction: () => ({ ask: vi.fn() }) } as never,
    ingress: { read: async () => ({ agents: [], tools: [] }) } as never,
    agent: {
      service: {
        getBindingRegistry: () => ({ requireZhinBinding: () => ({ name: 'zhin', providerAlias: 'fixture', model: 'fixture' }) }),
        getTriggerConfig: () => ({ enabled: true }),
        getAgentConfig: () => ({}),
      },
      agent: {
        getControlPlane: () => new AiControlPlane(),
        getDecisionEvents: () => new DecisionEventLog(),
        getUserProfiles: () => ({ sessions: { observeInbound } }),
        ownerApprovals: { handleCommand: () => null },
      },
    } as never,
    toolApprovalIm,
  });
  const send = async (conversation: { kind: 'private' | 'group'; id: string }, senderId: string, content: string) => {
    const reply = vi.fn(async () => ({ status: 'sent' as const }));
    const message = new RuntimeMessage(
      { endpoint, ...conversation },
      content,
      1,
      reply,
      { id: senderId },
      {},
      [],
      undefined,
      'bot',
      false,
      undefined,
      undefined,
      'fixture',
      { commands: { prefix: '/' } },
    );
    const handled = await route.route(message, { value: snapshot, active: true } as never, rootPluginId(), undefined);
    return { handled, reply };
  };
  return { queue, card, send, executeLeased };
}

describe('hard-gate IM approval commands at IM ingress (G6, #1013)', () => {
  it('settles a card from an allowlisted approver private chat without starting an Agent turn', async () => {
    const flow = harness();

    const { handled, reply } = await flow.send({ kind: 'private', id: 'admin-1' }, 'admin-1', `/approve ${flow.card.id}`);

    expect(handled).toBe(true);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('已批准'));
    expect(flow.queue.get(flow.card.id)).toMatchObject({ status: 'approved', channel: 'im_dm', decidedBy: 'im:fixture:admin-1' });
    expect(flow.executeLeased).not.toHaveBeenCalled();
  });

  it('does not settle a card from the business group, even when an approver says it', async () => {
    const flow = harness();

    const { handled, reply } = await flow.send({ kind: 'group', id: BUSINESS_GROUP }, 'admin-1', `/approve ${flow.card.id}`);

    expect(handled).toBe(true);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('私聊'));
    expect(flow.queue.get(flow.card.id)?.status).toBe('pending');
    expect(flow.executeLeased).not.toHaveBeenCalled();
  });

  it('does not treat plain agreement in the business group as an approval', async () => {
    const flow = harness();
    await flow.send({ kind: 'group', id: BUSINESS_GROUP }, 'admin-1', '同意');
    await flow.send({ kind: 'group', id: BUSINESS_GROUP }, 'admin-1', `批准 ${flow.card.id}`);
    expect(flow.queue.get(flow.card.id)?.status).toBe('pending');
  });

  it('refuses a private-chat command from someone who is not an approver', async () => {
    const flow = harness();
    const { reply } = await flow.send({ kind: 'private', id: 'member-7' }, 'member-7', `/deny ${flow.card.id}`);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('不在'));
    expect(flow.queue.get(flow.card.id)?.status).toBe('pending');
  });
});
