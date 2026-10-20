import type { JSXStyle } from "@zhin.js/jsx";
import { createTailwindStyle, type TailwindStyle } from "../src/index.js";

async function author() {
  const tw = await createTailwindStyle({
    theme: { "--color-brand": "#2463eb" },
  });
  const style: JSXStyle = tw("grid grid-cols-2 p-4 bg-brand");
  const native = <div style={style}>Hello</div>;
  const readonly: TailwindStyle = tw("p-2");
  // @ts-expect-error Resolved styles cannot be mutated.
  readonly.padding = "0";
  // @ts-expect-error Theme names are CSS custom property names.
  await createTailwindStyle({ theme: { color: "red" } });
  return native;
}
void author;
