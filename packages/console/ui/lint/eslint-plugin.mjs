/**
 * ESLint plugin of @zhin.js/console-ui (`@zhin.js/console-ui/eslint`, ADR 0063 D20 第 1 条).
 *
 * Rules:
 *   console-ui/no-arbitrary-values   Tailwind arbitrary values of scale utilities (`p-[…]`, `rounded-[…]`,
 *                                    `text-[13px]`, `[padding:…]`); colors from tokens stay allowed
 *   console-ui/no-off-scale-classes  spacing keys off the 8-step scale (`p-5`, `gap-2.5`), Tailwind
 *                                    default shadows / radii / font sizes / weights, wide borders
 *   console-ui/no-native-controls    native <button>, <input>, <select>, <textarea>, <table>, <dialog>
 *
 * Classes are read from `className` / `class` attributes and from the arguments of `cn`, `clsx`,
 * `cva`, `cx`, `twMerge`, `classNames` and `tv`.
 *
 * Flat config:
 *   import consoleUi from '@zhin.js/console-ui/eslint';
 *   export default [consoleUi.configs.recommended];             // all three as errors
 *   // or pick: { plugins: { 'console-ui': consoleUi }, rules: { 'console-ui/no-off-scale-classes': 'error' } }
 */
import { classifyClass } from './tailwind-classes.mjs';

const CLASS_FUNCTIONS = new Set(['cn', 'clsx', 'cva', 'cx', 'twMerge', 'classNames', 'tv']);
const NATIVE_CONTROLS = ['button', 'input', 'select', 'textarea', 'table', 'dialog'];
const REPLACEMENT = {
  button: 'Button',
  input: 'Input',
  select: 'SelectField / SearchableSelectField',
  textarea: 'Textarea',
  table: 'Table',
  dialog: 'Dialog / ConfirmDialog',
};

function calleeName(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && node.property.type === 'Identifier') return node.property.name;
  return null;
}

/** Whether a string node sits in a class context (className attribute or a class helper call). */
function inClassContext(sourceCode, node) {
  for (const ancestor of [...sourceCode.getAncestors(node)].reverse()) {
    if (ancestor.type === 'JSXAttribute') {
      const name = ancestor.name.type === 'JSXIdentifier' ? ancestor.name.name : null;
      return name === 'className' || name === 'class';
    }
    if (ancestor.type === 'CallExpression') {
      const name = calleeName(ancestor.callee);
      if (name && CLASS_FUNCTIONS.has(name)) return true;
    }
  }
  return false;
}

function classRule(kind, description) {
  return {
    meta: {
      type: 'problem',
      docs: { description },
      schema: [],
      messages: { finding: '{{message}}' },
    },
    create(context) {
      const sourceCode = context.sourceCode ?? context.getSourceCode();
      const check = (node, text) => {
        if (!text || !inClassContext(sourceCode, node)) return;
        // Object keys (cva variant names) are not classes.
        if (node.parent?.type === 'Property' && node.parent.key === node) return;
        for (const token of text.split(/\s+/u)) {
          if (!token) continue;
          const finding = classifyClass(token);
          if (finding?.rule === kind) context.report({ node, messageId: 'finding', data: { message: finding.message } });
        }
      };
      return {
        Literal(node) {
          if (typeof node.value === 'string') check(node, node.value);
        },
        TemplateElement(node) {
          check(node, node.value.cooked ?? node.value.raw);
        },
      };
    },
  };
}

const noNativeControls = {
  meta: {
    type: 'problem',
    docs: { description: 'Use the @zhin.js/console-ui controls instead of native elements (ADR 0063 D19 / D20 第 6 条)' },
    schema: [{ type: 'object', properties: { allow: { type: 'array', items: { enum: NATIVE_CONTROLS } } }, additionalProperties: false }],
    messages: {
      native: 'Native <{{element}}>: use {{replacement}} from @zhin.js/console-ui (touch size, focus ring, themes, narrow layouts). Exempt only with an inline disable comment that names the reason.',
    },
  },
  create(context) {
    const allow = new Set(context.options[0]?.allow ?? []);
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier') return;
        const element = node.name.name;
        if (!NATIVE_CONTROLS.includes(element) || allow.has(element)) return;
        context.report({ node, messageId: 'native', data: { element, replacement: REPLACEMENT[element] } });
      },
    };
  },
};

const plugin = {
  meta: { name: '@zhin.js/console-ui/eslint' },
  rules: {
    'no-arbitrary-values': classRule('arbitrary', 'Disallow Tailwind arbitrary values of scale utilities (ADR 0063 D20)'),
    'no-off-scale-classes': classRule('off-scale', 'Disallow Tailwind classes off the Console scale (ADR 0063 D17)'),
    'no-native-controls': noNativeControls,
  },
  configs: {},
};

plugin.configs.recommended = {
  name: '@zhin.js/console-ui/recommended',
  plugins: { 'console-ui': plugin },
  rules: {
    'console-ui/no-arbitrary-values': 'error',
    'console-ui/no-off-scale-classes': 'error',
    'console-ui/no-native-controls': 'error',
  },
};

export default plugin;
export { plugin as consoleUiEslintPlugin };
