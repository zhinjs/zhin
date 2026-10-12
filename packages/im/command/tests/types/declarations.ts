import { defineCommand } from '../../src/index.js';

defineCommand({
  params: {
    count: { type: 'integer', min: 1 },
    name: { type: 'string', optional: true },
    tags: { type: 'string', rest: true, optional: true },
  },
  options: {
    size: { type: 'integer', default: 300 },
    loud: { type: 'boolean' },
  },
  execute({ params, options, input }) {
    const count: number = params.count;
    const name: string | undefined = params.name;
    const tags: readonly string[] = params.tags;
    const size: number = options.size;
    const loud: boolean | undefined = options.loud;
    // @ts-expect-error inferred integer is not a string
    const wrong: string = params.count;
    // @ts-expect-error undeclared parameter is not available
    const missingParam = params.missing;
    // @ts-expect-error undeclared option is not available
    const missingOption = options.missing;
    // @ts-expect-error optional input is not guaranteed in Host calls
    input.$reply('hello');
    return [count, name, tags, size, loud, wrong, missingParam, missingOption];
  },
});
