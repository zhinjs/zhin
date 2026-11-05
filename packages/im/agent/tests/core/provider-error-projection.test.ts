import { inspect } from 'node:util';
import { agentLoop, createUserMessage } from '@zhin.js/ai';
import { getLogger } from '@zhin.js/logger';
import { openAiCompatibleProvider } from '../../../ai/src/providers/api-key.js';
import { driverFixture, callContext } from '../../../ai/tests/providers/fixtures.js';
import { createInvocationCompletion, invocationModel } from '../../src/model-runtime/completion.js';

it('keeps actual Agent-loop error messages and the SDK diagnostic log free of private HTTP contents', async () => {
  const secret = 'synthetic-private-provider-body';
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warn = vi.spyOn(getLogger('LLM'), 'warn').mockImplementation(() => {});
  const fixture = driverFixture({ definition: openAiCompatibleProvider, options: { baseUrl: 'https://provider.example/v1' },
    model: { id: 'selected', protocol: 'openai-chat', kinds: ['language'], streaming: true }, parameters: { maxRetries: 0 },
    fetch: async () => Response.json({ error: { message: secret } }, { status: 400 }) });
  const scope = await fixture.runtime.openScope({ context: callContext });
  try {
    const binding = await scope.resolve({ kind: 'language', purpose: 'chat' });
    const events = [];
    for await (const event of agentLoop(createUserMessage('hello'), { systemPrompt: '', messages: [], tools: [] }, {
      model: invocationModel(binding), transport: createInvocationCompletion({ binding, client: scope.client, purpose: 'chat' }),
      maxIterations: 1, streamOptions: { onTextDelta() {} },
    })) events.push(event);
    const ended = events.find(event => event.type === 'message_end');
    expect(ended).toMatchObject({ message: { stopReason: 'error', errorMessage: expect.stringContaining('bad_request') } });
    expect(`${inspect(events)}${inspect(consoleError.mock.calls)}${inspect(warn.mock.calls)}`).not.toContain(secret);
    expect(consoleError).not.toHaveBeenCalled(); expect(warn).toHaveBeenCalled();
  } finally { await scope.close(); consoleError.mockRestore(); warn.mockRestore(); }
});
