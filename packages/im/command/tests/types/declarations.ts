import { defineCommand, type CommandParameterValue } from '../../src/index.js';

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

const possibleDefault: number | undefined = Math.random() > 0.5 ? 1 : undefined;
defineCommand({
  params: { note: { type: 'string', optional: true, default: undefined } },
  options: { count: { type: 'integer', default: undefined }, size: { type: 'integer', default: possibleDefault } },
  execute({ params, options }) {
    const omittedParams: typeof params = {};
    const omittedOptions: typeof options = {};
    // @ts-expect-error an undefined default does not guarantee a value
    const guaranteedCount: number = options.count;
    // @ts-expect-error a possibly undefined default does not guarantee a value
    const guaranteedSize: number = options.size;
    // @ts-expect-error optional params may be omitted when default is undefined
    const guaranteedNote: string = params.note;
    return [omittedParams, omittedOptions, guaranteedCount, guaranteedSize, guaranteedNote];
  },
});

defineCommand({
  execute({ params }) {
    const dynamic: CommandParameterValue = params.path;
    // @ts-expect-error absent declarations retain the broad record, not a string-only inference
    const stringOnly: string = params.path;
    return [dynamic, stringOnly];
  },
});

// Keep the registered-platform Session regressions in the existing project type gate.
import './session-registry.js';
import './session.js';

// One request keeps invocation inputs and its operation generation together.
import type { CommandDispatchRequest, CommandIndex } from '../../src/index.js';
declare const commandIndex: CommandIndex;
const dispatchRequest: CommandDispatchRequest = { input: 'help', commandPrefix: '/' };
void commandIndex.dispatch(dispatchRequest);
// @ts-expect-error positional command dispatch no longer represents an operation request
void commandIndex.dispatch('help', undefined);
