/** #857: a typed plugin config in convention tool files without spelling out every type argument. */
import { expectTypeOf } from 'vitest';
import { z } from 'zod';
import { Schema } from '../../../../../basic/schema/src/index.js';
import type { PluginSetupContext } from '@zhin.js/plugin-runtime';
import { defineAgentTool } from '../../src/index.js';

interface Config { readonly apiKey: string }

// withConfig, executable schema: config typed, input and result inferred.
const inferred = defineAgentTool.withConfig<Config>()({
  description: 'Weather',
  inputSchema: z.object({ city: z.string(), days: z.number().optional() }),
  execute(input, { config }) {
    expectTypeOf(config).toEqualTypeOf<Readonly<Config>>();
    expectTypeOf(input).toEqualTypeOf<{ city: string; days?: number | undefined }>();
    // @ts-expect-error config keys are checked
    void config.missing;
    return { city: input.city };
  },
});
expectTypeOf(inferred.execute).returns.toEqualTypeOf<{ city: string } | Promise<{ city: string }>>();

// withConfig, JSON Schema: give the input type on the second call.
const explicit = defineAgentTool.withConfig<Config>()<{ city: string }>({
  description: 'Weather',
  inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  execute({ city }, { config }) {
    expectTypeOf(city).toEqualTypeOf<string>();
    expectTypeOf(config.apiKey).toEqualTypeOf<string>();
  },
});

declare const setup: PluginSetupContext<Config>;
setup.addTool('weather', explicit);
declare const other: PluginSetupContext<{ different: string }>;
// @ts-expect-error a tool typed for another config is rejected
other.addTool('weather', explicit);

// Existing forms are unchanged.
defineAgentTool<{ city: string }>({
  description: 'Weather',
  execute(input, { config }) {
    expectTypeOf(input).toEqualTypeOf<{ city: string }>();
    expectTypeOf(config).toEqualTypeOf<Readonly<unknown>>();
  },
});
defineAgentTool<{ city: string }, string, Config>({
  description: 'Weather',
  execute(input, { config }) {
    expectTypeOf(config).toEqualTypeOf<Readonly<Config>>();
    return input.city;
  },
});

// @zhin.js/schema Schema.object() infers args with defaulted fields as required output properties.
const zhinSchemaTool = defineAgentTool({
  name: 'test',
  description: 'test',
  inputSchema: Schema.object({
    query: Schema.string().required(),
    limit: Schema.number().default(5),
  }),
  execute(args) {
    expectTypeOf(args.query).toEqualTypeOf<string>();
    expectTypeOf(args.limit).toEqualTypeOf<number>();
    return `${args.query}:${args.limit}`;
  },
});
expectTypeOf(zhinSchemaTool.execute).returns.toEqualTypeOf<string | Promise<string>>();
