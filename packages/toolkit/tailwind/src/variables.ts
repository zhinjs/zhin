import valueParser from "postcss-value-parser";

class MissingVariable extends Error {}

const staticFunctions = new Set(
  `
  calc min max clamp round mod rem sin cos tan asin acos atan atan2 pow sqrt hypot log exp abs sign
  rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix light-dark
  linear-gradient radial-gradient conic-gradient repeating-linear-gradient
  repeating-radial-gradient repeating-conic-gradient repeat minmax fit-content
`
    .trim()
    .split(/\s+/)
);

/** Resolve one element's custom properties; do not depend on a DOM/global stylesheet. */
export function createVariableResolver(
  properties: ReadonlyMap<string, string>
): (value: string) => string {
  const cache = new Map<string, string | undefined>();

  function property(
    name: string,
    ancestors: readonly string[]
  ): string | undefined {
    if (ancestors.includes(name))
      throw new Error(
        `Tailwind CSS variable cycle: ${[...ancestors, name].join(" -> ")}`
      );
    if (cache.has(name)) return cache.get(name);
    const source = properties.get(name);
    if (
      source === undefined ||
      /^(initial|inherit|unset|revert|revert-layer)$/i.test(source.trim())
    )
      return undefined;
    let result: string | undefined;
    try {
      result = resolve(source, [...ancestors, name]);
    } catch (error) {
      // An invalid custom property triggers the consumer's var() fallback.
      if (!(error instanceof MissingVariable)) throw error;
    }
    cache.set(name, result);
    return result;
  }

  function resolve(value: string, ancestors: readonly string[]): string {
    if (ancestors.length > 64)
      throw new RangeError("Tailwind CSS variable depth exceeds 64.");
    const parsed = valueParser(value);
    function stringify(nodes: valueParser.Node[], depth: number): string {
      if (depth > 64)
        throw new RangeError("Tailwind CSS value depth exceeds 64.");
      return nodes
        .map((node) => {
          if ("unclosed" in node && node.unclosed)
            throw new Error("Unclosed Tailwind CSS value.");
          if (node.type !== "function") return valueParser.stringify(node);
          const name = node.value.toLowerCase();
          if (
            name === "url" ||
            name === "image-set" ||
            name === "-webkit-image-set" ||
            name === "attr" ||
            name === "env"
          ) {
            throw new Error(
              `Unsupported Tailwind CSS function ${node.value}(): external resources or environment.`
            );
          }
          if (name !== "var") {
            if (!staticFunctions.has(name))
              throw new Error(
                `Unsupported Tailwind CSS function ${node.value}().`
              );
            return `${node.value}(${node.before}${stringify(
              node.nodes,
              depth + 1
            )}${node.after})`;
          }
          const comma = node.nodes.findIndex(
            (child) => child.type === "div" && child.value === ","
          );
          const variable = valueParser
            .stringify(comma < 0 ? node.nodes : node.nodes.slice(0, comma))
            .trim();
          if (!/^--[\w-]+$/.test(variable))
            throw new Error(`Invalid Tailwind CSS variable: ${variable}`);
          const result = property(variable, ancestors);
          if (result !== undefined) return result;
          if (comma >= 0)
            return stringify(node.nodes.slice(comma + 1), depth + 1);
          throw new MissingVariable(
            `Unresolved Tailwind CSS variable: ${variable}`
          );
        })
        .join("");
    }
    return stringify(parsed.nodes, 0);
  }

  return (value) => resolve(value, []);
}
