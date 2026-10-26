/** #857: a typed plugin config in convention command files without losing params inference. */
import { expectTypeOf } from 'vitest';
import type { PluginSetupContext } from '@zhin.js/plugin-runtime';
import { defineCommand, type CommandParameterValue } from '../../src/index.js';

interface Config { readonly prefix: string; readonly limit: number }

// withConfig: config is typed and params / options / result are still inferred.
const curried = defineCommand.withConfig<Config>()({
  params: { count: { type: 'integer', min: 1 }, name: { type: 'string', optional: true } },
  options: { loud: { type: 'boolean' } },
  execute({ params, options, config, locale, formatCommand }) {
    expectTypeOf(locale).toEqualTypeOf<'zh-CN' | 'en'>();
    expectTypeOf(formatCommand('hello')).toEqualTypeOf<string | undefined>();
    expectTypeOf(config).toEqualTypeOf<Readonly<Config>>();
    expectTypeOf(params.count).toEqualTypeOf<number>();
    expectTypeOf(params.name).toEqualTypeOf<string | undefined>();
    expectTypeOf(options.loud).toEqualTypeOf<boolean | undefined>();
    // @ts-expect-error undeclared parameter is not available
    void params.missing;
    // @ts-expect-error config keys are checked
    void config.missing;
    return `${config.prefix}${params.count}`;
  },
});
expectTypeOf(curried.execute).returns.toEqualTypeOf<string | Promise<string>>();

// The definer is reusable across files of one plugin.
const definePluginCommand = defineCommand.withConfig<Config>();
definePluginCommand({
  params: { word: { type: 'string' } },
  execute({ params, config }) {
    expectTypeOf(params.word).toEqualTypeOf<string>();
    expectTypeOf(config.limit).toEqualTypeOf<number>();
  },
});

// Registered during setup, the curried definition must match that plugin's config.
declare const setup: PluginSetupContext<Config>;
setup.addCommand('typed', curried);
declare const other: PluginSetupContext<{ different: string }>;
// @ts-expect-error a command typed for another config is rejected
other.addCommand('unrelated', curried);

// Existing forms are unchanged.
defineCommand({
  params: { count: { type: 'integer' } },
  execute({ params, config }) {
    expectTypeOf(params.count).toEqualTypeOf<number>();
    expectTypeOf(config).toEqualTypeOf<Readonly<unknown>>();
  },
});
defineCommand<Config>({
  params: { count: { type: 'integer' } },
  execute({ params, config }) {
    expectTypeOf(config).toEqualTypeOf<Readonly<Config>>();
    // Explicit type arguments disable partial inference: params fall back to the generic record.
    expectTypeOf(params).toEqualTypeOf<Readonly<Record<string, CommandParameterValue>>>();
  },
});

// @ts-expect-error the definer still requires execute
definePluginCommand({ description: 'no execute' });

// defineCommand stays a single-signature value for factories such as createEndpointCommands.
declare function acceptsDefiner<T>(define: (definition: { execute(context: never): unknown }) => T): T;
expectTypeOf(acceptsDefiner(defineCommand)).toEqualTypeOf<Readonly<import('../../src/index.js').CommandDefinition<unknown, unknown, import('../../src/index.js').CommandMessage, string | undefined>>>();
