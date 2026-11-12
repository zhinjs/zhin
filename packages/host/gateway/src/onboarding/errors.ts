export type OnboardingErrorCode = 'invalid_input' | 'forbidden' | 'conflict' | 'unavailable';

const STATUS: Readonly<Record<OnboardingErrorCode, number>> = {
  invalid_input: 400,
  forbidden: 403,
  conflict: 409,
  unavailable: 503,
};

/** Transport-independent onboarding error; adapters map `status` to HTTP / RPC errors. */
export class OnboardingError extends Error {
  readonly status: number;
  constructor(readonly code: OnboardingErrorCode, message: string) {
    super(message);
    this.name = 'OnboardingError';
    this.status = STATUS[code];
  }
}
