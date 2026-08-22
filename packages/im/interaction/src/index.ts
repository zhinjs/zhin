/** Structured copy shown to a user for one interaction step. */
export interface UserInteractionContent {
  readonly title: string;
  readonly description?: string;
  readonly tip?: string;
}

/** Lifecycle and invalid-input behaviour shared by every interaction type. */
export interface UserInteractionControl {
  readonly timeout?: number;
  readonly timeoutText?: string;
  readonly invalidText?: string;
  readonly signal?: AbortSignal;
}

interface UserInteractionRequestBase extends UserInteractionContent, UserInteractionControl {}

export interface UserInteractionTextRequest extends UserInteractionRequestBase {
  readonly type: 'text';
  readonly default?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: RegExp;
}

export interface UserInteractionNumberRequest extends UserInteractionRequestBase {
  readonly type: 'number';
  readonly default?: number;
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
}

export interface UserInteractionConfirmRequest extends UserInteractionRequestBase {
  readonly type: 'confirm';
  readonly default?: boolean;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
}

export interface UserInteractionOption<V = unknown> {
  readonly label: string;
  readonly value: V;
  readonly description?: string;
}

export interface UserInteractionSelectRequest<V = unknown> extends UserInteractionRequestBase {
  readonly type: 'select';
  readonly options: readonly UserInteractionOption<V>[];
  readonly default?: V;
}

export interface UserInteractionMultiSelectRequest<V = unknown> extends UserInteractionRequestBase {
  readonly type: 'multiselect';
  readonly options: readonly UserInteractionOption<V>[];
  readonly default?: readonly V[];
  readonly separator?: string;
  readonly minSelections?: number;
  readonly maxSelections?: number;
}

export type UserInteractionListValueType = 'text' | 'number' | 'boolean';
export type UserInteractionListValue<T extends UserInteractionListValueType> =
  T extends 'number' ? number : T extends 'boolean' ? boolean : string;

export interface UserInteractionListRequest<
  T extends UserInteractionListValueType = 'text',
> extends UserInteractionRequestBase {
  readonly type: 'list';
  readonly valueType?: T;
  readonly separator?: string;
  readonly default?: readonly UserInteractionListValue<T>[];
  readonly minItems?: number;
  readonly maxItems?: number;
}

export type UserInteractionRequest =
  | UserInteractionTextRequest
  | UserInteractionNumberRequest
  | UserInteractionConfirmRequest
  | UserInteractionSelectRequest
  | UserInteractionMultiSelectRequest
  | UserInteractionListRequest<'text'>
  | UserInteractionListRequest<'number'>
  | UserInteractionListRequest<'boolean'>;

export type UserInteractionValue<R> =
  R extends UserInteractionTextRequest ? string
    : R extends UserInteractionNumberRequest ? number
      : R extends UserInteractionConfirmRequest ? boolean
        : R extends { readonly type: 'select'; readonly options: readonly UserInteractionOption<infer V>[] } ? V
          : R extends { readonly type: 'multiselect'; readonly options: readonly UserInteractionOption<infer V>[] } ? readonly V[]
            : R extends UserInteractionListRequest<UserInteractionListValueType>
              ? R extends { readonly valueType: 'number' } ? readonly number[]
                : R extends { readonly valueType: 'boolean' } ? readonly boolean[]
                  : readonly string[]
              : never;

export type UserInteractionStep = UserInteractionRequest & { readonly id: string };

export interface UserInteractionSequence<Steps extends readonly UserInteractionStep[]>
  extends UserInteractionContent, UserInteractionControl {
  readonly steps: Steps;
}

export type UserInteractionSequenceResult<Steps extends readonly UserInteractionStep[]> = Readonly<{
  [Step in Steps[number] as Step['id']]: UserInteractionValue<Step>;
}>;

/**
 * Resumable user-input module. A call settles only after a valid answer,
 * timeout/default, abort, or supersession.
 */
export interface UserInteraction {
  ask<const Request extends UserInteractionRequest>(
    request: Request,
  ): Promise<UserInteractionValue<Request>>;

  sequence<const Steps extends readonly UserInteractionStep[]>(
    sequence: UserInteractionSequence<Steps>,
  ): Promise<UserInteractionSequenceResult<Steps>>;
}

export type UserInteractionFactory = (source: unknown) => UserInteraction | undefined;
