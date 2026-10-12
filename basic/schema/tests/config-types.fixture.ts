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
const missingDefault: Config = { required: 'ok', enabled: false, nested: { name: 'n', tags: [] }, mode: 'auto' };
// @ts-expect-error Required nested properties are not optional.
const missingNested: Config = { ...config, nested: { tags: [] } };
// @ts-expect-error Literal alternatives remain narrow.
const wrongMode: Config = { ...config, mode: 'other' };
void [count, note, missingDefault, missingNested, wrongMode];

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
