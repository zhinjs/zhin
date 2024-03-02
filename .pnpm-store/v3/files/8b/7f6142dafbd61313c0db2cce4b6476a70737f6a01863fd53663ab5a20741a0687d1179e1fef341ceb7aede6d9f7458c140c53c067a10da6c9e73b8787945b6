import { F as FontStyle } from './chunk-types.mjs';
export { I as IGrammar, a3 as IGrammarConfiguration, a0 as INITIAL, a4 as IOnigLib, k as IRawGrammar, a2 as IRawTheme, a6 as IRawThemeSetting, $ as Registry, a5 as RegistryOptions, a1 as StateStack } from './chunk-types.mjs';

declare const enum TemporaryStandardTokenType {
    Other = 0,
    Comment = 1,
    String = 2,
    RegEx = 4,
    MetaEmbedded = 8
}
declare const enum StandardTokenType {
    Other = 0,
    Comment = 1,
    String = 2,
    RegEx = 4
}
declare class StackElementMetadata {
    static toBinaryStr(metadata: number): string;
    static getLanguageId(metadata: number): number;
    static getTokenType(metadata: number): number;
    static getFontStyle(metadata: number): number;
    static getForeground(metadata: number): number;
    static getBackground(metadata: number): number;
    static containsBalancedBrackets(metadata: number): boolean;
    static set(metadata: number, languageId: number, tokenType: TemporaryStandardTokenType, fontStyle: FontStyle, foreground: number, background: number): number;
}

export { StackElementMetadata, StandardTokenType, TemporaryStandardTokenType };
