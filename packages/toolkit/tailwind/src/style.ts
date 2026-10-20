import { compile } from "tailwindcss";
import { parse, type Declaration, type Rule } from "postcss";
import { defaultTheme } from "./default-theme.js";
import { escapeIdentifier, hasVariant } from "./identifier.js";
import { assertStaticProperty } from "./profile.js";
import { createVariableResolver } from "./variables.js";
import type {
  TailwindStyle,
  TailwindStyleOptions,
  TailwindStyleResolver,
} from "./types.js";

const MAX_CANDIDATES = 4096;
const MAX_CLASSES = 256;
const CACHE_SIZE = 256;

function themeCss(theme: TailwindStyleOptions["theme"]): string {
  if (theme === undefined) return "";
  if (theme === null || typeof theme !== "object" || Array.isArray(theme))
    throw new TypeError("Tailwind theme must be a token object.");
  const entries = Object.entries(theme);
  if (entries.length > 256)
    throw new RangeError("Tailwind theme exceeds 256 tokens.");
  return (
    "@theme inline {\n" +
    entries
      .map(([name, value]) => {
        if (!/^--[a-zA-Z0-9_-]+$/.test(name) || name.startsWith("--tw-"))
          throw new Error(`Invalid Tailwind theme token: ${name}`);
        if (
          typeof value !== "string" ||
          value.length > 4096 ||
          value.trim() === ""
        )
          throw new Error(`Invalid Tailwind theme value: ${name}`);
        // The configuration is data. It cannot introduce another declaration/directive.
        const ast = parse(`a { ${name}: ${value}; }`);
        const rule = ast.first;
        if (
          ast.nodes.length !== 1 ||
          rule?.type !== "rule" ||
          rule.nodes.length !== 1 ||
          rule.first?.type !== "decl" ||
          rule.first.prop !== name ||
          rule.first.important
        ) {
          throw new Error(
            `Tailwind theme token ${name} must contain one CSS value.`
          );
        }
        return `${name}: ${value};`;
      })
      .join("\n") +
    "\n}"
  );
}

/** Compile the official Tailwind theme once, then resolve static utility combinations synchronously. */
export async function createTailwindStyle(
  options: TailwindStyleOptions = {}
): Promise<TailwindStyleResolver> {
  const overrides = themeCss(options.theme);
  const theme =
    options.theme === undefined
      ? undefined
      : Object.freeze({ ...options.theme });
  const compiler = await compile(
    defaultTheme.replace("@theme default {", "@theme default inline {") +
      "\n" +
      overrides +
      "\n@tailwind utilities;",
    { polyfills: 0 }
  );
  const seen = new Set<string>();
  const cache = new Map<string, TailwindStyle>();

  return (classes: string): TailwindStyle => {
    if (typeof classes !== "string")
      throw new TypeError("Tailwind classes must be a string.");
    if (classes.length > 16384)
      throw new RangeError("Tailwind class input exceeds 16384 characters.");
    const candidates = [
      ...new Set(classes.trim().split(/\s+/).filter(Boolean)),
    ].sort();
    if (candidates.length > MAX_CLASSES)
      throw new RangeError(`Tailwind input exceeds ${MAX_CLASSES} classes.`);
    const key = candidates.join(" ");
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }
    for (const candidate of candidates) {
      if (hasVariant(candidate))
        throw new Error(`Unsupported Tailwind variant: ${candidate}`);
      if (candidate.startsWith("!") || candidate.endsWith("!"))
        throw new Error(`Unsupported Tailwind !important: ${candidate}`);
    }
    const newCandidates = candidates.filter(
      (candidate) => !seen.has(candidate)
    );
    if (seen.size + newCandidates.length > MAX_CANDIDATES) {
      throw new RangeError(
        `Tailwind factory exceeds ${MAX_CANDIDATES} distinct classes; create a new factory.`
      );
    }
    // The official compiler retains candidates, so failed compilations count toward the bound too.
    newCandidates.forEach((candidate) => seen.add(candidate));
    const ast = parse(compiler.build(candidates));
    const selectors = new Map(
      candidates.map((candidate) => [
        "." + escapeIdentifier(candidate),
        candidate,
      ])
    );
    const matched = new Set<string>();
    const declarations: { declaration: Declaration; candidate: string }[] = [];
    const variables = new Map<string, string>(Object.entries(theme ?? {}));

    ast.walkAtRules("property", (rule) => {
      const initial = rule.nodes?.find(
        (node) => node.type === "decl" && node.prop === "initial-value"
      );
      if (initial?.type === "decl")
        variables.set(rule.params.trim(), initial.value);
    });
    ast.walkRules((rule: Rule) => {
      if (rule.parent?.type === "root" && rule.selector === ":root, :host") {
        // Tailwind emits referenced theme variables with its own --theme() functions resolved.
        rule.nodes.forEach((node) => {
          if (node.type === "decl" && node.prop.startsWith("--"))
            variables.set(node.prop, node.value);
        });
        return;
      }
      const candidate = selectors.get(rule.selector);
      if (!candidate) return;
      if (
        rule.parent?.type !== "root" ||
        rule.nodes.some(
          (node) => node.type !== "decl" && node.type !== "comment"
        )
      ) {
        throw new Error(
          `Unsupported Tailwind selector or conditional rule: ${candidate}`
        );
      }
      matched.add(candidate);
      for (const node of rule.nodes) {
        if (node.type !== "decl") continue;
        if (node.important)
          throw new Error(`Unsupported Tailwind !important: ${candidate}`);
        if (node.prop.startsWith("--")) variables.set(node.prop, node.value);
        else declarations.push({ declaration: node, candidate });
      }
    });
    for (const candidate of candidates) {
      if (!matched.has(candidate))
        throw new Error(
          `Unknown or unsupported Tailwind selector utility: ${candidate}`
        );
    }
    const resolve = createVariableResolver(variables);
    const result: Record<string, string> = {};
    for (const { declaration, candidate } of declarations) {
      const value = resolve(declaration.value);
      assertStaticProperty(declaration.prop, value, candidate);
      const property = declaration.prop.replace(
        /-([a-z])/g,
        (_, char: string) => char.toUpperCase()
      );
      // Reinsert overwritten properties to preserve shorthand/longhand CSS order.
      delete result[property];
      result[property] = value;
    }
    if (candidates.length > 0 && declarations.length === 0) {
      throw new Error(
        `Tailwind classes only set internal variables; include the matching visual utility: ${key}`
      );
    }
    const style = Object.freeze(result);
    cache.set(key, style);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
    return style;
  };
}
