import { Schema } from '../src/index.js';
import { definePlugin } from '@zhin.js/plugin-runtime';

const schema = Schema.object({
  required: Schema.string().required(),
  count: Schema.number().default(0),
  enabled: Schema.boolean().default(false),
  note: Schema.string(),
  nested: Schema.object({ name: Schema.string().required(), tags: Schema.list(Schema.string()).default([]) }).required(),
  mode: Schema.union([Schema.const('auto'), Schema.const('manual')]).default('auto'),
  kind: Schema.const('subscription'),
});
type Config = Schema.Output<typeof schema>;
const config: Config = { required: 'ok', count: 0, enabled: false, nested: { name: 'n', tags: [] }, mode: 'auto', kind: 'subscription' };
const count: number = config.count;
const note: string | undefined = config.note;
// @ts-expect-error Defaulted properties are always provided by Runtime.
const missingDefault: Config = { required: 'ok', enabled: false, nested: { name: 'n', tags: [] }, mode: 'auto', kind: 'subscription' };
// @ts-expect-error Required nested properties are not optional.
const missingNested: Config = { ...config, nested: { tags: [] } };
// @ts-expect-error Literal alternatives remain narrow.
const wrongMode: Config = { ...config, mode: 'other' };
void [count, note, missingDefault, missingNested, wrongMode];

const parsed = schema.safeParse({ required: 'ok', nested: { name: 'n' } });
if (parsed.success && parsed.data) {
  const optionalDefault: number | undefined = parsed.data.count;
  const requiredInput: string = parsed.data.required;
  const nestedDefault: string[] | undefined = parsed.data.nested.tags;
  // @ts-expect-error validate-only safeParse does not fill defaults.
  const unfilledDefault: number = parsed.data.count;
  void [optionalDefault, requiredInput, nestedDefault, unfilledDefault];
}
const nestedParsed = Schema.list(Schema.object({ count: Schema.number().default(1) })).safeParse([{}]);
if (nestedParsed.success && nestedParsed.data) {
  // @ts-expect-error List nesting must also preserve validate-only input optionality.
  const count: number = nestedParsed.data[0]!.count;
  void count;
}

definePlugin({
  name: 'typed-configuration',
  config: schema,
  setup({ config }) {
    const current: Config = config.get();
    const interval: number = current.count;
    // @ts-expect-error Defaults are inferred as their declared primitive, not unknown.
    const wrong: string = current.count;
    void [interval, wrong];
  },
});
