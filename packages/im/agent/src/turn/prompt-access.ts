export class PromptAccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptAccessDeniedError';
  }
}
