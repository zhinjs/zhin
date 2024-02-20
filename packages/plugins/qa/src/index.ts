import { Message, Plugin } from 'zhin';
import type {} from '@zhinjs/plugin-jsondb';

type QAInfo = {
  message_type: Message.Type[]; // 哪些消息可响应
  content: string; // 问题
  answer: string; // 响应
  redirect?: boolean; // 是否为重定向
  regexp?: boolean; // 是否为正则
  weight: number; // 响应权重
  weightReal?: [number, number];
  authorId: string; // 作者Id
  authorName: string; // 作者名称
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
        return qa.message_type.includes(message.message_type);
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
qaPlugin.required('jsondb');
qaPlugin.mounted(() => {
  const qaList = qaPlugin.jsondb.get('qa', []);
  if (!qaList) qaPlugin.jsondb.set('qa', []);
});
qaPlugin
  .command('问答 <question:string> <answer:string>')
  .option('-x <regexp:boolean> 是否正则', false)
  .option('-r <redirect:boolean> 重定向', false)
  .option('-e <edit:boolean> 是否为编辑', false)
  .option('-s <...scope:string> 作用域(private,group,direct,guild)，默认所有', ['private', 'group', 'direct', 'guild'])
  .option('-p <weight:number> 权重', 1)
  .action(async ({ message, adapter, prompt, options }, content, answer) => {
    const existQa = qaPlugin.jsondb.find<QAInfo>('qa', q => {
      return q.content === content;
    });
    if (existQa && !options.edit) {
      const confirmUpdate = await prompt.confirm('该问题已存在，是否继续添加？');
      if (!confirmUpdate) return '已取消';
    }
    if (options.edit && existQa) {
      const editor = `${adapter.name}:${message.sender?.user_id}`;
      if (editor !== existQa.authorId) return `仅作者本人：${existQa.authorName} 才能更改哦`;
      const idx = qaPlugin.jsondb.indexOf('qa', existQa);
      qaPlugin.jsondb.splice('qa', idx, 0, {
        ...existQa,
        content,
        regexp: options.regexp,
        redirect: options.redirect,
        weight: options.weight,
        answer,
      });
      return `问答${idx} 已更新`;
    } else {
      if (!existQa && options.edit) message.reply('问答不存在，即将添加');
      qaPlugin.jsondb.push<QAInfo>('qa', {
        content,
        message_type: options.scope as Message.Type[],
        regexp: options.regexp,
        redirect: options.redirect,
        weight: options.weight,
        answer,
        authorId: `${adapter.name}:${message.sender?.user_id}`,
        authorName: message.sender?.user_name || message.sender?.user_id + '',
      });
      return `问答已添加`;
    }
  });
qaPlugin
  .command('删除问答 <no:number>')
  .option('-y <confirm:boolean> 是否确认', false)
  .action(async ({ adapter, message, options, prompt }, no) => {
    const qa = qaPlugin.jsondb.get<QAInfo>(`qa.${no - 1}`);
    if (!qa) return `问答不存在`;
    if (qa.authorId !== `${adapter.name}:${message.sender?.user_id}`) return `非作者本人(${qa.authorName})不可删除!`;
    const isConfirm = options.confirm || (await prompt.confirm('确认删除吗？'));
    if (!isConfirm) return '已取消删除';
    qaPlugin.jsondb.splice('qa', no - 1, 1);
    message.reply(`已删除问答：${no}`);
  });
qaPlugin
  .command('问答列表')
  .option('-p <page:number> 页码', 1)
  .option('-f <full:boolean> 全作用域查询', false)
  .action(({ adapter, bot, prompt, message, options }) => {
    const qaList = qaPlugin.jsondb.get<QAInfo[]>('qa');
    const pageSize = 10;
    if (!qaList) return '暂无问答信息，可使用 `qa 添加问答`，使用方法请回复 `help qa`';
    const pageAfter = qaList
      .filter(qa => options.full || qa.message_type.includes(message.message_type))
      .slice(pageSize * (options.page - 1), pageSize * options.page);
    if (!pageAfter.length) return `没有更多问答数据`;
    return (
      `共收录了${qaList.length}个问答\n` +
      pageAfter
        .map((qa, index) => {
          return `${index + 1}：\n问:${qa.content}\n答:${qa.answer}\n`;
        })
        .join('\n') +
      `第${options.page}页，共${Math.ceil(qaList.length / pageSize)}页`
    );
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
