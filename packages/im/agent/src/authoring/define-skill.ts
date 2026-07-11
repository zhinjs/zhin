import { AUTHORING_KIND, type AuthoringSkillDefinition } from './types.js';

export type DefineSkillInput = Omit<AuthoringSkillDefinition, typeof AUTHORING_KIND | 'content'> & {
  content?: string;
};

export function defineSkill(input: DefineSkillInput): AuthoringSkillDefinition {
  return {
    [AUTHORING_KIND]: 'skill',
    content: input.content ?? '',
    ...input,
  };
}
