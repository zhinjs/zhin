import { createVariableResolver } from "../src/variables.js";

describe("element-local CSS variables", () => {
  it("handles fallback lists, empty fallbacks and quoted function text without corrupting tokens", () => {
    const resolve = createVariableResolver(
      new Map([
        ["--color", "oklch(62.3% 0.214 259.815)"],
        ["--invalid", "var(--missing)"],
        ["--initial", "initial"],
      ])
    );
    expect(resolve("var(--invalid, rgb(1, 2, 3))")).toBe("rgb(1, 2, 3)");
    expect(resolve("var(--initial, var(--color))")).toBe(
      "oklch(62.3% 0.214 259.815)"
    );
    expect(resolve("var(--missing,) 0 0 #fff")).toBe(" 0 0 #fff");
    expect(resolve('"var(--missing) url(example)"')).toBe(
      '"var(--missing) url(example)"'
    );
  });

  it("rejects missing variables, dependency cycles and unsafe functions reached through aliases", () => {
    const resolve = createVariableResolver(
      new Map([
        ["--a", "var(--b)"],
        ["--b", "var(--a, red)"],
        ["--unsafe", "url(https://example.com/background.png)"],
      ])
    );
    expect(() => resolve("var(--missing)")).toThrow("Unresolved");
    expect(() => resolve("var(--a, green)")).toThrow("cycle");
    expect(() => resolve("var(--unsafe)")).toThrow("Unsupported");
    expect(() => resolve("u\\72l(https://example.com/image.png)")).toThrow(
      "Unsupported"
    );
    expect(() => resolve("var(--missing")).toThrow("Unclosed");
  });

  it("bounds long alias chains and nested function values rather than partially rendering them", () => {
    const aliases = new Map<string, string>();
    for (let index = 0; index < 70; index++)
      aliases.set(`--n${index}`, `var(--n${index + 1})`);
    aliases.set("--n70", "red");
    expect(() => createVariableResolver(aliases)("var(--n0)")).toThrow(
      /depth exceeds 64/
    );
    expect(() =>
      createVariableResolver(new Map())(
        "calc(".repeat(66) + "1" + ")".repeat(66)
      )
    ).toThrow(/depth exceeds 64/);
  });
});
