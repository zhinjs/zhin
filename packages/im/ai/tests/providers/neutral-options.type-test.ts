import { expectTypeOf } from 'vitest';
import type { JSONValue } from 'ai';
import type { Model } from '../../src/llm/types/model.js';

type ProtocolValue = NonNullable<Model['providerOptions']>[string][string];
// Type-only proof against the installed SDK; normal Inference authors do not import it.
expectTypeOf<ProtocolValue>().toEqualTypeOf<JSONValue>();
const omittedObjectField: ProtocolValue = { omitted: undefined, nested: [{ value: null }, true, 1, 'text'] };
expectTypeOf(omittedObjectField).toMatchTypeOf<JSONValue>();
