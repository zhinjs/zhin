import { describe, expect, it, vi } from 'vitest';
import essenceList from '../agents/napcat/skills/napcat-group-content/tools/get_essence_list/index.js';
import groupNotice from '../agents/napcat/skills/napcat-group-content/tools/get_group_notice/index.js';
import fileUrl from '../agents/napcat/skills/napcat-group-files-history/tools/get_group_file_url/index.js';
import groupHistory from '../agents/napcat/skills/napcat-group-files-history/tools/get_group_msg_history/index.js';
import rootFiles from '../agents/napcat/skills/napcat-group-files-history/tools/get_group_root_files/index.js';
import uploadFile from '../agents/napcat/skills/napcat-group-files-history/tools/upload_group_file/index.js';
import aiTts from '../agents/napcat/skills/napcat-group-media/tools/ai_tts/index.js';
import aiCharacters from '../agents/napcat/skills/napcat-group-media/tools/get_ai_characters/index.js';
import infoEx from '../agents/napcat/skills/napcat-group-settings/tools/get_group_info_ex/index.js';
import shutList from '../agents/napcat/skills/napcat-group-settings/tools/get_group_shut_list/index.js';
import groupSign from '../agents/napcat/skills/napcat-group-settings/tools/group_sign/index.js';
import friendHistory from '../agents/napcat/skills/napcat-private-history/tools/get_friend_msg_history/index.js';
import sendPoke from '../agents/napcat/skills/napcat-messaging/tools/send_poke/index.js';
import sendForward from '../agents/napcat/skills/napcat-messaging/tools/send_forward_msg/index.js';
import forwardSingle from '../agents/napcat/skills/napcat-messaging/tools/forward_single_msg/index.js';
import ocrImage from '../agents/napcat/skills/napcat-media/tools/ocr_image/index.js';
import sendNotice from '../agents/napcat/skills/napcat-group-content/tools/send_group_notice/index.js';
import setAvatar from '../agents/napcat/skills/napcat-account/tools/set_avatar/index.js';
import setPortrait from '../agents/napcat/skills/napcat-group-settings/tools/set_group_portrait/index.js';
import downloadFile from '../agents/napcat/skills/napcat-files-history/tools/download_file/index.js';
import { isRemoteMediaSource } from '../agents/napcat/media.js';
import { formatOutboundSegments } from '../src/protocol.js';
import { assertCanonicalSegments, toCanonicalSegments } from '@zhin.js/core';

type Tool = { inputSchema: unknown; permissions?: readonly string[]; execute(input: unknown, context: never): Promise<unknown> };

function fixture(kind: 'group' | 'private' = 'group', id = kind === 'group' ? '100' : '5') {
  const api = vi.fn(async () => ({}));
  const client = new Proxy({
    callApi: vi.fn(async (_action: string, params: { message_id: number }) => (params.message_id === 1
      ? { message_type: 'group', group_id: 100 }
      : params.message_id === 2 ? { message_type: 'private', user_id: 5 }
        : { message_type: 'group', group_id: 999 })),
  } as Record<string, ReturnType<typeof vi.fn>>, { get: (target, key: string) => target[key] ?? (target[key] = vi.fn(api)) });
  const conversation = { endpoint: { adapter: 'napcat', id: 'bot' }, kind, id };
  const send = vi.fn(async (_request: unknown) => ({ status: 'sent', message: { id: '77' } }));
  const context = { locale: 'en', signal: new AbortController().signal, $client: client, owner: { id: 'napcat-plugin' }, use: () => ({ send }),
    origin: { kind: 'im', platform: 'napcat', conversation } } as never;
  return { client, send, context };
}

const groupTools: [string, Tool, Record<string, unknown>, string, unknown[]][] = [
  ['get_essence_list', essenceList, {}, 'getEssenceMsgList', [100]],
  ['get_group_notice', groupNotice, {}, 'getGroupNotice', [100]],
  ['get_group_file_url', fileUrl, { file_id: 'f', busid: 1 }, 'getGroupFileUrl', [100, 'f', 1]],
  ['get_group_msg_history', groupHistory, { count: 5 }, 'getGroupMsgHistory', [100, undefined, 5]],
  ['get_group_root_files', rootFiles, {}, 'getGroupRootFiles', [100]],
  ['upload_group_file', uploadFile, { file: 'https://x/y', name: 'y' }, 'uploadGroupFile', [{ groupId: 100, file: 'https://x/y', name: 'y', folder: undefined }]],
  ['ai_tts', aiTts, { character: 'c', text: 't' }, 'sendGroupAiRecord', [100, 'c', 't']],
  ['get_ai_characters', aiCharacters, {}, 'getAiCharacters', [100]],
  ['get_group_info_ex', infoEx, {}, 'getGroupInfoEx', [100]],
  ['get_group_shut_list', shutList, {}, 'getGroupShutList', [100]],
  ['group_sign', groupSign, {}, 'sendGroupSign', [100]],
] as never;

describe('NapCat group tools act on the current group only', () => {
  it.each(groupTools)('%s has no group_id input and ignores a model-supplied one', async (_name, tool, input, method, args) => {
    expect((tool.inputSchema as { shape: Record<string, unknown> }).shape).not.toHaveProperty('group_id');
    const f = fixture();
    await tool.execute({ ...input, group_id: 999 }, f.context);
    expect(f.client[method]).toHaveBeenCalledWith(...args);
  });

  it.each(groupTools)('%s refuses outside a group', async (_name, tool, input) => {
    await expect(tool.execute(input, fixture('private').context)).rejects.toThrow('current QQ group');
  });

  it('upload_group_file reads host files, so it requires the global owner', () => {
    expect(uploadFile.permissions).toEqual(['owner@global']);
  });
});

describe('NapCat private / messaging tools act on the current conversation only', () => {
  it('get_friend_msg_history reads only the current private peer', async () => {
    expect((friendHistory.inputSchema as unknown as { shape: Record<string, unknown> }).shape).not.toHaveProperty('user_id');
    const f = fixture('private');
    await friendHistory.execute({ user_id: 999, count: 3 } as never, f.context);
    expect(f.client.getFriendMsgHistory).toHaveBeenCalledWith(5, undefined, 3);
    await expect(friendHistory.execute({}, fixture('group').context)).rejects.toThrow('private chat');
  });

  it('send_poke pokes in the current group, or the peer in a private chat', async () => {
    const group = fixture();
    await sendPoke.execute({ user_id: 7, group_id: 999 } as never, group.context);
    expect(group.client.sendPoke).toHaveBeenCalledWith(7, 100);
    expect(await sendPoke.execute({}, group.context)).toMatchObject({ success: false });
    const dm = fixture('private');
    await sendPoke.execute({ user_id: 7 }, dm.context);
    expect(dm.client.sendPoke).toHaveBeenCalledWith(5, undefined);
  });

  it('send_forward_msg goes through the outbound chain to the current conversation and only references its messages', async () => {
    expect(Object.keys((sendForward.inputSchema as unknown as { shape: Record<string, unknown> }).shape)).toEqual(['messages']);
    const group = fixture();
    const custom = { type: 'node', data: { user_id: 1, nickname: 'n', content: [{ type: 'text', data: { text: 'hi' } }] } };
    expect(await sendForward.execute({ message_type: 'private', id: 999, messages: JSON.stringify([custom, { type: 'node', data: { id: 1 } }]) } as never, group.context))
      .toMatchObject({ success: true, message_id: '77' });
    expect(group.client.sendForwardMsg).not.toHaveBeenCalled();
    expect(group.send).toHaveBeenCalledExactlyOnceWith({
      requester: 'napcat-plugin',
      conversation: expect.objectContaining({ kind: 'group', id: '100' }),
      content: [{ type: 'napcat:node', data: custom.data }, { type: 'napcat:node', data: { id: 1 } }],
    });
    await expect(sendForward.execute({ messages: JSON.stringify([{ type: 'node', data: { id: 3 } }]) }, group.context)).rejects.toThrow('not in the current group');
    const dm = fixture('private');
    await sendForward.execute({ messages: JSON.stringify([{ type: 'node', data: { id: 2 } }]) }, dm.context);
    expect(dm.send).toHaveBeenCalledWith(expect.objectContaining({ conversation: expect.objectContaining({ kind: 'private', id: '5' }) }));
    await expect(sendForward.execute({ messages: JSON.stringify([{ type: 'node', data: { id: 1 } }]) }, dm.context)).rejects.toThrow('not in the current conversation');
    expect(group.send).toHaveBeenCalledOnce();
  });

  it('send_forward_msg refuses host files and foreign messages nested in node content', async () => {
    const f = fixture();
    for (const file of ['file:///etc/passwd', '/etc/passwd', 'C:\\Windows\\win.ini', '../secret.png']) {
      const node = { type: 'node', data: { user_id: 1, nickname: 'n', content: [{ type: 'image', data: { file } }] } };
      await expect(sendForward.execute({ messages: JSON.stringify([node]) }, f.context)).rejects.toThrow('not a local path');
    }
    const nested = { type: 'node', data: { user_id: 1, nickname: 'n', content: [{ type: 'node', data: { id: 3 } }] } };
    await expect(sendForward.execute({ messages: JSON.stringify([nested]) }, f.context)).rejects.toThrow('not in the current group');
    const remote = { type: 'node', data: { user_id: 1, nickname: 'n', content: [{ type: 'image', data: { file: 'https://example.com/a.png' } }] } };
    await sendForward.execute({ messages: JSON.stringify([remote]) }, f.context);
    expect(f.send).toHaveBeenCalledOnce();
  });

  it('the NapCat wire encoder turns napcat:node into OneBot node segments', () => {
    const segments = toCanonicalSegments([{ type: 'napcat:node', data: { id: 1 } }]);
    expect(() => assertCanonicalSegments(segments)).not.toThrow();
    expect(formatOutboundSegments(segments)).toEqual([{ type: 'node', data: { id: 1 } }]);
  });

  it('forward_single_msg crosses conversations, so it requires the global owner', () => {
    expect(forwardSingle.permissions).toEqual(['owner@global']);
  });
});

describe('NapCat tools never read host files for non-owners', () => {
  it('classifies media sources', () => {
    for (const ok of ['https://x/y.png', 'http://x', 'base64://AAAA', 'abcdef0123.image', '{ABCD-1234}.jpg']) expect(isRemoteMediaSource(ok), ok).toBe(true);
    for (const bad of ['', 'file:///etc/passwd', '/etc/passwd', './a', '../a', '~/a', 'C:\\a', 'c:/a', 'data:image/png;base64,AA', 'dir/file']) {
      expect(isRemoteMediaSource(bad), bad).toBe(false);
    }
  });

  it('ocr_image and send_group_notice refuse local paths', async () => {
    const f = fixture();
    await expect(ocrImage.execute({ image: 'file:///etc/passwd' }, f.context)).rejects.toThrow('not a local path');
    await expect(sendNotice.execute({ content: 'c', image: '/etc/passwd' }, f.context)).rejects.toThrow('not a local path');
    expect(f.client.ocrImage).not.toHaveBeenCalled();
    expect(f.client.sendGroupNotice).not.toHaveBeenCalled();
    await ocrImage.execute({ image: 'https://x/y.png' }, f.context);
    await sendNotice.execute({ content: 'c', image: 'base64://AAAA' }, f.context);
    expect(f.client.ocrImage).toHaveBeenCalledWith('https://x/y.png');
    expect(f.client.sendGroupNotice).toHaveBeenCalledWith(100, 'c', 'base64://AAAA');
  });

  it('host-file tools require the global owner', () => {
    expect(setAvatar.permissions).toEqual(['owner@global']);
    expect(setPortrait.permissions).toEqual(['owner@global', 'bot:admin']);
    expect(downloadFile.permissions).toEqual(['owner@global']);
    expect(uploadFile.permissions).toEqual(['owner@global']);
  });
});
