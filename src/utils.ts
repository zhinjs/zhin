/**
 * 寻找数组中最后一个符合条件的元素下标
 * @param list 数组
 * @param predicate 条件
 * @returns {number} 元素下标，未找到返回-1
 */
export function findLastIndex<T>(list: T[], predicate: (item: T, index: number) => boolean) {
    for (let i = list.length - 1; i >= 0; i--) {
        if (predicate(list[i], i)) return i;
    }
    return -1;
}

/**
 * 从字符串中移除一层外层引号
 * @param str 字符串
 */
export function removeOuterQuoteOnce(str: string) {
    if (str.startsWith('"') && str.endsWith('"')) return str.slice(1, -1); // 英文双引号
    if (str.startsWith("'") && str.endsWith("'")) return str.slice(1, -1); // 英文单引号
    if (str.startsWith("`") && str.endsWith("`")) return str.slice(1, -1); // 英文反引号
    if (str.startsWith("“") && str.endsWith("”")) return str.slice(1, -1); // 中文双引号
    if (str.startsWith("’") && str.endsWith("‘")) return str.slice(1, -1); // 中文单引号
    return str;
}
