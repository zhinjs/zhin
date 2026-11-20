/**
 * @internal zhinjs/zhin#1250: the language of one outbound render. `SendRequest.locale` (set by
 * `$reply` from `message.locale`) reaches the template command environment through this
 * symbol-keyed slot, so `${bot.menu}` / `${command.*}` are written in the same language as the
 * inbound `message.commandMenu` / `formatCommand`. Not exported from the package: the public
 * `OutboundRenderContext` shape is unchanged.
 */
import type { Locale } from '@zhin.js/plugin-runtime';

const renderLocale: unique symbol = Symbol('zhin.outbound-render-locale');

type WithRenderLocale = { readonly [renderLocale]?: Locale };

/** A copy of `context` that carries `locale` for the render (unchanged when `locale` is absent). */
export function withRenderLocale<T extends object>(context: T, locale: Locale | undefined): T {
  if (locale === undefined) return context;
  return Object.assign({}, context, { [renderLocale]: locale } satisfies WithRenderLocale);
}

/** The locale attached with {@link withRenderLocale}, if any. */
export function renderLocaleOf(context: object): Locale | undefined {
  return (context as WithRenderLocale)[renderLocale];
}
