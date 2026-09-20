import { formatDisplayPath, looksLikeAbsolutePath } from '@zhin.js/logger';

export function displayConsolePath(value: string, projectRoot: string): string {
  if (!value || !looksLikeAbsolutePath(value)) return value;
  return formatDisplayPath(value, { projectRoot });
}
