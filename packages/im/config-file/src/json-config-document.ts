import {
  applyConfigPatches,
  type ConfigPatch,
  type RuntimeConfigDocument,
} from '@zhin.js/plugin-runtime';
import {
  ConfigDocumentParseError,
  ConfigFileDocument,
  type PreparedConfigFileSource,
  requireConfigObject,
} from './config-file-document.js';

/** JSON implementation sharing the same transactional lifecycle as YAML. */
export class JsonConfigDocument extends ConfigFileDocument {
  readonly format = 'JSON' as const;

  protected parseSource(source: string): RuntimeConfigDocument {
    try {
      return requireConfigObject(this.file, this.format, JSON.parse(source) as unknown);
    } catch (error) {
      if (error instanceof ConfigDocumentParseError) throw error;
      throw new ConfigDocumentParseError(
        this.file,
        this.format,
        [error instanceof Error ? error.message : String(error)],
      );
    }
  }

  protected prepareSource(
    source: string,
    patches: readonly ConfigPatch[],
  ): PreparedConfigFileSource {
    const document = applyConfigPatches(this.parseSource(source), patches);
    const indentation = source.match(/\n([ \t]+)"/u)?.[1] ?? '  ';
    const lineEnding = source.includes('\r\n') ? '\r\n' : '\n';
    return Object.freeze({
      document,
      source: `${JSON.stringify(document, null, indentation).replaceAll('\n', lineEnding)}${lineEnding}`,
    });
  }
}
