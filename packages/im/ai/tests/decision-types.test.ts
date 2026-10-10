import { expectTypeOf } from 'vitest';
import type { DecisionResult, NoulAnswer } from '../src/decision/index.js';

it('preserves question keys and choice alternatives without inventing noul confidence', () => {
  type Questions = {
    route: { type: 'choice'; criteria: { agent: null; none: null } };
    relevance: { type: 'score'; criteria: readonly [null, null] };
    allowed: { type: 'noul' };
  };
  type Result = DecisionResult<Questions>;
  expectTypeOf<Result['answers']['route']['choice']>().toEqualTypeOf<'agent' | 'none'>();
  expectTypeOf<Result['answers']['relevance']['score']>().toEqualTypeOf<number>();
  expectTypeOf<Result['answers']['allowed']>().toEqualTypeOf<NoulAnswer>();
  expectTypeOf<keyof Result['answers']>().toEqualTypeOf<'route' | 'relevance' | 'allowed'>();
});
