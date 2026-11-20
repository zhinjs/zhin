/**
 * Lazily loaded `inquirer` (#1250). The wizard's data (adapter list, stack versions, database
 * definitions, project config plans) is also used non-interactively, e.g. by the management
 * gateway and the supervised instance; they must not load the prompt library at import time.
 * `inquirer` is imported on the first prompt, and `prompt` is looked up on the real module at
 * every call so `vi.spyOn(inquirer, 'prompt')` on the `inquirer` default export keeps working.
 */
import type InquirerDefault from 'inquirer';

type Inquirer = typeof InquirerDefault;

let loaded: Promise<Inquirer> | undefined;

function loadInquirer(): Promise<Inquirer> {
  loaded ??= import('inquirer').then((module) => module.default);
  return loaded;
}

export const inquirer = {
  prompt: (async (...args: Parameters<Inquirer['prompt']>) => {
    const real = await loadInquirer();
    return real.prompt(...args);
  }) as unknown as Inquirer['prompt'],
};
