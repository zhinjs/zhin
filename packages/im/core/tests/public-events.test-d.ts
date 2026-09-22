import { expectTypeOf } from 'vitest';
import type { Notice, Request, SystemEvent } from 'zhin.js';
import type { Notice as CoreNotice, Request as CoreRequest, SystemEvent as CoreSystem, RuntimeSystemEvent, SystemEventBase } from '@zhin.js/core';
import type { Notice as RuntimeNotice, Request as RuntimeRequest, SystemEvent as RuntimeSystem } from '@zhin.js/core/runtime';
import type { Notice as FacadeNotice, Request as FacadeRequest, SystemEvent as FacadeSystem } from 'zhin.js/core/runtime';
import { defineHandler } from 'zhin.js/handler';

// Included in tsconfig.typecheck.json so these assertions run in the CI type gate.
expectTypeOf<Notice>().toEqualTypeOf<CoreNotice>();
expectTypeOf<Notice>().toEqualTypeOf<RuntimeNotice>();
expectTypeOf<Notice>().toEqualTypeOf<FacadeNotice>();
expectTypeOf<Request>().toEqualTypeOf<CoreRequest>();
expectTypeOf<Request>().toEqualTypeOf<RuntimeRequest>();
expectTypeOf<Request>().toEqualTypeOf<FacadeRequest>();
expectTypeOf<RuntimeSystemEvent>().toMatchTypeOf<SystemEventBase>();
expectTypeOf<SystemEvent>().toEqualTypeOf<CoreSystem>();
expectTypeOf<SystemEvent>().toEqualTypeOf<RuntimeSystem>();
expectTypeOf<SystemEvent>().toEqualTypeOf<FacadeSystem>();
expectTypeOf<Extract<keyof SystemEvent, 'conversation' | 'actor' | 'target' | '$approve'>>().toBeNever();
expectTypeOf<Extract<keyof Request, 'reaction' | 'durationSeconds'>>().toBeNever();
expectTypeOf<Extract<keyof Notice, '$id' | '$scene_id' | '$sub_type'>>().toBeNever();

defineHandler({
  event: 'notice.receive',
  handle({ payload }) {
    expectTypeOf(payload).toEqualTypeOf<Notice>();
    expectTypeOf(payload.conversation).toEqualTypeOf<Notice['conversation']>();
  },
});
defineHandler({
  event: 'request.receive',
  handle({ payload }) {
    expectTypeOf(payload).toEqualTypeOf<Request>();
    expectTypeOf(payload.actor.id).toBeString();
    expectTypeOf(payload.$approve).returns.toEqualTypeOf<Promise<void>>();
  },
});
defineHandler({
  event: 'system.receive',
  handle({ payload }) {
    expectTypeOf(payload).toEqualTypeOf<SystemEvent>();
    expectTypeOf(payload.type).toEqualTypeOf<'system'>();
  },
});
