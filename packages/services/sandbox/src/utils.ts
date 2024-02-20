import { Dict } from 'zhin';

export function compiler(template: string, ctx: Dict) {
  const matched = [...template.matchAll(/{{([^{}]*?)}}/g)];
  for (const item of matched) {
    const tpl = item[1];
    let value = getValueWithRuntime(tpl, ctx);
    if (value === tpl) continue;
    if (typeof value !== 'string') value = JSON.stringify(value, null, 2);
    template = template.replace(`{{${item[1]}}}`, value);
  }
  return template;
}
export const fixLoop = (loop: string) => {
  let [_, name, value] = /(\S+)\sin\s(\S+)/.exec(loop) || [];
  if (/\d+/.test(value))
    value = `[${new Array(+value)
      .fill(0)
      .map((_, i) => i)
      .join(',')}]`;
  if (/^\[.+]$/.test(value)) {
    return { name, value: '__loop__', __loop__: JSON.parse(value) };
  }
  return { name, value };
};
export function getValueWithRuntime(template: string, ctx: Dict) {
  const result = evaluate(template, ctx);
  if (result === `return(${template})`) return template;
  return result;
}

export const evaluate = <S, T = any>(exp: string, context: S) => execute<S, T>(`return(${exp})`, context);

const evalCache: Record<string, Function> = Object.create(null);
export const execute = <S, T = any>(exp: string, context: S) => {
  const fn = evalCache[exp] || (evalCache[exp] = toFunction(exp));
  try {
    return fn.apply(context, [context]);
  } catch {
    return exp;
  }
};

const toFunction = (exp: string): Function => {
  try {
    return new Function(`$data`, `with($data){${exp}}`);
  } catch {
    return () => {};
  }
};
