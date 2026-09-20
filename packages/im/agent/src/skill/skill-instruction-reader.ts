import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkSkillDependencies, extractSkillInstructions } from './skill-instructions.js';

export type SkillInstructionReadResult = Readonly<
  | { status: 'found'; instructions: string }
  | { status: 'missing'; name: string }
>;

export interface SkillInstructionSource {
  read(name: string): Promise<SkillInstructionReadResult>;
}

export interface SkillInstructionReaderOptions {
  readonly registeredFile?: (name: string) => string | undefined;
  readonly directories: () => readonly string[];
  readonly maxChars: number;
}

/** Resolves and reads Skill instructions without exposing filesystem lookup rules to callers. */
export class SkillInstructionReader implements SkillInstructionSource {
  readonly #options: SkillInstructionReaderOptions;

  constructor(options: SkillInstructionReaderOptions) {
    if (!Number.isInteger(options.maxChars) || options.maxChars <= 0) {
      throw new TypeError('Skill instruction maxChars must be a positive integer');
    }
    this.#options = options;
  }

  async read(name: string): Promise<SkillInstructionReadResult> {
    const canonicalName = name.trim();
    if (
      !canonicalName
      || canonicalName !== name
      || canonicalName === '.'
      || canonicalName === '..'
      || canonicalName.includes('/')
      || canonicalName.includes('\\')
    ) {
      throw new TypeError('Skill name must be a non-empty canonical name');
    }
    const registered = this.#options.registeredFile?.(canonicalName);
    if (registered && existsSync(registered)) return this.#readFile(canonicalName, registered);
    for (const directory of this.#options.directories()) {
      const candidate = join(directory, canonicalName, 'SKILL.md');
      if (existsSync(candidate)) return this.#readFile(canonicalName, candidate);
    }
    return Object.freeze({ status: 'missing', name: canonicalName });
  }

  async #readFile(name: string, file: string): Promise<SkillInstructionReadResult> {
    const content = await readFile(file, 'utf8');
    const dependencyWarning = await checkSkillDependencies(content);
    const instructions = extractSkillInstructions(name, content, this.#options.maxChars);
    return Object.freeze({
      status: 'found',
      instructions: dependencyWarning ? `${dependencyWarning}\n\n${instructions}` : instructions,
    });
  }
}
