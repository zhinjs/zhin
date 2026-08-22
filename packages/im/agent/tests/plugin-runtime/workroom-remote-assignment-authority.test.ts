import { describe, expect, it, vi } from 'vitest';
import {
  createGenerationWorkroomRemoteAssignmentAuthority,
} from '../../src/plugin-runtime/workroom-remote-assignment-authority.js';

describe('generation Remote Assignment authority proxy', () => {
  it('fails closed without a current Profile authority and resolves every call anew', async () => {
    const first = { resolve: vi.fn(async () => ({ marker: 'first' })) };
    const second = { resolve: vi.fn(async () => ({ marker: 'second' })) };
    let current: typeof first | typeof second | undefined;
    const proxy = createGenerationWorkroomRemoteAssignmentAuthority(() => current as never);
    const input = {} as never;

    await expect(proxy.resolve(input)).rejects.toThrow('active Project Profile');
    current = first;
    await expect(proxy.resolve(input)).resolves.toEqual({ marker: 'first' });
    current = second;
    await expect(proxy.resolve(input)).resolves.toEqual({ marker: 'second' });
    expect(first.resolve).toHaveBeenCalledOnce();
    expect(second.resolve).toHaveBeenCalledOnce();
  });
});
