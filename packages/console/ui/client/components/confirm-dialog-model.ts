/** Message shown inside ConfirmDialog when onConfirm rejects; null means "use the generic fallback". */
export function confirmErrorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message.trim() || null
  if (typeof error === 'string') return error.trim() || null
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message.trim() || null
  }
  return null
}

/** Typed confirmation for irreversible actions: exact, case-sensitive match; surrounding whitespace is ignored. */
export function confirmTextMatches(typed: string, expected: string | null | undefined): boolean {
  if (expected == null || expected === '') return true
  return typeof typed === 'string' && typed.trim() === expected
}

export function canSubmitConfirm(state: { loading: boolean; typed: string; confirmText?: string | null }): boolean {
  return !state.loading && confirmTextMatches(state.typed, state.confirmText)
}
