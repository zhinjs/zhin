import { jsx, renderToHtml } from "@zhin.js/jsx";
import { createTailwindStyle } from "../src/index.js";

describe("official Tailwind static inline styles", () => {
  it("compiles layout, logical spacing, fonts, colors, radii and browser grid", async () => {
    const tw = await createTailwindStyle();
    const style = tw(
      "grid grid-cols-2 gap-4 p-4 px-6 text-xl font-bold font-sans bg-blue-500 text-white rounded-lg"
    );
    expect(style).toMatchObject({
      display: "grid",
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gap: "calc(0.25rem * 4)",
      padding: "calc(0.25rem * 4)",
      paddingInline: "calc(0.25rem * 6)",
      fontSize: "1.25rem",
      fontWeight: "700",
      lineHeight: "calc(1.75 / 1.25)",
      backgroundColor: "oklch(62.3% 0.214 259.815)",
      color: "#fff",
      borderRadius: "0.5rem",
    });
    expect(style.fontFamily).toContain("sans-serif");
    expect(
      Object.keys(style).some((property) => property.startsWith("--"))
    ).toBe(false);
    expect(Object.values(style).some((value) => value.includes("var("))).toBe(
      false
    );
    const html = await renderToHtml(jsx("div", { style, children: "Ready" }));
    expect(html).toContain("display: grid;");
    expect(html).toContain("padding-inline: calc(0.25rem * 6)");
    expect(html).toContain("Ready");
  });

  it("uses the official cascade regardless of argument order and preserves shorthand order", async () => {
    const tw = await createTailwindStyle();
    expect(tw("p-4 p-2 px-6")).toEqual(tw("px-6 p-2 p-4"));
    expect(tw("p-4 p-2 px-6").padding).toBe("calc(0.25rem * 4)");
    const keys = Object.keys(tw("p-4 px-6"));
    expect(keys.indexOf("padding")).toBeLessThan(keys.indexOf("paddingInline"));
    expect(tw("text-xl leading-tight")).toMatchObject({ lineHeight: "1.25" });
    expect(tw("leading-tight text-xl")).toEqual(tw("text-xl leading-tight"));
  });

  it("resolves registered defaults, shadows, rings, transforms and modern color mixing", async () => {
    const tw = await createTailwindStyle();
    expect(tw("border")).toEqual({ borderStyle: "solid", borderWidth: "1px" });
    const style = tw(
      "shadow-md ring-2 ring-blue-500 translate-x-2 scale-90 bg-blue-500/50"
    );
    expect(style.translate).toBe("calc(0.25rem * 2) 0");
    expect(style.scale).toBe("90% 90%");
    expect(style.backgroundColor).toContain("color-mix(in oklab,");
    expect(style.boxShadow).toContain("oklch(62.3% 0.214 259.815)");
    expect(style.boxShadow).not.toContain("var(");
  });

  it("supports real arbitrary static values and escapes class selectors accurately", async () => {
    const tw = await createTailwindStyle();
    expect(tw("w-1/2 w-[240px] [padding:12px] text-[#123456]")).toMatchObject({
      width: "240px",
      padding: "12px",
      color: "#123456",
    });
    expect(tw("w-1/2")).toEqual({ width: "calc(1 / 2 * 100%)" });
    expect(tw("bg-[linear-gradient(red,blue)]")).toEqual({
      backgroundImage: "linear-gradient(red,blue)",
    });
  });

  it.each(["inherit", "unset", "revert", "revert-layer"])(
    "rejects cascade-dependent values through the public resolver: %s",
    async (keyword) => {
      const tw = await createTailwindStyle();
      expect(() => tw(`[color:${keyword}]`)).toThrow(
        /depends on an external stylesheet/
      );
      expect(tw("text-red-500").color).toContain("oklch(");
    }
  );

  it("isolates themes and snapshots their values before returning the resolver", async () => {
    const tokens = {
      "--color-brand": "#123456",
      "--spacing": "0.5rem",
      "--color-alias": "var(--color-brand)",
    };
    const [first, second] = await Promise.all([
      createTailwindStyle({ theme: tokens }),
      createTailwindStyle({ theme: { "--color-brand": "#abcdef" } }),
    ]);
    tokens["--color-brand"] = "red";
    expect(first("bg-alias p-2")).toEqual({
      backgroundColor: "#123456",
      padding: "calc(0.5rem * 2)",
    });
    expect(second("bg-brand").backgroundColor).toBe("#abcdef");
    expect(first("bg-brand").backgroundColor).toBe("#123456");
  });

  it("resolves nested/empty fallbacks and invalid variable references without reading DOM variables", async () => {
    const tw = await createTailwindStyle({
      theme: { "--color-invalid": "var(--not-set)" },
    });
    expect(tw("[color:var(--missing,var(--color-blue-500))]").color).toContain(
      "oklch("
    );
    expect(tw("[color:var(--color-invalid,red)]").color).toBe("red");
    expect(tw('[font-family:var(--absent,"A,B")]').fontFamily).toBe('"A,B"');
    expect(() => tw("[color:var(--external)]")).toThrow(
      "Unresolved Tailwind CSS variable: --external"
    );
    expect(tw("ring-2").boxShadow).not.toContain("var(");
  });

  it.each([
    "hover:bg-red-500",
    "sm:p-4",
    "dark:text-white",
    "[&>div]:p-4",
    "group-hover:flex",
    "!p-4",
    "p-4!",
    "space-x-4",
    "divide-x-2",
    "container",
    "animate-spin",
    "transition-all",
    "fixed",
    "sticky",
    "blur-sm",
    "cursor-pointer",
    "pointer-events-none",
    "bg-fixed",
    "bg-[url(https://example.com/a.png)]",
    "bg-[u\\72l(https://example.com/a.png)]",
    "[width:env(safe-area-inset-top)]",
    "[color:attr(data-color)]",
    "not-a-real-tailwind-class",
  ])(
    "rejects unsupported or unknown utilities instead of silently losing %s",
    async (classes) => {
      const tw = await createTailwindStyle();
      expect(() => tw(classes)).toThrow(/Unsupported|unsupported|Unknown/);
    }
  );

  it("does not leak previously compiled utilities or defaults into later combinations", async () => {
    const tw = await createTailwindStyle();
    tw("border-dashed leading-loose ring-4 shadow-xl p-8");
    expect(tw("border")).toEqual({ borderStyle: "solid", borderWidth: "1px" });
    expect(tw("p-2")).toEqual({ padding: "calc(0.25rem * 2)" });
    expect(tw("")).toEqual({});
  });

  it("returns immutable bounded cached objects and restores evicted combinations", async () => {
    const tw = await createTailwindStyle();
    const first = tw("p-4 flex");
    expect(Object.isFrozen(first)).toBe(true);
    expect(tw("flex p-4 p-4")).toBe(first);
    for (let index = 0; index < 257; index++) tw(`w-[${index}px]`);
    const renewed = tw("p-4 flex");
    expect(renewed).toEqual(first);
    expect(renewed).not.toBe(first);
  });

  it("keeps failed compilations and variable evaluation isolated from future uncached combinations", async () => {
    const [tw, clean] = await Promise.all([
      createTailwindStyle(),
      createTailwindStyle(),
    ]);
    for (const failed of [
      "bg-linear-to-r from-red-500 to-blue-500 shadow-red-500",
      "[color:var(--external)] border-dashed",
      "transition-all shadow-red-500 leading-loose",
      "[color:var(--missing)] shadow-md shadow-red-500",
    ])
      expect(() => tw(failed)).toThrow();
    for (const fresh of [
      "border p-4",
      "text-xl leading-tight",
      "shadow-md",
      "ring-2",
      "translate-x-2 scale-90",
    ]) {
      expect(tw(fresh)).toEqual(clean(fresh));
    }
    expect(tw("flex shadow-blue-500")).toEqual({ display: "flex" });
  });

  it("rejects invalid theme input, CSS injection and variable cycles explicitly", async () => {
    await expect(
      createTailwindStyle({ theme: { "--color-brand": "red;position:fixed" } })
    ).rejects.toThrow("one CSS value");
    await expect(
      createTailwindStyle({ theme: { "--tw-shadow": "none" } })
    ).rejects.toThrow("Invalid Tailwind theme token");
    const tw = await createTailwindStyle({
      theme: { "--color-a": "var(--color-b)", "--color-b": "var(--color-a)" },
    });
    expect(() => tw("bg-a")).toThrow(/variable cycle/);
  });

  it("bounds the compiler candidate store as well as the result cache", async () => {
    const tw = await createTailwindStyle();
    for (let batch = 0; batch < 16; batch++) {
      const classes = Array.from(
        { length: 256 },
        (_, index) => `w-[${batch * 256 + index}px]`
      ).join(" ");
      tw(classes);
    }
    expect(() => tw("p-4")).toThrow(/exceeds 4096 distinct classes/);
    expect(tw("w-[12px]")).toEqual({ width: "12px" });
    const independent = await createTailwindStyle();
    expect(independent("p-4").padding).toBe("calc(0.25rem * 4)");
  });
});
