import { expect, vi } from 'vitest';

/** Explicit synthetic command operation for direct entry tests; Runtime integration is tested separately. */
export async function invokeGameCommand(
  command: { execute(context: never): unknown },
  context: object,
): Promise<unknown> {
  const sent: unknown[] = [];
  const reply = vi.fn(async (content: unknown) => {
    sent.push(content);
  });
  const result = await command.execute({ ...context, session: { reply } } as never);
  if (result !== undefined) {
    expect(sent).toHaveLength(0);
    return result;
  }
  expect(sent).toHaveLength(1);
  return sent[0];
}
