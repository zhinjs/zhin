import { Message, Plugin } from 'zhin';

type QAInfo = {
  adapter: string; // 可用适配器
  bot: string; // 可用机器人
  scope: string; // 哪些消息可响应
  content: string; // 问题
  answer: string; // 响应
  redirect?: boolean; // 是否为重定向
  regexp?: boolean; // 是否为正则
  weight: number; // 响应权重
  weightReal?: [number, number];
  authorId: string; // 作者Id
  authorName: string; // 作者名称
};

const zhText: Record<string, string> = {
  adapter: '可用适配器',
  bot: '可用机器人',
  scope: '可响应消息',
  content: '问题',
  answer: '回复',
  redirect: '是否为重定向',
  regexp: '是否正则',
  weight: '权重',
  authorId: '作者id',
  authorName: '作者名称',
};
const fixWeight = (list: QAInfo[]) => {
  const totalWeight = list.reduce((result, item) => result + item.weight, 0);
  let total = 0;
  return list.map(qa => {
    const weight = qa.weight / totalWeight;
    return {
      ...qa,
      weightReal: [total, (total += weight)],
    } as QAInfo;
  });
};
const getMatchedQuestion = (message: Message): undefined | QAInfo => {
  const qaList = fixWeight(
    qaPlugin.jsondb
      .get<QAInfo[]>('qa')!
      .filter(qa => {
        if (!qa.adapter || qa.adapter === '*') return true;
        return qa.adapter.includes(message.adapter.name);
      })
      .filter(qa => {
        if (!qa.bot || qa.bot === '*') return true;
        return qa.bot.includes(message.bot.unique_id);
      })
      .filter(qa => {
        return qa.scope.includes(message.message_type);
      })
      .filter(qa => {
        if (qa.regexp) return new RegExp(qa.content).test(message.raw_message);
        return qa.content === message.raw_message;
      }),
  );
  if (!qaList.length) return void 0;
  const rand = Math.random();
  return qaList.find(qa => {
    const [min, max] = qa.weightReal!;
    return rand >= min && rand <= max;
  });
};
const getAnswer = (message: Message): undefined | QAInfo => {
  const qa = getMatchedQuestion(message);
  if (!qa || !qa.redirect) return qa;
  message.raw_message = qa.answer;
  return getAnswer(message);
};
const qaPlugin = new Plugin('问答管理');
const qaCommand = qaPlugin
  .command('问答 <question:string> <answer:string>')
  .desc('添加问答')
  .option('-a <adapter:string> 可用适配器,默认*', '*')
  .option('-b <bot:string> 可用机器人,默认*', '*')
  .option('-x <regexp:boolean> 是否正则', false)
  .option('-r <redirect:boolean> 重定向', false)
  .option('-s <scope:string> 作用域(private,group,direct,guild)，默认所有', 'private,group,direct,guild')
  .option('-p <weight:number> 权重', 1)
  .action(async ({ message, adapter, prompt, options }, content, answer) => {
    const existQa = qaPlugin.jsondb.find<QAInfo>('qa', q => {
      return q.content === content;
    });
    if (existQa) {
      const confirmUpdate = await prompt.confirm('该问题已存在，是否继续添加？');
      if (!confirmUpdate) return '已取消';
    }

    qaPlugin.jsondb.push<QAInfo>('qa', {
      content,
      adapter: options.adapter,
      bot: options.bot,
      scope: options.scope,
      regexp: options.regexp,
      redirect: options.redirect,
      weight: options.weight,
      answer,
      authorId: `${adapter.name}:${message.sender?.user_id}`,
      authorName: message.sender?.user_name || message.sender?.user_id + '',
    });
    return `问答已添加`;
  });
qaPlugin.mounted(() => {
  const qaList = qaPlugin.jsondb.get('qa', []);
  if (!qaList) qaPlugin.jsondb.set('qa', []);
});
qaCommand
  .command('问答列表')
  .option('-p <page:number> 页码', 1)
  .option('-f <full:boolean> 全作用域查询', false)
  .action(({ adapter, bot, prompt, message, options }) => {
    const pageSize = 10;
    const qaList = qaPlugin.jsondb
      .filter<QAInfo>('qa', (qa, index) => {
        return options.full || qa.scope.includes(message.message_type);
      })
      .filter((_, index) => {
        return index >= (options.page - 1) * pageSize && index < options.page * pageSize;
      });
    if (!qaList.length) return `没有更多问答数据`;
    return (
      qaList
        .map((qa, index) => {
          return `${(options.page - 1) * pageSize + index + 1}：\n问:${qa.content}\n答:${encodeURIComponent(
            qa.answer,
          )}\n`;
        })
        .join('\n') + `第${options.page}页，共${Math.ceil(qaList.length / pageSize)}页`
    );
  });
qaCommand
  .command('修改问答 <no:number> [content:string] [answer:string]')
  .option('-a [adapter:string] 可用适配器')
  .option('-b [bot:string] 可用机器人,默认*')
  .option('-x [regexp:boolean] 是否正则')
  .option('-r [redirect:boolean] 重定向')
  .option('-s [scope:string] 作用域(private,group,direct,guild)')
  .option('-p [weight:number] 权重')
  .action(({ message, adapter, options }, no, content, answer) => {
    const existQa = qaPlugin.jsondb.find<QAInfo>('qa', (_, i) => {
      return i === no - 1;
    });
    if (!existQa) return `问答${no} 不存在`;
    const editor = `${adapter.name}:${message.sender?.user_id}`;
    if (editor !== existQa?.authorId) return `仅作者本人：${existQa?.authorName} 才能更改哦`;
    qaPlugin.jsondb.splice('qa', no - 1, 1, {
      ...existQa,
      content: content || existQa.content,
      answer: answer || existQa.answer,
      ...options,
    });
    return `问答${no} 已更新`;
  });
qaCommand
  .command('删除问答 <no:number>')
  .option('-y <confirm:boolean> 是否确认', false)
  .action(async ({ adapter, message, options, prompt }, no) => {
    const qa = qaPlugin.jsondb.get<QAInfo>(`qa.${no - 1}`);
    if (!qa) return `问答不存在`;
    if (qa.authorId !== `${adapter.name}:${message.sender?.user_id}`) return `非作者本人(${qa.authorName})不可删除!`;
    const isConfirm = options.confirm || (await prompt.confirm('确认删除吗？'));
    if (!isConfirm) return '已取消删除';
    qaPlugin.jsondb.splice('qa', no - 1, 1);
    return `已删除问答：${no}`;
  });
qaCommand.command('问答详情 <no:number>').action((_, no) => {
  const qa = qaPlugin.jsondb.get<QAInfo>(`qa.${no - 1}`);
  if (!qa) return `问答不存在`;
  return `问答${no}：\n${JSON.stringify(
    Object.fromEntries(
      Object.keys(qa).map(key => {
        return [zhText[key] || key, qa[key as keyof QAInfo]];
      }),
    ),
    null,
    2,
  )}`;
});
qaPlugin.middleware(async (adapter, bot, message, next) => {
  const beforeMessage = message.raw_message;
  await next();
  const afterMessage = message.raw_message;
  if (beforeMessage !== afterMessage) return;
  const qa = getAnswer(message);
  if (!qa) return;
  if (!qa.regexp) return message.reply(qa.answer);
  const matchArr = message.raw_message.match(new RegExp(qa.content))!;
  matchArr.forEach((match, idx) => {
    qa.answer = qa.answer.replace(new RegExp(`\\$${idx}`), match);
  });
  return message.reply(qa.answer);
});
export default qaPlugin;
