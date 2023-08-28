import * as Yaml from "js-yaml";
import * as fs from "fs";
import { h, onDispose, useContext, Zhin } from "@";
import { Element } from "@/element";
import { getValue, setValue, deleteValue, Keys } from "@zhinjs/shared";

const config = Yaml.load(fs.readFileSync(process.env.configPath || "", "utf8")) as Zhin.Options;
function protectKeys(obj: Record<string, any>, keys: string[]) {
    if (!obj || typeof obj !== "object") return obj;
    return Object.fromEntries(
        Object.entries(obj).map(([key, value]) => {
            return [
                key,
                Array.isArray(value)
                    ? value.map(v => (typeof v === "object" ? protectKeys(v, keys) : v))
                    : value && typeof value === "object"
                    ? protectKeys(value, keys)
                    : keys.includes(key)
                    ? new Array(value.length).fill("*").join("")
                    : value,
            ];
        }),
    );
}

function outputConfig(config, key) {
    if (!key)
        return h("text", {
            text: JSON.stringify(protectKeys(config, ["password", "access_token"]), null, 2),
        });
    const result = JSON.stringify(
        protectKeys(getValue(config, key), ["password", "access_token"]),
        null,
        2,
    );
    return h("text", {
        text: key.endsWith("password") ? new Array(result.length).fill("*").join("") : result,
    });
}

const ctx = useContext();
ctx.master()
    .command("config [key:string] [value:string]")
    .desc("编辑配置文件")
    .hidden()
    .option("-d [delete:boolean] 删除指定配置")
    .action(({ options }, key, value) => {
        if (value === undefined && !options.delete) return outputConfig(config, key);
        if (options.delete) {
            deleteValue(config, key as Keys<object>);
            fs.writeFileSync(process.env.configPath, Yaml.dump(config));
            return `已删除:config.${key}`;
        }
        try {
            value = JSON.parse(Element.stringify(value));
        } catch {}
        setValue(config, key as Keys<object>, value as never);
        fs.writeFileSync(process.env.configPath, Yaml.dump(config));
        return `修改成功`;
    });
ctx.master()
    .command("config/ignore [...user_id:user_id]")
    .desc("忽略指定用户的消息")
    .option("-d [delete:boolean] 删除指定配置")
    .action(({ options }, user_id) => {
        if (!user_id) user_id = [];
        user_id = user_id.map(String);
        const ignore = getValue(config, "plugins.config.ignore") || [];
        if (options.delete) {
            if (!user_id.length) return `user_id不能为空`;
            config.ignore = ignore.filter((id: string) => !user_id.includes(`${id}`));
            return `已删除:${user_id.join(",")}`;
        }
        if (!user_id?.length) return `当前忽略列表:${ignore.join(",")}`;
        setValue(config, "plugins.config.ignore", [
            ...new Set([...ignore, ...user_id].map(String)),
        ]);
        fs.writeFileSync(process.env.configPath, Yaml.dump(config));
        return `修改成功`;
    });
const dispose = ctx.zhin.middleware(async (session, next) => {
    const ignore = getValue(config, "plugins.config.ignore") || [];
    if (ignore.includes(`${session.user_id}`)) return;
    return next();
}, true);
onDispose(dispose);
