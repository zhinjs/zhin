import {
  Adapters,
  Message,
  context,
  defineMetadata,
  Command,
  registerMiddleware,
  inject,
  segment,
  logger,
  Schema,
  useConfig,
  parseFromTemplate,
} from 'zhin';
import type {} from '@zhinjs/plugin-ollama';
defineMetadata({
  name: 'chat',
  // adapters: ['process'],
});
const Config = Schema.object({
  host: Schema.string('host'),
  model: Schema.string('model'),
  max_history: Schema.number('max_history'),
}).default({
  host: 'http://localhost:11434',
  model: 'deepseek-r1:1.5b',
  max_history: 10,
});
const config = useConfig('ollama', Config);
function createTools<T extends Adapters>(message: Message<T>) {
  return context.app?.getSupportCommands(message.adapter.name).map(command => {
    const options = Object.values(command['optionsConfig'] as Command.OptionsConfig);
    const args = command['argsConfig'] as Command.ArgsConfig;
    const requiredOptions = options.filter(option => option.required).map(option => option.name);
    const requiredArgs = args.filter(arg => arg.required).map(arg => arg.name);
    return {
      type: 'function',
      function: {
        name: command.name as string,
        description: command.config.desc as string,
        parameters: {
          type: 'object',
          properties: Object.fromEntries([
            ...args.map(arg => {
              return [
                arg.name as string,
                {
                  type: arg.type as string,
                  description: arg.name as string,
                },
              ];
            }),
            ...options.map(option => {
              return [
                option.name as string,
                {
                  type: option.type as string,
                  description: option.desc as string,
                },
              ];
            }),
          ]),
          required: [...requiredArgs, ...requiredOptions] as string[],
        },
      },
    };
  });
}
const callFunction = async (message: Message, name: string, params: Record<string, any>) => {
  const command = context.app?.getSupportCommands(message.adapter.name).find(command => command.name === name);
  if (!command) return;
  const optionsConfig = Object.values(command['optionsConfig'] as Command.OptionsConfig);
  const args = Object.keys(params)
    .filter(key => Reflect.has(command['argsConfig'], key))
    .map(key => params[key]);
  const options = Object.fromEntries(
    Object.keys(params)
      .filter(key => optionsConfig.some(option => option.name === key))
      .map(key => [key, params[key]]),
  );
  return await command.execute(
    message,
    `${name} ${args.join(' ')} ${Object.entries(options)
      .map(([key, value]) => `-${key} ${value}`)
      .join(' ')}`,
  );
};
type HistoryInfo = {
  channel: Message.Channel;
  content: string;
  role: string;
  images?: string[];
};
export async function getResult<T extends Adapters>(message: Message<T>) {
  const ollama = inject('ollama');
  const db = inject('database');
  const imageElems = parseFromTemplate(message.raw_message).filter(({ type }) => type === 'image');
  const imgs: string[] = imageElems.map(({ data }) => data.url).filter(Boolean);

  const history = await db.get<HistoryInfo[]>('chat_history', []);
  await db.push('chat_history', {
    channel: message.channel,
    content: message.raw_message,
    role: 'user',
    images: imgs,
  });
  // const tools = createTools(message);
  const result = await ollama.chat({
    stream: false,
    // tools: tools,
    model: config.model,
    messages: [
      {
        role: 'system',
        content: `你的名字叫知音(zhin)，在接下来的聊天中，如果用户(user)输入的消息没有提到你名字，你必须回复空字符串，一切会话均已中文回复`,
      },
      ...history
        .filter(info => info.channel === message.channel)
        .slice(-(config.max_history || 10))
        .map(info => ({
          role: info.role,
          content: info.content,
        })),
      {
        role: 'user',
        content: message.raw_message,
        images: imgs,
      },
    ],
  });
  const { content, role, images = [] } = result.message;
  const newContent = content.replace(/<think>([^</]+)<\/think>/, '').trim();
  await db.push('chat_history', {
    channel: message.channel,
    content: newContent,
    role,
    images,
  });
  return `${newContent}${images.map(url => segment.image(url)).join('')}`;
}
registerMiddleware(async (message, next) => {
  await next();
  if (!message.raw_message.includes('zhin')) return;
  try {
    const result = await getResult(message);
    if (result) message.reply(result);
  } catch (e) {
    console.error(e);
    logger.debug(e);
  }
});
