/** Static element properties. Deliberately excludes interaction, animation and resource loading. */
const allowed = new Set(
  `
  display box-sizing position top right bottom left inset inset-inline inset-block
  inset-inline-start inset-inline-end inset-block-start inset-block-end z-index
  isolation visibility overflow overflow-x overflow-y overflow-wrap
  width height min-width min-height max-width max-height inline-size block-size
  min-inline-size max-inline-size min-block-size max-block-size aspect-ratio
  margin margin-top margin-right margin-bottom margin-left margin-inline margin-block
  margin-inline-start margin-inline-end margin-block-start margin-block-end
  padding padding-top padding-right padding-bottom padding-left padding-inline padding-block
  padding-inline-start padding-inline-end padding-block-start padding-block-end
  flex flex-direction flex-wrap flex-grow flex-shrink flex-basis order
  align-items align-content align-self justify-items justify-content justify-self
  place-items place-content place-self gap row-gap column-gap
  grid grid-template grid-template-columns grid-template-rows grid-template-areas
  grid-auto-flow grid-auto-columns grid-auto-rows grid-area grid-column grid-row
  grid-column-start grid-column-end grid-row-start grid-row-end
  color background-color background-image background-position background-size
  background-repeat background-origin background-clip background-attachment
  border border-width border-style border-color border-radius border-collapse border-spacing
  border-top border-right border-bottom border-left border-inline border-block
  border-top-width border-right-width border-bottom-width border-left-width
  border-inline-width border-block-width border-inline-start-width border-inline-end-width
  border-top-style border-right-style border-bottom-style border-left-style
  border-inline-style border-block-style border-inline-start-style border-inline-end-style
  border-top-color border-right-color border-bottom-color border-left-color
  border-inline-color border-block-color border-inline-start-color border-inline-end-color
  border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius
  border-start-start-radius border-start-end-radius border-end-start-radius border-end-end-radius
  outline outline-width outline-style outline-color outline-offset
  box-shadow opacity mix-blend-mode background-blend-mode
  font font-family font-size font-style font-weight font-stretch font-feature-settings
  font-variation-settings font-variant-numeric font-variant-caps font-synthesis
  line-height letter-spacing text-align text-indent text-transform white-space
  text-decoration text-decoration-line text-decoration-color text-decoration-style
  text-decoration-thickness text-underline-offset text-overflow text-wrap word-break
  hyphens vertical-align list-style-type list-style-position
  object-fit object-position table-layout caption-side empty-cells
  transform transform-origin translate rotate scale backface-visibility
  fill fill-opacity stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin
  stroke-dasharray stroke-dashoffset paint-order
`
    .trim()
    .split(/\s+/)
);

export function assertStaticProperty(
  property: string,
  value: string,
  candidate: string
): void {
  if (!allowed.has(property))
    throw new Error(
      `Unsupported static Tailwind property ${property} in ${candidate}.`
    );
  if (
    property === "position" &&
    !["static", "relative", "absolute"].includes(value.trim())
  ) {
    throw new Error(
      `Unsupported Tailwind position ${value} in ${candidate}; fixed/sticky depend on the viewport.`
    );
  }
  if (property === "background-attachment" && value.trim() !== "scroll") {
    throw new Error(
      `Unsupported Tailwind background attachment ${value} in ${candidate}.`
    );
  }
  if (/^(?:inherit|unset|revert|revert-layer)$/i.test(value.trim())) {
    throw new Error(
      `Tailwind property ${property} in ${candidate} depends on an external stylesheet.`
    );
  }
}
