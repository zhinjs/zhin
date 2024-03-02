import { bundledLanguages } from './langs.mjs';
export { bundledLanguagesAlias, bundledLanguagesBase, bundledLanguagesInfo } from './langs.mjs';
import { bundledThemes } from './themes.mjs';
export { bundledThemesInfo } from './themes.mjs';
import { createdBundledHighlighter, createSingletonShorthands } from 'shikiji-core';
export * from 'shikiji-core';
import { getWasmInlined } from 'shikiji-core/wasm';
export * from 'shikiji-core/wasm';

const getHighlighter = /* @__PURE__ */ createdBundledHighlighter(
  bundledLanguages,
  bundledThemes,
  getWasmInlined
);
const {
  codeToHtml,
  codeToHast,
  codeToThemedTokens,
  codeToTokensWithThemes,
  getSingletonHighlighter
} = /* @__PURE__ */ createSingletonShorthands(
  getHighlighter
);

export { bundledLanguages, bundledThemes, codeToHast, codeToHtml, codeToThemedTokens, codeToTokensWithThemes, getHighlighter, getSingletonHighlighter };
