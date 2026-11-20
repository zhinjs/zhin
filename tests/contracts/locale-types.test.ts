import { describe, expectTypeOf, it } from 'vitest';
import type { ConsoleLocale as AuthoringLocale } from '../../packages/console/plugin-contract/src/page.js';
import type { ConsoleLocale as WireLocale } from '../../packages/console/protocol/src/locale.js';
import { SUPPORTED_LOCALES, type Locale } from '../../packages/im/plugin-runtime/src/i18n.js';

describe('display language types (#1250 batch 77)', () => {
  it('keeps the dependency-free Console declarations equal to the runtime Locale', () => {
    expectTypeOf<WireLocale>().toEqualTypeOf<Locale>();
    expectTypeOf<AuthoringLocale>().toEqualTypeOf<Locale>();
    expectTypeOf<(typeof SUPPORTED_LOCALES)[number]>().toEqualTypeOf<Locale>();
  });
});
