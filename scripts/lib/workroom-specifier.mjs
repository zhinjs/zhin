/**
 * True iff `spec` is the `@zhin.js/workroom` package root or one of its subpaths.
 * `@zhin.js/workroom-foo` / `@zhin.js/workroomx` are different packages and do not match.
 */
export function isWorkroomPackageSpecifier(spec) {
  return spec === '@zhin.js/workroom' || spec.startsWith('@zhin.js/workroom/');
}
