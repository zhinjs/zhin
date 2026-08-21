import type { CapabilityContext } from '@zhin.js/feature-kit';

/** Slim prompt surface (mirrors CommandPrompt; implemented by ImRuntime). */
export interface HandlerPrompt {
  text(tips: string, options?: HandlerPromptOptions): Promise<string>;
  number(tips: string, options?: HandlerPromptOptions): Promise<number>;
  confirm(tips: string, options?: HandlerPromptOptions & { condition?: string }): Promise<boolean>;
  list(tips: string, options?: HandlerPromptOptions & {
    separator?: string;
    type?: 'text' | 'number' | 'boolean';
  }): Promise<unknown[]>;
  pick<V = unknown>(tips: string, options: HandlerPromptOptions & {
    options: ReadonlyArray<{ label: string; value: V }>;
    multiple?: boolean;
    separator?: string;
  }): Promise<V | V[]>;
}

export interface HandlerPromptOptions {
  timeout?: number;
  timeoutText?: string;
  default?: string | number | boolean | unknown[];
  signal?: AbortSignal;
}

/** Handler context contains only generation-safe capabilities and prompt ports. */
export interface HandlerContext<TConfig = unknown> extends CapabilityContext<TConfig> {
  readonly prompt?: HandlerPrompt;
}

export interface HandlerDispatchOptions {
  /** Build interactive prompt for this dispatch (message or side-event). */
  resolvePrompt?: (event: string, args: readonly unknown[]) => HandlerPrompt | undefined;
}
