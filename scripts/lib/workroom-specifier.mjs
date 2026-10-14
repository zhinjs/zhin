/**
 * True iff `spec` is the `@zhin.js/workroom` package root or one of its subpaths.
 * `@zhin.js/workroom-foo` / `@zhin.js/workroomx` are different packages and do not match.
 */
export function isWorkroomPackageSpecifier(spec) {
  return spec === '@zhin.js/workroom' || spec.startsWith('@zhin.js/workroom/');
}

/** Directory names that belong to the Workroom package (never to Agent). */
const WORKROOM_DIRECTORY_SEGMENT = /(?:^|\/)(?:workroom|workroom-runtime|portfolio|data-governance)(?:\/|$)/u;

/**
 * True iff an Agent source file must not reference `spec`: the Workroom package
 * (root or any subpath) or a relative path into a Workroom-owned directory.
 */
export function isAgentForbiddenWorkroomReference(spec) {
  if (isWorkroomPackageSpecifier(spec)) return true;
  return spec.startsWith('.') && WORKROOM_DIRECTORY_SEGMENT.test(spec);
}

/**
 * True iff a Workroom domain file (workroom/, portfolio/, data-governance/) must not
 * import `spec`: any bare specifier other than the IM contract package and node: builtins.
 */
export function isForbiddenDomainSpecifier(spec) {
  if (spec.startsWith('.') || spec.startsWith('/')) return false;
  if (spec.startsWith('node:')) return false;
  return spec !== '@zhin.js/im-contract' && !spec.startsWith('@zhin.js/im-contract/');
}
