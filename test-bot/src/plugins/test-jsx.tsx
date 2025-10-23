import {
  addCommand,
  MessageCommand,
  defineSchema,
  usePlugin,
  Schema,
} from "zhin.js";
defineSchema(
  Schema.object({
    test: Schema.const("test").description("这是一个测试常量字段").required(),
    union: Schema.union([
      Schema.string(),
      Schema.number(),
      Schema.boolean(),
    ] as const).description("这是一个测试联合类型字段"),
    testField: Schema.string()
      .default("defaultValue")
      .description("这是一个测试字段"),
    testNumber: Schema.number()
      .default(1)
      .description("这是一个测试数字字段"),
    testBoolean: Schema.boolean()
      .default(false)
      .description("这是一个测试布尔字段"),
    testArray: Schema.list(
      Schema.object({
        itemField: Schema.boolean()
          .default(true)
          .description("这是数组项的字段"),
      })
    ).description("这是一个测试数组字段"),
    testTurple: Schema.tuple([
      Schema.string(),
      Schema.number(),
      Schema.boolean()
    ]).description("这是一个测试元组字段"),
    testObject: Schema.object({
      nestedField: Schema.string()
        .default("nestedDefault")
        .description("这是一个嵌套字段"),
    }).description("这是一个测试对象字段"),
  }, "config")
);
const plugin = usePlugin();
console.log(plugin.config);
addCommand(
  new MessageCommand("test-jsx").action(async (message, result) => {
    return (
      <>
        hello world
        <face id={66}/>
      </>
    );
  })
);
