import { describe, expect, it, vi } from 'vitest';
import { createSceneManagementTools } from '../src/built/common-adapter-tools.js';

const message = { endpointId: 'bot-1', conversation: { id: 'group-A', kind: 'group', endpoint: { id: 'bot-1', adapter: 'x' } } };

describe('scene management tool factory', () => {
  const create = createSceneManagementTools;
  it('requires the sender and Bot platform standing', () => {
    const tools = create({ removeMember: vi.fn(async () => true), setModerator: vi.fn(async () => true) }, 'x');
    expect(tools.find((t) => t.name === 'x_remove_member')?.permissions).toEqual(['platform:admin', 'bot:admin']);
    expect(tools.find((t) => t.name === 'x_set_moderator')?.permissions).toEqual(['platform:owner', 'bot:owner']);
  });

  it('targets the current conversation, ignoring model-supplied endpoint / scene ids', async () => {
    const removeMember = vi.fn(async () => true);
    const [tool] = create({ removeMember }, 'x');
    await tool!.execute({ endpoint_id: 'bot-2', scene_id: 'group-B', user_id: 'u1' }, message as never);
    expect(removeMember).toHaveBeenCalledExactlyOnceWith('bot-1', 'group-A', 'u1');
  });

  it('refuses without a current conversation', async () => {
    const removeMember = vi.fn(async () => true);
    const [tool] = create({ removeMember }, 'x');
    await expect(tool!.execute({ endpoint_id: 'bot-2', scene_id: 'group-B', user_id: 'u1' })).rejects.toThrow('current conversation');
    expect(removeMember).not.toHaveBeenCalled();
  });
});
