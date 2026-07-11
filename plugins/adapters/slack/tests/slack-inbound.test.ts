import { describe, it, expect } from 'vitest';
import { parseSlackMrkdwn, parseSlackMessageToSegments, resolveSlackChannelType } from '../src/slack-inbound.js';

describe('parseSlackMrkdwn', () => {
  it('should convert Slack bold in text slices', () => {
    const result = parseSlackMrkdwn('*粗体* text');
    expect(result[0]).toEqual({ type: 'text', data: { text: '**粗体** text' } });
  });

  it('should parse plain text', () => {
    const result = parseSlackMrkdwn('hello world');
    expect(result).toEqual([{ type: 'text', data: { text: 'hello world' } }]);
  });

  it('should parse user mentions', () => {
    const result = parseSlackMrkdwn('Hey <@U12345>!');
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: 'text', data: { text: 'Hey ' } });
    expect(result[1]).toEqual({ type: 'at', data: { id: 'U12345', name: 'U12345', text: '<@U12345>' } });
    expect(result[2]).toEqual({ type: 'text', data: { text: '!' } });
  });

  it('should parse user mentions with display name', () => {
    const result = parseSlackMrkdwn('<@U12345|alice>');
    expect(result[0]).toEqual({ type: 'at', data: { id: 'U12345', name: 'alice', text: '<@U12345|alice>' } });
  });

  it('should parse channel mentions', () => {
    const result = parseSlackMrkdwn('See <#C001|general>');
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ type: 'channel_mention', data: { id: 'C001', name: 'general', text: '<#C001|general>' } });
  });

  it('should parse links', () => {
    const result = parseSlackMrkdwn('Visit <https://example.com|Example>');
    expect(result[1]).toEqual({ type: 'link', data: { url: 'https://example.com', text: 'Example' } });
  });

  it('should parse mixed content', () => {
    const result = parseSlackMrkdwn('Hello <@U12345> check <https://example.com|this>');
    expect(result.length).toBeGreaterThanOrEqual(3);
  });
});

describe('parseSlackMessageToSegments', () => {
  it('should parse a simple text message', () => {
    const msg = { type: 'message', ts: '1700000000.000000', channel: 'C001', text: 'hello' } as any;
    const result = parseSlackMessageToSegments(msg);
    expect(result[0]).toEqual({ type: 'text', data: { text: 'hello' } });
  });

  it('should parse files', () => {
    const msg = {
      type: 'message', ts: '1700000000.000000', channel: 'C001', text: '',
      files: [{ id: 'F001', name: 'cat.jpg', mimetype: 'image/jpeg', url_private: 'https://...' }],
    } as any;
    const result = parseSlackMessageToSegments(msg);
    const imageSegment = result.find(s => s.type === 'image');
    expect(imageSegment).toBeDefined();
    expect(imageSegment!.data.id).toBe('F001');
  });

  it('should return default segment for empty message', () => {
    const msg = { type: 'message', ts: '1700000000.000000', channel: 'C001' } as any;
    const result = parseSlackMessageToSegments(msg);
    expect(result).toEqual([{ type: 'text', data: { text: '' } }]);
  });
});

describe('resolveSlackChannelType', () => {
  it('should return private for im', () => {
    expect(resolveSlackChannelType({ type: 'message', channel_type: 'im' } as any)).toBe('private');
  });

  it('should return group for channel', () => {
    expect(resolveSlackChannelType({ type: 'message', channel_type: 'channel' } as any)).toBe('group');
  });

  it('should default to group', () => {
    expect(resolveSlackChannelType({ type: 'message' } as any)).toBe('group');
  });
});
