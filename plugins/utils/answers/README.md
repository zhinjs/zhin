# @zhin.js/plugin-answers

群聊小玩具合集：**答案之书**、**好无聊**趣味选择题和**科目一**交规小测。不依赖任何平台专属 API，所有适配器都能用。

题库、答案和解析都是本仓库原创内容（MIT），没有从任何第三方题库、书籍或机器人项目复制。

## 安装

```bash
pnpm exec zhin install @zhin.js/plugin-answers
```

## 配置

在应用目录运行安装命令，会安装依赖并挂载到主配置 `plugins` 映射，实例名为 `answers`。在 `zhin.config.yml` 的实例节点修改配置：

```yaml
configVersion: 2
plugins:
  answers: "@zhin.js/plugin-answers"
answers:
  dailyStable: false        # true 时，同一用户同一天问同一个问题得到相同答案（默认 false）
  timezone: Asia/Shanghai   # dailyStable 判断「同一天」所用的 IANA 时区
  quizTimeoutSeconds: 120   # 出题后等待作答的秒数，15–600（默认 120）
  enableDrivingQuiz: true   # 是否启用「科目一」小测（默认 true）
```

配置声明位于 `src/config.ts`，`schema.json` 由 `node scripts/sync-plugin-config-schemas.mjs` 从同一声明生成。配置不满足范围或含未知字段时，候选代不会激活。

## 命令

| 命令 | 说明 |
|------|------|
| `答案之书 <问题>` / `answerbook <问题>` | 翻开答案之书。不带问题时显示用法 |
| `好无聊` / `boring` | 出一道趣味选择题 |
| `科目一` | 出一道交规小测题 |

出题后，**出题人本人**在同一会话直接回复选项字母（`A`–`D`，大小写和全角都可以）即可作答，回复后显示对错和解析。其他人回复的字母、其他会话里的字母、超时后的回复都会被忽略，交给后续中间件处理，不会劫持普通聊天。每人每个会话同时只有一道待答题，再次出题会替换旧题。

待答题只保存在内存里，插件重载或 Bot 重启后作废。内存中最多保留 1000 道待答题，超出时丢弃最早的。

## 关于「科目一」

题面是依据公开的《中华人民共和国道路交通安全法》及《道路交通安全法实施条例》等法规原创整理的，每题解析都注明了依据条款。未使用任何驾考题库的题目或图片。仅供娱乐和自测，具体规定以现行有效的法律法规和当地交管部门要求为准。不需要时可以用 `enableDrivingQuiz: false` 关闭。

## 编程接口

包入口导出纯函数和数据，方便在其他插件里复用：

```ts
import { pickBookAnswer, FUN_QUESTIONS, QuizService } from '@zhin.js/plugin-answers';

const answer = pickBookAnswer({ question: '今天出门吗', senderId: 'alice', dailyStable: true, timezone: 'Asia/Shanghai' });
```

## English

Fun, platform-agnostic chat toys with **original** content: `答案之书 <question>` (book of answers, optional per-day stable answers), `好无聊` (multiple-choice trivia) and `科目一` (traffic-rule quiz written from the public PRC Road Traffic Safety Law and its implementing regulations; entertainment only). Only the asker can answer, by replying a single letter in the same conversation before the timeout.

## 许可

MIT
