/**
 * Typed partial fake: the one deliberate cast lives here so tests do not need `as never`.
 * Only the members you list exist; touching any other member of a real `T` is your test's bug.
 * Prefer a real or kit-provided fake when one exists; use this for narrow collaborators and payloads.
 */
export function fakeOf<T extends object>(partial: Partial<T>): T {
  return partial as T;
}
