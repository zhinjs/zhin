import { describe, expect, it } from 'vitest';
import { Message, isAtEndpoint, shouldTriggerAI } from 'zhin.js';
import { toCanonicalSegments } from '../src/segment-mapper.js';
import { parseSlackMessageToSegments } from '../src/slack-inbound.js';

const BOT_USER_ID = 'U0BGD0B665U';

function slackGroupMessage(text: string): Message {
  const wire = parseSlackMessageToSegments({
    type: 'message',
    ts: '1700000000.000000',
    user: 'U99999',
    channel: 'C0AS3CLRB6U',
    channel_type: 'channel',
    text,
  });
  return Message.from({}, {
    $id: '1700000000.000000',
    $adapter: 'slack',
    $endpoint: 'zhin',
    $sender: { id: 'U99999', name: 'user' },
    $channel: { id: 'C0AS3CLRB6U', type: 'group' },
    $content: toCanonicalSegments(wire),
    $raw: text,
    $timestamp: 1700000000000,
  });
}

describe('Slack @ trigger identity', () => {
  it('matches bot mention only when platform user id is in endpointAtIds', () => {
    const message = slackGroupMessage(`<@${BOT_USER_ID}> 怎么回事`);

    expect(isAtEndpoint(message, ['zhin'])).toBe(false);
    expect(isAtEndpoint(message, ['zhin', BOT_USER_ID])).toBe(true);

    expect(shouldTriggerAI(message, {}, { endpointAtIds: ['zhin'] }).triggered).toBe(false);
    expect(shouldTriggerAI(message, {}, { endpointAtIds: ['zhin', BOT_USER_ID] }).triggered).toBe(true);
    expect(shouldTriggerAI(message, {}, { endpointAtIds: ['zhin', BOT_USER_ID] }).content).toBe('怎么回事');
  });
});
