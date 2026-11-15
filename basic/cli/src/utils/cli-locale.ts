/**
 * Display language of CLI output: the project's `locale` in `zhin.config.*` (the same setting the
 * setup wizard and bots use, docs/configuration/localization.md), `zh-CN` when there is none or the
 * file cannot be read. Help texts are bilingual (`中文 / English`) because they are printed before
 * any project is known.
 */
import { join } from 'node:path';
import { resolveLocale, type Locale } from '@zhin.js/plugin-runtime';
import { createConfigDocument } from '@zhin.js/runtime';
import { findConfigFile } from '@zhin.js/gateway/project';

export async function projectDisplayLocale(projectRoot: string, override?: string): Promise<Locale> {
  if (override !== undefined) return resolveLocale(override);
  try {
    const file = findConfigFile(projectRoot);
    if (!file) return resolveLocale(undefined);
    const document = (await createConfigDocument(join(projectRoot, file)).read()).document as { locale?: unknown } | undefined;
    return resolveLocale(document?.locale);
  } catch {
    return resolveLocale(undefined);
  }
}
