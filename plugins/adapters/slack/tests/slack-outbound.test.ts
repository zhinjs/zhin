import { describe, it, expect, vi } from 'vitest';
import { sendSlackContent, editSlackContent } from '../src/slack-outbound.js';

function mockWebClient() {
  return {
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ts: '1700000000.000000', ok: true }),
      update: vi.fn().mockResolvedValue({ ts: '1700000000.000000', ok: true }),
    },
    filesUploadV2: vi.fn().mockResolvedValue({ ok: true }),
  } as any;
}

function mockLogger() {
  return { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() } as any;
}

describe('sendSlackContent', () => {
  it('should send plain text as mrkdwn block', async () => {
    const client = mockWebClient();
    const logger = mockLogger();
    const result = await sendSlackContent(client, [
      { type: 'text', data: { text: 'hello world' } },
    ], { channel: 'C001' }, logger);

    expect(result.ts).toBe('1700000000.000000');
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C001',
        text: 'hello world',
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'hello world' } }],
      }),
    );
  });

  it('should convert markdown bold to Slack mrkdwn in blocks', async () => {
    const client = mockWebClient();
    const logger = mockLogger();
    await sendSlackContent(client, [
      { type: 'text', data: { text: '**日常工具** - 签到' } },
    ], { channel: 'C001' }, logger);

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*日常工具* - 签到' } }],
      }),
    );
  });

  it('should send with thread_ts', async () => {
    const client = mockWebClient();
    const logger = mockLogger();
    await sendSlackContent(client, 'reply in thread', {
      channel: 'C001',
      threadTs: '1699999999.000000',
    }, logger);

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ thread_ts: '1699999999.000000' }),
    );
  });

  it('should convert mention segments to mrkdwn', async () => {
    const client = mockWebClient();
    const logger = mockLogger();
    await sendSlackContent(client, [
      { type: 'at', data: { id: 'U12345' } },
      { type: 'text', data: { text: ' hello!' } },
    ], { channel: 'C001' }, logger);

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '<@U12345> hello!' } }],
      }),
    );
  });

  it('should split long text into multiple mrkdwn sections', async () => {
    const client = mockWebClient();
    const logger = mockLogger();
    const longText = '行\n'.repeat(2000);
    await sendSlackContent(client, [
      { type: 'text', data: { text: longText } },
    ], { channel: 'C001' }, logger);

    const call = client.chat.postMessage.mock.calls[0][0];
    const sections = call.blocks.filter((b: any) => b.type === 'section');
    expect(sections.length).toBeGreaterThan(1);
    for (const section of sections) {
      expect(section.text.text.length).toBeLessThanOrEqual(2900);
    }
  });

  it('should produce one actions block per keyboard row', async () => {
    const client = mockWebClient();
    const logger = mockLogger();
    await sendSlackContent(client, [
      {
        type: 'keyboard',
        data: {
          rows: [
            [{ label: 'A', id: 'a' }, { label: 'B', id: 'b' }],
            [{ label: 'C', id: 'c' }],
          ],
        },
      },
    ], { channel: 'C001' }, logger);

    const call = client.chat.postMessage.mock.calls[0][0];
    const actions = call.blocks.filter((b: any) => b.type === 'actions');
    expect(actions).toHaveLength(2);
    expect(actions[0].elements).toHaveLength(2);
    expect(actions[1].elements).toHaveLength(1);
  });

  it('should cap keyboard row at 5 buttons', async () => {
    const client = mockWebClient();
    const logger = mockLogger();
    const buttons = Array.from({ length: 7 }, (_, i) => ({ label: `B${i}`, id: `b${i}` }));
    await sendSlackContent(client, [
      { type: 'keyboard', data: { rows: [buttons] } },
    ], { channel: 'C001' }, logger);

    const actions = client.chat.postMessage.mock.calls[0][0].blocks.find((b: any) => b.type === 'actions');
    expect(actions.elements).toHaveLength(5);
  });

  it('should produce Block Kit actions from keyboard segments', async () => {
    const client = mockWebClient();
    const logger = mockLogger();
    await sendSlackContent(client, [
      { type: 'text', data: { text: 'Choose:' } },
      {
        type: 'keyboard',
        data: {
          rows: [[
            { label: 'Yes', id: 'vote_yes', style: 'primary' },
            { label: 'No', id: 'vote_no', style: 'danger' },
          ]],
        },
      },
    ], { channel: 'C001' }, logger);

    const call = client.chat.postMessage.mock.calls[0][0];
    expect(call.blocks).toBeDefined();
    expect(call.blocks.length).toBeGreaterThan(0);

    const actionsBlock = call.blocks.find((b: any) => b.type === 'actions');
    expect(actionsBlock).toBeDefined();
    expect(actionsBlock.elements).toHaveLength(2);
    expect(actionsBlock.elements[0].text.text).toBe('Yes');
    expect(actionsBlock.elements[0].style).toBe('primary');
    expect(actionsBlock.elements[1].style).toBe('danger');
  });

  it('should handle image attachments', async () => {
    const client = mockWebClient();
    const logger = mockLogger();
    await sendSlackContent(client, [
      { type: 'image', data: { url: 'https://example.com/cat.jpg', title: 'Cat' } },
    ], { channel: 'C001' }, logger);

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [{ image_url: 'https://example.com/cat.jpg', title: 'Cat' }],
      }),
    );
  });

  it('should handle link segments', async () => {
    const client = mockWebClient();
    const logger = mockLogger();
    await sendSlackContent(client, [
      { type: 'link', data: { url: 'https://example.com', text: 'Example' } },
    ], { channel: 'C001' }, logger);

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '<https://example.com|Example>' } }],
      }),
    );
  });
});

describe('editSlackContent', () => {
  it('should call chat.update with mrkdwn block', async () => {
    const client = mockWebClient();
    await editSlackContent(client, 'C001', '1700000000.000000', [
      { type: 'text', data: { text: 'updated text' } },
    ]);

    expect(client.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C001',
        ts: '1700000000.000000',
        text: 'updated text',
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'updated text' } }],
      }),
    );
  });
});
