type TypeScriptApi = typeof import('typescript');

let loaded: TypeScriptApi | undefined;

/**
 * `typescript` is an optional peer: only the source migrators need it, so it is
 * loaded on first use instead of when the package entry is imported.
 */
export async function loadTypeScript(): Promise<TypeScriptApi> {
  if (loaded) return loaded;
  try {
    const module = await import('typescript');
    loaded = module.default ?? module;
  } catch (error) {
    throw new Error(
      'zhin runtime migrate needs the optional peer dependency "typescript" (>=5.8 <7); install it in this project',
      { cause: error },
    );
  }
  return loaded;
}
