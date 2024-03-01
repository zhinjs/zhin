import { Dict } from 'zhin';
export declare function setValueToObj(obj: Dict, keys: string[], value: any): boolean;
export declare function setValueToObj(obj: Dict, key: string, value: any): boolean;
export declare function getValueOfObj<T = any>(obj: Dict, key: string[]): T;
export declare function getValueOfObj<T = any>(obj: Dict, key: string): T;
export declare function getDataKeyOfObj(data: any, obj: Dict): string | undefined;
export declare function parseObjFromStr(str: string): any;
export declare function stringifyObj(value: any): string;
