import { ADAPTERS, DATABASE_DIALECT_DEFINITIONS, type DatabaseConfig, type InitOptions } from '@zhin.js/scaffold-wizard';
import { createText, type CreateLocale } from './messages.js';

export const TEMPLATE_VALUES = ['default', 'life-assistant'] as const;
export const CONFIG_FORMAT_VALUES = ['yaml', 'json'] as const;

/**
 * Parsed create-zhin command line. Optional steps (database / adapters / AI)
 * are absent unless a flag asked for them (ADR 0053 §1).
 */
export interface CreateArgs {
  readonly projectName?: string;
  readonly yes: boolean;
  readonly skipInstall: boolean;
  readonly template?: NonNullable<InitOptions['template']>;
  readonly configFormat?: NonNullable<InitOptions['config']>;
  readonly devSkills?: boolean;
  /** `'interactive'`: bare `--database`, run the shared wizard step. */
  readonly database?: DatabaseConfig['dialect'] | 'interactive';
  /** Adapter values from `--adapter`; `'interactive'` for bare `--adapters`. */
  readonly adapters?: readonly string[] | 'interactive';
  /** Bare `--ai`: run the shared AI wizard step. */
  readonly ai: boolean;
}

const DATABASE_DIALECTS = DATABASE_DIALECT_DEFINITIONS.map((definition) => definition.dialect);
const ADAPTER_VALUES = ADAPTERS.map((adapter) => adapter.value);

function readChoice<T extends string>(
  locale: CreateLocale | undefined,
  flag: string,
  value: string | undefined,
  choices: readonly T[],
): T {
  if (value === undefined || !choices.includes(value as T)) {
    throw new TypeError(createText(locale, 'create.error.optionValue', [flag, choices.join(' | ')]));
  }
  return value as T;
}

/** Parse arguments that remain after `readProjectLocaleArgument` removed `--locale`. */
export function parseCreateArgs(args: readonly string[], locale?: CreateLocale): CreateArgs {
  let projectName: string | undefined;
  let yes = false;
  let skipInstall = false;
  let template: CreateArgs['template'];
  let configFormat: CreateArgs['configFormat'];
  let devSkills: boolean | undefined;
  let database: CreateArgs['database'];
  let adapters: string[] | 'interactive' | undefined;
  let ai = false;
  const seen = new Set<string>();
  const once = (flag: string) => {
    if (seen.has(flag)) throw new TypeError(createText(locale, 'create.error.optionRepeated', [flag]));
    seen.add(flag);
  };

  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    const eq = argument.startsWith('--') ? argument.indexOf('=') : -1;
    const flag = eq > 0 ? argument.slice(0, eq) : argument;
    const inline = eq > 0 ? argument.slice(eq + 1) : undefined;
    const takeValue = () => inline ?? args[++index];

    switch (flag) {
      case '-y':
      case '--yes':
        yes = true;
        break;
      case '--skip-install':
        skipInstall = true;
        break;
      case '--template':
        once(flag);
        template = readChoice(locale, flag, takeValue(), TEMPLATE_VALUES);
        break;
      case '--config-format':
        once(flag);
        configFormat = readChoice(locale, flag, takeValue(), CONFIG_FORMAT_VALUES);
        break;
      case '--dev-skills':
      case '--no-dev-skills':
        once('--dev-skills');
        devSkills = flag === '--dev-skills';
        break;
      case '--database': {
        once(flag);
        // A following dialect name is consumed; otherwise the flag is bare (interactive step).
        const next = inline ?? (DATABASE_DIALECTS.includes(args[index + 1] as never) ? args[++index] : undefined);
        database = next === undefined ? 'interactive' : readChoice(locale, flag, next, DATABASE_DIALECTS);
        break;
      }
      case '--adapter':
      case '--adapters': {
        const value = flag === '--adapter' ? takeValue() : inline;
        if (value === undefined) {
          if (flag === '--adapter') throw new TypeError(createText(locale, 'create.error.optionValue', [flag, ADAPTER_VALUES.join(' | ')]));
          if (Array.isArray(adapters)) throw new TypeError(createText(locale, 'create.error.optionRepeated', [flag]));
          adapters = 'interactive';
          break;
        }
        if (adapters === 'interactive') throw new TypeError(createText(locale, 'create.error.optionRepeated', ['--adapters']));
        const list = adapters ?? [];
        for (const name of value.split(',').map((part) => part.trim()).filter(Boolean)) {
          const adapter = readChoice(locale, '--adapter', name, ADAPTER_VALUES);
          if (!list.includes(adapter)) list.push(adapter);
        }
        adapters = list;
        break;
      }
      case '--ai':
        once(flag);
        ai = true;
        break;
      default:
        if (argument.startsWith('-')) throw new TypeError(createText(locale, 'create.error.unknownOption', [argument]));
        if (projectName !== undefined) throw new TypeError(createText(locale, 'create.error.extraName', [projectName, argument]));
        projectName = argument;
    }
  }

  return { projectName, yes, skipInstall, template, configFormat, devSkills, database, adapters, ai };
}
