import type { JSXNode } from '@zhin.js/jsx';
import { CodeBlock } from '../src/code-block.js';
import { ThemeProvider } from '../src/theme.js';

async function Title(): Promise<JSXNode> { return <b>status.ts</b>; }

export const codeFixtures = [
  <CodeBlock source={'const ready = true;'} language="typescript" title={Title()} />,
  <ThemeProvider theme={{ code: { theme: 'github-dark', fontSize: 14 } }}>
    <CodeBlock source={'<unknown> & escaped'} language="unknown-language" lineNumbers={false} wrap={false} />
  </ThemeProvider>,
];

// @ts-expect-error Code is a string, not arbitrary JSX input.
export const invalidCode = <CodeBlock source={<b>code</b>} />;
