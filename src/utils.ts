
// 深合并
export function deepMerge(base, ...from) {
    if (from.length === 0) {
        return base;
    }
    if (typeof base !== 'object') {
        return base;
    }
    if (Array.isArray(base)) {
        return base.concat(...from);
    }
    for (const item of from) {
        for (const key in item) {
            if (base.hasOwnProperty(key)) {
                if (typeof base[key] === 'object') {
                    base[key] = deepMerge(base[key], item[key]);
                }
                else {
                    base[key] = item[key];
                }
            }
            else {
                base[key] = item[key];
            }
        }
    }
    return base;
}
// 深拷贝
export function deepClone(obj) {
    if (typeof obj !== 'object')
        return obj;
    if (!obj)
        return obj;
    //判断拷贝的obj是对象还是数组
    if (Array.isArray(obj))
        return obj.map((item) => deepClone(item));
    const objClone = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            if (obj[key] && typeof obj[key] === "object") {
                objClone[key] = deepClone(obj[key]);
            }
            else {
                objClone[key] = obj[key];
            }
        }
    }
    return objClone;
}
export function wrapExport(filepath:string){
    const {default:result,...other}=require(filepath)
    return result?Object.assign(result,other):other
}