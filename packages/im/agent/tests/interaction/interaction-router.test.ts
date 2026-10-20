import { describe, expect, it, vi } from 'vitest';
import { InteractionRouter } from '../../src/interaction/interaction-router.js';

describe('InteractionRouter', () => {
  it('matches canonical session and subject, validates through the current reply, then settles once', async () => {
    const router = new InteractionRouter();
    const controller = new AbortController();
    const initial = vi.fn(async () => undefined);
    const current = vi.fn(async () => undefined);
    const answer = router.ask(
      { sessionKey: 'im:bot:group:room', subjectId: 'owner' },
      {
        requestId: 'question-1',
        question: 'Deploy?',
        type: 'confirm',
        signal: controller.signal,
      },
      initial,
    );

    await vi.waitFor(() => expect(initial).toHaveBeenCalledWith('Deploy?\n请回复 yes/no。'));
    await expect(router.consume({
      sessionKey: 'im:bot:group:room', subjectId: 'intruder', text: 'yes', deliver: current,
    })).resolves.toBe(false);
    await expect(router.consume({
      sessionKey: 'im:bot:group:room', subjectId: 'owner', text: 'maybe', deliver: current,
    })).resolves.toBe(true);
    expect(current).toHaveBeenCalledWith('请回复 yes 或 no。');
    await expect(router.consume({
      sessionKey: 'im:bot:group:room', subjectId: 'owner', text: 'yes', deliver: current,
    })).resolves.toBe(true);
    await expect(answer).resolves.toEqual({ type: 'confirm', value: true });
    expect(router.pendingCount).toBe(0);
  });

  it('fails closed when an invalid reply has no live delivery authority', async () => {
    const router = new InteractionRouter();
    const controller = new AbortController();
    const answer = router.ask(
      { sessionKey: 'session', subjectId: 'user' },
      { requestId: 'q', question: 'Number?', type: 'number', signal: controller.signal },
      async () => undefined,
    );

    await expect(router.consume({ sessionKey: 'session', subjectId: 'user', text: 'NaN' }))
      .rejects.toThrow('current delivery authority');
    await expect(answer).rejects.toThrow('current delivery authority');
    expect(router.pendingCount).toBe(0);
  });

  it('cancels pending questions on Root shutdown', async () => {
    const router = new InteractionRouter();
    const answer = router.ask(
      { sessionKey: 'session', subjectId: 'user' },
      { requestId: 'q', question: 'Name?', type: 'text', signal: new AbortController().signal },
      async () => undefined,
    );

    router.close(new Error('root stopped'));
    await expect(answer).rejects.toThrow('root stopped');
    await expect(router.ask(
      { sessionKey: 'session', subjectId: 'user' },
      { requestId: 'q2', question: 'Again?', type: 'text', signal: new AbortController().signal },
      async () => undefined,
    )).rejects.toThrow('closed');
  });
});
