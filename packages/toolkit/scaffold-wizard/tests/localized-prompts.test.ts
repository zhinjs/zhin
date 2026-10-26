import inquirer from 'inquirer';
import { configureAdapters } from '../src/adapter.js';
import { configureDatabaseOptions } from '../src/database.js';
import { configureAI } from '../src/ai.js';
import { validateDatabaseConfig } from '../src/database-definitions.js';
import { WIZARD_MESSAGES, wizardText } from '../src/messages.js';

afterEach(() => vi.restoreAllMocks());

it('keeps authored code/env placeholders and user values unchanged while translating copy', () => {
  expect(wizardText('en', '{v0} 不能为空', ['用户 {v1} ${TOKEN}'])).toBe('用户 {v1} ${TOKEN} is required');
  const source = wizardText('en', 'templates.echoTool');
  expect(source).toContain('return `echo: ${message}`');
  expect(source).toContain('inputSchema: z.object({ message: z.string().min(1) })');
  expect(wizardText('zh-CN', '名称不能为空')).toBe('名称不能为空');
  expect(wizardText('en', 'External provider text')).toBe('External provider text');
  for (const entry of Object.values(WIZARD_MESSAGES)) {
    const slots = (text: string) => [...new Set([...text.matchAll(/\{([a-zA-Z][\w]*)\}/gu)].map(match => match[1]))].sort();
    expect(slots(entry.en)).toEqual(slots(entry['zh-CN']));
  }
});

it('translates actual adapter selection and endpoint prompts without changing protocol values or credentials', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const prompt = vi.spyOn(inquirer, 'prompt')
    .mockResolvedValueOnce({ selectedAdapters: ['sandbox', 'telegram'] })
    .mockResolvedValueOnce({ endpointId: 'telegram-test' })
    .mockResolvedValueOnce({ token: 'synthetic-token' })
    .mockResolvedValueOnce({ transport: 'polling' });
  const result = await configureAdapters('en');
  const questions = prompt.mock.calls.flatMap(call => call[0] as any[]);
  expect(questions.every(question => !/[\u3400-\u9fff]/u.test(question.message))).toBe(true);
  const adapters = questions.find(question => question.name === 'selectedAdapters');
  expect(adapters.choices.find((choice: any) => choice.value === 'sandbox')).toMatchObject({checked: true, disabled: 'Required by default'});
  expect(adapters.choices.every((choice: any) => !/[\u3400-\u9fff]/u.test(choice.name))).toBe(true);
  expect(result.instances.find(instance => instance.instanceKey === 'telegram')?.config).toMatchObject({polling:true,endpoints:[{id:'telegram-test', token:'${TELEGRAM_TOKEN}'}]});
  expect(result.envVars.TELEGRAM_TOKEN).toBe('synthetic-token');
});

it('uses English database labels and validation with the same defaults and no timezone inference', async () => {
  const prompt = vi.spyOn(inquirer, 'prompt').mockResolvedValueOnce({dialect:'sqlite'}).mockResolvedValueOnce({filename:'./data/custom.db',mode:'wal'});
  expect(await configureDatabaseOptions('en')).toEqual({dialect:'sqlite',filename:'./data/custom.db',mode:'wal'});
  const questions=prompt.mock.calls.flatMap(call=>call[0] as any[]);
  expect(questions[0].message).toBe('Select a database type:');
  expect(questions[0].choices.every((choice: any)=>!/[\u3400-\u9fff]/u.test(choice.name))).toBe(true);
  expect(questions.find(question=>question.name==='filename').validate('')).toBe('File path is required');
  expect(validateDatabaseConfig({dialect:'sqlite',filename:7},{},'en')[0]?.message).toBe('database.filename must be a string');
});

it('does not carry a previous wizard language into another invocation or change the AI enable default', async () => {
  vi.spyOn(console,'log').mockImplementation(()=>{});
  const prompt=vi.spyOn(inquirer,'prompt').mockResolvedValue({enabled:false});
  expect(await configureAI('en')).toEqual({enabled:false});
  expect(await configureAI()).toEqual({enabled:false});
  expect((prompt.mock.calls[0]![0] as any[])[0]).toMatchObject({message:'Enable AI Agent? (LLM conversations and tool calls)',default:true});
  expect((prompt.mock.calls[1]![0] as any[])[0].message).toContain('是否启用');
});
