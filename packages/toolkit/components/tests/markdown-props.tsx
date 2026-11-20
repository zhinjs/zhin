import { MarkdownView } from "../src/markdown.js";

export const markdownFixtures = [
  <MarkdownView source="# Ready" custom={{ style: { margin: 0 } }} />,
  <MarkdownView>{"**children**"}</MarkdownView>,
];

// @ts-expect-error MarkdownView parses strings rather than arbitrary display nodes.
export const nonStringSource = <MarkdownView source={<b>Ready</b>} />;
// @ts-expect-error Source and children are alternative parser inputs.
export const duplicateSources = <MarkdownView source="A">B</MarkdownView>;
