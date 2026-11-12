import { createFakeMessage, runCommand, runPluginSetup } from '@zhin.js/testing';
import schema from '../schema.json' with { type: 'json' };
import plugin from '../plugin.js';
import drivingCommand from '../commands/科目一/index.js';
import boringCommand from '../commands/好无聊/index.js';

const inGroup = (id: string) => createFakeMessage({ conversation: { endpoint: { adapter: 'sandbox', id: 'bot' }, kind: 'group', id }, sender: { id: 'u' } });

describe('answers layered feature config (ADR 0050 / 0055)', () => {
  it('declares the quiz fields for the conversation level and self-service', () => {
    expect(schema['x-zhin-config']).toEqual({ levels: ['global', 'adapter', 'endpoint', 'conversation'],
      conversationFields: ['dailyStable', 'quizTimeoutSeconds', 'enableDrivingQuiz'], selfServiceFields: ['quizTimeoutSeconds', 'enableDrivingQuiz'] });
  });

  it('reads the per-conversation effective config in commands', async () => {
    const fake = await runPluginSetup(plugin, { config: {}, feature: {
      configFor: target => {
        const id = (target as { conversation?: { id?: string } }).conversation?.id;
        return id === 'no-driving' ? { enableDrivingQuiz: false } : id === 'slow' ? { quizTimeoutSeconds: 300 } : undefined;
      },
    } });
    try {
      expect(String(await runCommand(fake, drivingCommand, { input: inGroup('no-driving') }))).toContain('enableDrivingQuiz: false');
      expect(String(await runCommand(fake, drivingCommand, { input: inGroup('default') }))).not.toContain('enableDrivingQuiz: false');
      expect(String(await runCommand(fake, boringCommand, { input: inGroup('slow') }))).toContain('300');
      expect(String(await runCommand(fake, boringCommand, { input: inGroup('default') }))).toContain('120');
    } finally { await fake.dispose(); }
  });
});
