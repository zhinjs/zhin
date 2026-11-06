import { describe, expect, it } from 'vitest';
import { InMemoryEngagementJournal } from '@zhin.js/harness';
import { HostMailbox } from '../src/collaboration/host-mailbox.js';
import { AgentTurnIngressRoute } from '../src/plugin-runtime/ingress/ingress-route.js';

function createMinimalIngressDeps(sharedMailbox?: HostMailbox) {
  return {
    projectRoot: process.cwd(),
    runtime: {} as never,
    im: {
      endpoints: {
        send: async () => ({ messageId: 'ok' }),
        capabilities: () => undefined,
        captureOperation: () => ({ release: () => undefined }),
      },
    } as never,
    ingress: {} as never,
    agent: {
      service: {
        getAgentConfig: () => undefined,
        getTriggerConfig: () => undefined,
        getBindingRegistry: () => ({
          requireZhinBinding: () => ({ name: 'zhin', nickname: [] }),
        }),
      },
      agent: {
        ...(sharedMailbox ? { hostMailbox: sharedMailbox } : {}),
        getDecisionEvents: () => undefined,
        getControlPlane: () => undefined,
        getSessionOps: () => undefined,
        getAnnouncements: () => undefined,
        getSessionEvents: () => undefined,
        getGroupRules: () => undefined,
      },
      traceRuntime: { record: () => undefined },
      semanticMemory: null,
      approvalReviewer: {} as never,
      approvalJudgment: {} as never,
    } as never,
  };
}

describe('Unified Mailbox & EngagementJournal Spine', () => {
  it('forwards harness.open and recordToolCalled events to a swapped EngagementJournal', async () => {
    const mailbox = new HostMailbox();
    const customJournal = new InMemoryEngagementJournal();
    mailbox.setJournal(customJournal);
    expect(mailbox.journal).toBe(customJournal);

    const admissionPromise = mailbox.admit({
      sessionKey: 'sandbox:private:u1',
      senderId: 'u1',
      text: 'hello unified spine',
      plainText: true,
      isMaster: true,
    });
    const admission = await admissionPromise;
    expect(admission.kind).toBe('run');
    if (admission.kind !== 'run') return;

    await mailbox.recordToolCalled({
      engagementId: admission.mail.engagementId,
      actor: admission.mail.to,
      mailId: admission.mail.id,
      tool: 'web_search',
      ok: true,
    });
    admission.release('completed');

    const events = await customJournal.read(admission.mail.engagementId);
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain('engagement_opened');
    expect(eventTypes).toContain('mail_admitted');
    expect(eventTypes).toContain('tool_called');

    const engagements = await mailbox.journal.listEngagements();
    expect(engagements).toContain(admission.mail.engagementId);
    await mailbox.close();
  });

  it('shares ZhinAgent.hostMailbox across AgentTurnIngressRoute and preserves its lifecycle on route dispose', async () => {
    const sharedMailbox = new HostMailbox();
    const route = new AgentTurnIngressRoute(createMinimalIngressDeps(sharedMailbox));

    expect(route.hostMailbox).toBe(sharedMailbox);

    // Disposing the ingress route must NOT close the shared ZhinAgent.hostMailbox
    route.dispose();
    const admission = await sharedMailbox.admit({
      sessionKey: 'sandbox:private:u2',
      senderId: 'u2',
      text: 'still alive on shared mailbox',
      plainText: true,
      isMaster: true,
    });
    expect(admission.kind).toBe('run');
    if (admission.kind === 'run') {
      admission.release('completed');
    }
    await sharedMailbox.close();
  });

  it('creates and disposes an owned fallback HostMailbox when options.agent.agent has no hostMailbox', async () => {
    const route = new AgentTurnIngressRoute(createMinimalIngressDeps(undefined));
    const fallbackMailbox = route.hostMailbox;
    expect(fallbackMailbox).toBeInstanceOf(HostMailbox);

    route.dispose();
    const rejected = await fallbackMailbox.admit({
      sessionKey: 'sandbox:private:u3',
      senderId: 'u3',
      text: 'after dispose',
      plainText: true,
      isMaster: true,
    });
    expect(rejected).toEqual({ kind: 'rejected', reason: 'stopped' });
  });
});
