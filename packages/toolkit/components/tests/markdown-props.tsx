import { Markdown } from "../src/markdown.js";

export const markdownFixtures = [
  <Markdown source="# Ready" custom={{ style: { margin: 0 } }} />,
  <Markdown>{"**children**"}</Markdown>,
];

// @ts-expect-error Markdown parses strings rather than arbitrary display nodes.
export const nonStringSource = <Markdown source={<b>Ready</b>} />;
// @ts-expect-error Source and children are alternative parser inputs.
export const duplicateSources = <Markdown source="A">B</Markdown>;
