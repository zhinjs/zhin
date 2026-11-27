import { describe, it, expect, vi } from 'vitest';
import { sendSlackContent, editSlackContent, splitBlocksIntoMessages } from '../src/slack-outbound.js';

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
  it('uploads MIME images with a previewable filename rather than alt text', async () => {
    const client = mockWebClient();
    await sendSlackContent(client, { content: [{ type: 'image', data: {
      alt: 'test image', media: { kind: 'base64', value: 'aGk=', mime_type: 'image/png' },
    } }], ...{ channel: 'C001' }, logger: mockLogger() });
    expect(client.filesUploadV2).toHaveBeenCalledWith(expect.objectContaining({ filename: 'image.png' }));
  });
  it('sends canonical reply segments in the referenced message thread', async () => {
    const client = mockWebClient();
    await sendSlackContent(client, { content: [
      { type: 'reply', data: { message_id: '1700000001.000001' } },
      { type: 'text', data: { text: 'reply text' } },
    ], ...{ channel: 'C001' }, logger: mockLogger() });
    expect(client.chat.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      thread_ts: '1700000001.000001', text: 'reply text',
    }));
  });
  it.each([{}, null, { ts: '' }, { ts: ' ' }, { ts: 123 }])('rejects an unconfirmed receipt %j without retry', async (response) => {
    const client = mockWebClient();
    client.chat.postMessage.mockResolvedValue(response);
    await expect(sendSlackContent(client, { content: 'hello', ...{ channel: 'C001' }, logger: mockLogger() }))
      .rejects.toThrow('delivery is unconfirmed');
    expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
  });

  it('does not send remaining chunks after an unconfirmed chunk', async () => {
    const client = mockWebClient();
    client.chat.postMessage.mockResolvedValueOnce({ ts: '1700000000.000000' }).mockResolvedValueOnce({});
    await expect(sendSlackContent(client, { content: 'x'.repeat(350_000), ...{ channel: 'C001' }, logger: mockLogger() }))
      .rejects.toThrow('delivery is unconfirmed');
    expect(client.chat.postMessage).toHaveBeenCalledTimes(2);
  });

  it('keeps a long confirmation card\'s buttons in the card\'s own conversation, each part with its text (#1250 b113)', async () => {
    const client = mockWebClient();
    let n = 0;
    client.chat.postMessage.mockImplementation(async () => ({ ts: `1700000000.00000${n++}` }));
    // 60 paragraphs of ~2.8k characters: more sections than one Slack message holds (48 blocks).
    const description = Array.from({ length: 60 }, (_, index) => `第 ${index + 1} 段 ${'说明'.repeat(1400)}`).join('\n\n');
    await sendSlackContent(client, { content: [
      { type: 'markdown', data: { content: `### 操作确认\n\n${description}` } },
      { type: 'keyboard', data: { rows: [[
        { id: 'interaction-1', label: '拒绝', payload: 'no' },
        { id: 'interaction-2', label: '允许一次', payload: 'yes' },
      ]] } },
    ], channel: 'C001', logger: mockLogger() });
    const calls = client.chat.postMessage.mock.calls.map((call: unknown[]) => call[0] as {
      text: string; blocks: { type: string }[]; thread_ts?: string;
    });
    expect(calls.length).toBeGreaterThan(1);
    // Every part stays where the card was sent: a click inside an auto-created thread would arrive as a
    // message of another conversation (the thread) and never answer the waiting prompt.
    expect(calls.every(call => call.thread_ts === undefined)).toBe(true);
    // The buttons are on one message, together with the end of the card's text.
    const withButtons = calls.filter(call => call.blocks.some(block => block.type === 'actions'));
    expect(withButtons).toHaveLength(1);
    expect(withButtons[0]!.blocks.some(block => block.type === 'section')).toBe(true);
    // No part is an empty notification.
    expect(calls.every(call => call.text.trim().length > 0)).toBe(true);
  });

  it('still threads the parts of a long reply without buttons under its first message', async () => {
    const client = mockWebClient();
    let n = 0;
    client.chat.postMessage.mockImplementation(async () => ({ ts: `1700000000.00000${n++}` }));
    await sendSlackContent(client, { content: [{ type: 'markdown', data: { content: Array.from({ length: 60 }, () => 'x'.repeat(2800)).join('\n\n') } }, { type: 'image', data: { media: { kind: 'url', value: 'https://example.com/a.png' } } }], channel: 'C001', logger: mockLogger() });
    const calls = client.chat.postMessage.mock.calls.map((call: unknown[]) => call[0] as { thread_ts?: string });
    expect(calls.length).toBeGreaterThan(1);
    expect(calls[0]!.thread_ts).toBeUndefined();
    expect(calls.slice(1).every(call => call.thread_ts === '1700000000.000000')).toBe(true);
  });

  it.each(['unsupported', 'rejected'])('does not report success after an %s file upload', async (failure) => {
    const client = mockWebClient();
    if (failure === 'unsupported') client.filesUploadV2 = undefined;
    else client.filesUploadV2.mockRejectedValue(new Error('upload denied'));
    await expect(sendSlackContent(client, { content: [
      { type: 'image', data: { media: { kind: 'base64', value: 'aGVsbG8=' } } },
    ], ...{ channel: 'C001' }, logger: mockLogger() })).rejects.toThrow();
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  it('should send plain text as mrkdwn block', async () => {
    const client = mockWebClient();
    const logger = mockLogger();
    const result = await sendSlackContent(client, { content: [
      { type: 'text', data: { text: 'hello world' } },
    ], ...{ channel: 'C001' }, logger: logger });

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
    await sendSlackContent(client, { content: [
      { type: 'text', data: { text: '**日常工具** - 签到' } },
    ], ...{ channel: 'C001' }, logger: logger });

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*日常工具* - 签到' } }],
      }),
    );
  });

  it('should send with thread_ts', async () => {
    const client = mockWebClient();
    const logger = mockLogger();
    await sendSlackContent(client, { content: 'reply in thread', ...{
      channel: 'C001',
      threadTs: '1699999999.000000',
    }, logger: logger });

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ thread_ts: '1699999999.000000' }),
    );
  });

  it('should convert mention segments to mrkdwn', async () => {
    const client = mockWebClient();
    const logger = mockLogger();
    await sendSlackContent(client, { content: [
      { type: 'at', data: { id: 'U12345' } },
      { type: 'text', data: { text: ' hello!' } },
    ], ...{ channel: 'C001' }, logger: logger });

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
    await sendSlackContent(client, { content: [
      { type: 'text', data: { text: longText } },
    ], ...{ channel: 'C001' }, logger: logger });

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
    await sendSlackContent(client, { content: [
      {
        type: 'keyboard',
        data: {
          rows: [
            [{ label: 'A', id: 'a' }, { label: 'B', id: 'b' }],
            [{ label: 'C', id: 'c' }],
          ],
        },
      },
    ], ...{ channel: 'C001' }, logger: logger });

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
    await sendSlackContent(client, { content: [
      { type: 'keyboard', data: { rows: [buttons] } },
    ], ...{ channel: 'C001' }, logger: logger });

    const actions = client.chat.postMessage.mock.calls[0][0].blocks.find((b: any) => b.type === 'actions');
    expect(actions.elements).toHaveLength(5);
  });

  it('should produce Block Kit actions from keyboard segments', async () => {
    const client = mockWebClient();
    const logger = mockLogger();
    await sendSlackContent(client, { content: [
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
    ], ...{ channel: 'C001' }, logger: logger });

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
    await sendSlackContent(client, { content: [
      { type: 'image', data: { media: { kind: 'url', value: 'https://example.com/cat.jpg' }, alt: 'Cat' } },
    ], ...{ channel: 'C001' }, logger: logger });

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [{ image_url: 'https://example.com/cat.jpg', title: 'Cat' }],
      }),
    );
  });

  it('should upload base64 image media via files.uploadV2', async () => {
    const client = mockWebClient();
    const logger = mockLogger();
    const base64 = Buffer.from('fake-image').toString('base64');
    await sendSlackContent(client, { content: [
      { type: 'image', data: { media: { kind: 'base64', value: base64, file_name: 'cat.png' } } },
    ], ...{ channel: 'C001' }, logger: logger });

    expect(client.filesUploadV2).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: 'C001',
        filename: 'cat.png',
      }),
    );
    const upload = client.filesUploadV2.mock.calls[0][0];
    expect(Buffer.isBuffer(upload.file)).toBe(true);
    expect(upload.file.toString()).toBe('fake-image');
  });

  it('should upload file media from local path', async () => {
    const client = mockWebClient();
    const logger = mockLogger();
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'slack-outbound-'));
    const filePath = join(dir, 'report.txt');
    await writeFile(filePath, 'report-body');
    try {
      await sendSlackContent(client, { content: [
        { type: 'file', data: { media: { kind: 'path', value: filePath, file_name: 'report.txt' } } },
      ], ...{ channel: 'C001' }, logger: logger });

      expect(client.filesUploadV2).toHaveBeenCalledWith(
        expect.objectContaining({ channel_id: 'C001', filename: 'report.txt' }),
      );
      const upload = client.filesUploadV2.mock.calls[0][0];
      expect(upload.file.toString()).toBe('report-body');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('should drop media segments without canonical MediaRef', async () => {
    const client = mockWebClient();
    const logger = mockLogger();
    await sendSlackContent(client, { content: [
      { type: 'image', data: { url: 'https://example.com/cat.jpg', title: 'Cat' } },
      { type: 'file', data: { file: '/tmp/a.txt', name: 'a.txt' } },
    ], ...{ channel: 'C001' }, logger: logger });

    expect(client.filesUploadV2).not.toHaveBeenCalled();
    const call = client.chat.postMessage.mock.calls[0][0];
    expect(call.attachments).toBeUndefined();
  });

  it('should drop kind=file media refs (no Slack equivalent)', async () => {
    const client = mockWebClient();
    const logger = mockLogger();
    await sendSlackContent(client, { content: [
      { type: 'image', data: { media: { kind: 'file', value: 'F0123ABC' } } },
    ], ...{ channel: 'C001' }, logger: logger });

    expect(client.filesUploadV2).not.toHaveBeenCalled();
    const call = client.chat.postMessage.mock.calls[0][0];
    expect(call.attachments).toBeUndefined();
  });

  it('should handle link segments', async () => {
    const client = mockWebClient();
    const logger = mockLogger();
    await sendSlackContent(client, { content: [
      { type: 'link', data: { url: 'https://example.com', text: 'Example' } },
    ], ...{ channel: 'C001' }, logger: logger });

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
    await editSlackContent(client, { channel: 'C001', ts: '1700000000.000000', content: [
      { type: 'text', data: { text: 'updated text' } },
    ] });

    expect(client.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C001',
        ts: '1700000000.000000',
        text: 'updated text',
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'updated text' } }],
      }),
    );
  });

  it('keeps the buttons when a long card is edited past one message\'s blocks (#1250 b113)', async () => {
    const client = mockWebClient();
    await editSlackContent(client, { channel: 'C001', ts: '1700000000.000000', content: [
      { type: 'markdown', data: { content: Array.from({ length: 60 }, (_, index) => `${index} ${'y'.repeat(2800)}`).join('\n\n') } },
      { type: 'keyboard', data: { rows: [[{ id: 'a', label: '拒绝', payload: 'no' }]] } },
    ] });
    const update = client.chat.update.mock.calls[0][0] as { text: string; blocks: { type: string }[] };
    expect(update.blocks.length).toBeLessThanOrEqual(48);
    expect(update.blocks.at(-1)?.type).toBe('actions');
    expect(update.text.trim().length).toBeGreaterThan(0);
  });
});

describe('splitBlocksIntoMessages (#1250 b113)', () => {
  const section = (index: number) => ({ type: 'section', text: { type: 'mrkdwn', text: `s${index}` } });
  const actions = (index: number) => ({ type: 'actions', elements: [{ type: 'button', action_id: `a${index}` }] });
  const sections = (count: number) => Array.from({ length: count }, (_, index) => section(index));
  const actionRows = (count: number) => Array.from({ length: count }, (_, index) => actions(index));
  const flat = (chunks: { type: string }[][]) => chunks.flat();

  it('keeps the original order when everything fits in one message', () => {
    const blocks = [section(0), actions(0), section(1)];
    expect(splitBlocksIntoMessages(blocks)).toEqual([blocks]);
  });

  it.each([1, 25, 30, 40, 47])('with %s action rows and long text every part stays within 48 blocks, buttons together on the last', count => {
    const blocks = [...sections(48), ...actionRows(count)];
    const chunks = splitBlocksIntoMessages(blocks);
    expect(chunks.every(chunk => chunk.length <= 48)).toBe(true);
    expect(flat(chunks)).toHaveLength(blocks.length);
    const last = chunks.at(-1)!;
    expect(last.filter(block => block.type === 'actions')).toHaveLength(count);
    expect(last.some(block => block.type === 'section')).toBe(true);
    expect(chunks.slice(0, -1).every(chunk => chunk.every(block => block.type !== 'actions'))).toBe(true);
    // The text keeps its order across parts.
    expect(flat(chunks).filter(block => block.type === 'section')).toEqual(sections(48));
  });

  it('30 action rows after 48 sections: no part past the limit (was [18, 60])', () => {
    expect(splitBlocksIntoMessages([...sections(48), ...actionRows(30)]).map(chunk => chunk.length)).toEqual([30, 48]);
  });

  it.each([48, 49, 60, 100])('with %s action rows (more than one message holds next to text) every part stays within 48 blocks in order', count => {
    const blocks = [...sections(48), ...actionRows(count)];
    const chunks = splitBlocksIntoMessages(blocks);
    expect(chunks.every(chunk => chunk.length > 0 && chunk.length <= 48)).toBe(true);
    expect(flat(chunks)).toEqual(blocks);
  });
});

describe('editSlackContent truncation notice (#1250 b113)', () => {
  it('adds a notice section when the text is cut, keeping the buttons last', async () => {
    const client = mockWebClient();
    await editSlackContent(client, { channel: 'C001', ts: '1700000000.000000', content: [
      { type: 'markdown', data: { content: Array.from({ length: 60 }, (_, index) => `${index} ${'y'.repeat(2800)}`).join('\n\n') } },
      { type: 'keyboard', data: { rows: [[{ id: 'a', label: '拒绝', payload: 'no' }]] } },
    ] });
    const update = client.chat.update.mock.calls[0][0] as { blocks: { type: string; text?: { text: string } }[] };
    expect(update.blocks).toHaveLength(48);
    expect(update.blocks.at(-1)?.type).toBe('actions');
    expect(update.blocks.at(-2)?.text?.text).toBe('[内容过长，已截断]');
  });

  it('adds no notice when nothing is cut', async () => {
    const client = mockWebClient();
    await editSlackContent(client, { channel: 'C001', ts: '1700000000.000000', content: [
      { type: 'markdown', data: { content: 'short' } },
      { type: 'keyboard', data: { rows: [[{ id: 'a', label: '拒绝', payload: 'no' }]] } },
    ] });
    const update = client.chat.update.mock.calls[0][0] as { blocks: { type: string; text?: { text: string } }[] };
    expect(JSON.stringify(update.blocks)).not.toContain('截断');
  });
});
