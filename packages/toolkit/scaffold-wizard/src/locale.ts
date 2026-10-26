import inquirer from 'inquirer';
import { isLocale, resolveLocale, type Locale } from '@zhin.js/plugin-runtime';

/** Explicit language selection; never infer a location or timezone from language. */
export async function configureProjectLocale(options: {
  readonly locale?: unknown;
  readonly yes?: boolean;
  readonly current?: unknown;
} = {}): Promise<Locale> {
  if (options.locale !== undefined) return validateProjectLocale(options.locale);
  const current = resolveLocale(options.current);
  if (options.yes) return current;
  const { locale } = await inquirer.prompt<{ locale: unknown }>([{
    type: 'select', name: 'locale', message: '项目语言 / Project language:',
    choices: [{ name: '简体中文', value: 'zh-CN' }, { name: 'English', value: 'en' }],
    default: current,
  }]);
  return validateProjectLocale(locale);
}

export function validateProjectLocale(value: unknown): Locale {
  if (!isLocale(value)) throw new TypeError('语言必须为 zh-CN 或 en / Language must be zh-CN or en');
  return value;
}

/** Remove locale arguments before selecting a positional project name. */
export function readProjectLocaleArgument(args: readonly string[]): {
  readonly locale?: Locale;
  readonly remaining: readonly string[];
} {
  let locale: Locale | undefined;
  const remaining: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === '--locale' || argument.startsWith('--locale=')) {
      if (locale !== undefined) throw new TypeError('请勿重复 --locale / Specify --locale only once');
      locale = validateProjectLocale(argument === '--locale' ? args[++index] : argument.slice('--locale='.length));
    } else remaining.push(argument);
  }
  return { locale, remaining };
}
