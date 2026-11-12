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
  const context = { locale: 'en', signal: new AbortController().signal, $client: client, origin: { kind: 'im', platform: 'napcat', conversation } } as never;
  return { client, context };
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

  it('send_forward_msg sends to the current conversation and only references its messages', async () => {
    expect(Object.keys((sendForward.inputSchema as unknown as { shape: Record<string, unknown> }).shape)).toEqual(['messages']);
    const group = fixture();
    const custom = { type: 'node', data: { user_id: 1, nickname: 'n', content: 'hi' } };
    await sendForward.execute({ message_type: 'private', id: 999, messages: JSON.stringify([custom, { type: 'node', data: { id: 1 } }]) } as never, group.context);
    expect(group.client.sendForwardMsg).toHaveBeenCalledWith('group', 100, [custom, { type: 'node', data: { id: 1 } }]);
    await expect(sendForward.execute({ messages: JSON.stringify([{ type: 'node', data: { id: 3 } }]) }, group.context)).rejects.toThrow('not in the current group');
    const dm = fixture('private');
    await sendForward.execute({ messages: JSON.stringify([{ type: 'node', data: { id: 2 } }]) }, dm.context);
    expect(dm.client.sendForwardMsg).toHaveBeenCalledWith('private', 5, [{ type: 'node', data: { id: 2 } }]);
    await expect(sendForward.execute({ messages: JSON.stringify([{ type: 'node', data: { id: 1 } }]) }, dm.context)).rejects.toThrow('not in the current conversation');
    expect(group.client.sendForwardMsg).toHaveBeenCalledOnce();
  });

  it('forward_single_msg crosses conversations, so it requires the global owner', () => {
    expect(forwardSingle.permissions).toEqual(['owner@global']);
  });
});
