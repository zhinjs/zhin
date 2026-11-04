import type { TelegramAdapter } from './adapter.js';
import type { TelegramUpdate } from './protocol.js';

export type TelegramClientEventMap = Record<string, TelegramUpdate>;

declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly telegram: TelegramAdapter; }
}
