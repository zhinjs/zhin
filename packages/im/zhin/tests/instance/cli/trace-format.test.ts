import { describe, expect, it } from 'vitest';
import { summarizeEngagementEvents, type EngagementEvent } from '@zhin.js/harness';
import {
  formatEngagementCollaborationGraph,
  formatEngagementList,
} from '../../../src/instance/cli/trace.js';

describe('zhin trace Engagement Collaboration Graph (ADR 0048 H5)', () => {
  it('renders an ASCII collaboration graph, blackboard entries, and diagnostics from engagement events', () => {
    const events: EngagementEvent[] = [
      {
        engagementId: 'eng-42',
        seq: 0,
        at: 1_000,
        type: 'engagement_opened',
        data: {
          initiator: { kind: 'human', id: 'alice', trust: 'master' },
          venue: { kind: 'group', id: 'dev-room' },
          entry: 'zhin',
        },
      },
      {
        engagementId: 'eng-42',
        seq: 1,
        at: 1_100,
        type: 'mail_sent',
        data: {
          mailId: 'mail-1',
          kind: 'ask',
          from: 'zhin',
          to: 'coder',
        },
      },
      {
        engagementId: 'eng-42',
        seq: 2,
        at: 1_200,
        type: 'board_written',
        data: {
          key: 'spec',
          kind: 'artifact',
          content: 'Design v1',
          author: 'coder',
          version: 1,
        },
      },
      {
        engagementId: 'eng-42',
        seq: 3,
        at: 1_300,
        type: 'tool_called',
        data: {
          actor: 'coder',
          tool: 'read_file',
        },
      },
      {
        engagementId: 'eng-42',
        seq: 4,
        at: 1_400,
        type: 'mail_denied',
        data: {
          from: 'coder',
          to: 'deployer',
          reason: { code: 'contact_not_allowed', detail: 'deployer not in contacts' },
        },
      },
      {
        engagementId: 'eng-42',
        seq: 5,
        at: 1_500,
        type: 'venue_projected',
        data: {
          venue: { kind: 'group', id: 'dev-room' },
          actor: 'coder',
          mailId: 'mail-1',
          mode: 'visible',
        },
      },
      {
        engagementId: 'eng-42',
        seq: 6,
        at: 1_600,
        type: 'budget_charged',
        data: {
          modelCalls: 2,
          tokens: 1500,
          wallMs: 600,
          sideEffects: 1,
        },
      },
      {
        engagementId: 'eng-42',
        seq: 7,
        at: 1_800,
        type: 'engagement_closed',
        data: {
          status: 'completed',
        },
      },
    ];

    const summary = summarizeEngagementEvents('eng-42', events);
    const rendered = formatEngagementCollaborationGraph(summary, events);

    expect(rendered).toContain('Engagement eng-42  [completed]');
    expect(rendered).toContain('Initiator: alice (trust: master)');
    expect(rendered).toContain('Venue:     group:dev-room');
    expect(rendered).toContain('Duration:  800ms');
    expect(rendered).toContain('modelCalls=2  tokens=1500  wallMs=600  sideEffects=1');
    expect(rendered).toContain('zhin ──[ask]──► coder  (sent, id=mail-1)');
    expect(rendered).toContain('[artifact] spec = Design v1  (by coder, v1)');
    expect(rendered).toContain('[tool] coder -> read_file');
    expect(rendered).toContain('[guard_blocked] coder -> deployer: contact_not_allowed (deployer not in contacts)');
    expect(rendered).toContain('[venue_projected] group:dev-room by coder [visible] (mail=mail-1)');

    const listRendered = formatEngagementList([summary]);
    expect(listRendered).toContain('eng-42  [completed]  800ms');
    expect(listRendered).toContain('hops=1  tools=1  tokens=1500');
  });
});
