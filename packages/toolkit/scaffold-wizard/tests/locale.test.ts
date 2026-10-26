import inquirer from 'inquirer';
import { configureProjectLocale, readProjectLocaleArgument } from '../src/locale.js';
import { applyWizardOptionsToConfig, buildRuntimeConfigDocument } from '../src/apply.js';

afterEach(() => vi.restoreAllMocks());

it('selects an explicit project language without changing unattended defaults or guessing a timezone', async () => {
  const prompt = vi.spyOn(inquirer, 'prompt').mockResolvedValue({ locale: 'en' });
  expect(await configureProjectLocale({ yes: true })).toBe('zh-CN');
  expect(await configureProjectLocale({ yes: true, locale: 'en' })).toBe('en');
  expect(prompt).not.toHaveBeenCalled();
  expect(await configureProjectLocale()).toBe('en');
  const english = buildRuntimeConfigDocument({ locale: 'en' });
  expect(english.locale).toBe('en');
  expect(english).not.toHaveProperty('timezone');
  const existing: Record<string, unknown> = { configVersion: 2, locale: 'en', timezone: 'UTC', plugins: {} };
  applyWizardOptionsToConfig(existing, {});
  expect(existing.locale).toBe('en');
  applyWizardOptionsToConfig(existing, { locale: 'zh-CN' });
  expect(existing).toMatchObject({ locale: 'zh-CN', timezone: 'UTC' });
});

it('does not confuse a locale argument with the project name and rejects malformed or duplicate selections', () => {
  expect(readProjectLocaleArgument(['--locale', 'en', 'my-bot', '-y'])).toEqual({ locale: 'en', remaining: ['my-bot', '-y'] });
  expect(readProjectLocaleArgument(['my-bot', '--locale=zh-CN'])).toEqual({ locale: 'zh-CN', remaining: ['my-bot'] });
  for (const args of [['--locale'], ['--locale', '-y'], ['--locale=de'], ['--locale=en', '--locale=zh-CN']]) {
    expect(() => readProjectLocaleArgument(args)).toThrow();
  }
});
