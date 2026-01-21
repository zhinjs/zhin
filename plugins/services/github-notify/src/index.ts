import type { Router } from "@zhin.js/http";
import { usePlugin, MessageCommand, Plugin } from "zhin.js";
import type { EventType, GitHubWebhookPayload, Subscription } from "./types.js";
import crypto from "node:crypto";

// 类型扩展 - 使用新的模式
declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      router: Router;
    }
  }
  interface Models {
    github_subscriptions: {
      id: number;
      repo: string;
      events: EventType[];
      target_id: string;
      target_type: "private" | "group" | "channel";
      adapter: string;
      bot: string;
    };
    github_events: {
      id: number;
      repo: string;
      event_type: string;
      payload: any;
    };
  }
}

const plugin = usePlugin();
const { addCommand, useContext, root, logger } = plugin;

// 获取配置
const configService = root.inject("config");
const appConfig = configService?.get<{ "github-notify"?: { webhook_secret?: string } }>("zhin.config.yml") ?? {};
const config = appConfig["github-notify"] || {};

// 等待数据库就绪后定义模型
useContext("database", (db: any) => {
  // 定义数据模型（必须在数据库服务启动后调用）
  (plugin as any).defineModel("github_subscriptions", {
    id: { type: "integer", primary: true },
    repo: { type: "text", nullable: false },
    events: { type: "json", default: [] },
    target_id: { type: "text", nullable: false },
    target_type: { type: "text", nullable: false },
    adapter: { type: "text", nullable: false },
    bot: { type: "text", nullable: false },
  });

  (plugin as any).defineModel("github_events", {
    id: { type: "integer", primary: true },
    repo: { type: "text", nullable: false },
    event_type: { type: "text", nullable: false },
    payload: { type: "json", default: {} },
  });
  const subscriptions = db.models.get("github_subscriptions") as any;
  const events = db.models.get("github_events") as any;
  
  if (!subscriptions || !events) {
    logger.warn("github-notify: 数据库初始化失败，模型未创建");
    return;
  }

  // 订阅仓库命令
  // 使用解构出来的 addCommand
  addCommand(
    new MessageCommand("github.subscribe <repo:text> [...events:text]").action(
      async (message, result) => {
        const repo = result.params.repo;
        const eventList = result.params.events || [];

        // 验证仓库名格式
        if (!repo.includes("/")) {
          return "❌ 仓库名格式错误，应为 owner/repo";
        }

        // 验证事件类型
        const validEvents: EventType[] = [
          "push",
          "issue",
          "star",
          "fork",
          "unstar",
          "pull_request",
        ];
        const events: EventType[] = [];

        for (const event of eventList) {
          const normalized = event.toLowerCase();
          if (normalized === "pr") {
            events.push("pull_request");
          } else if (validEvents.includes(normalized as EventType)) {
            events.push(normalized as EventType);
          } else {
            return `❌ 不支持的事件类型: ${event}\n支持的事件: push, issue, star, fork, unstar, pr`;
          }
        }

        // 如果没有指定事件，订阅所有事件
        const subscribeEvents = events.length > 0 ? events : validEvents;

        // 检查权限（仅好友或群管理）
        const isPrivate = message.$channel.type === "private";
        const isAdmin = message.$channel.type === "group"; // 这里应该检查是否是管理员，简化处理

        if (!isPrivate && !isAdmin) {
          return "❌ 只有好友或群管理员可以订阅 GitHub 通知";
        }

        const targetId = message.$channel.id;
        const targetType = message.$channel.type;
        const adapter = message.$adapter;
        const bot = message.$bot;

        // 检查是否已订阅
        const [existing] = await subscriptions
          .select(
            "id",
            "repo",
            "events",
            "target_id",
            "target_type",
            "adapter",
            "bot"
          )
          .where({
            repo,
            target_id: targetId,
            target_type: targetType,
            adapter,
            bot,
          });

        if (existing) {
          // 更新订阅
          await subscriptions
            .update({
              events: subscribeEvents,
            })
            .where({ id: existing.id });
          return `✅ 已更新订阅 ${repo}\n📢 订阅事件: ${subscribeEvents.join(
            ", "
          )}`;
        }

        // 创建新订阅
        await subscriptions.insert({
          id: Date.now(),
          repo,
          events: subscribeEvents,
          target_id: targetId,
          target_type: targetType,
          adapter,
          bot,
        });

        return `✅ 成功订阅 ${repo}\n📢 订阅事件: ${subscribeEvents.join(
          ", "
        )}\n\n💡 配置 Webhook:\n1. 访问 https://github.com/${repo}/settings/hooks\n2. 添加 Webhook URL: http://zhin.liucl.cn/api/github/webhook\n3. 选择事件: ${subscribeEvents.join(
          ", "
        )}\n4. 设置 Secret (可选): 在插件配置中设置`;
      }
    )
  );

  // 取消订阅命令
  addCommand(
    new MessageCommand("github.unsubscribe <repo:text>").action(
      async (message, result) => {
        const repo = result.params.repo;
        const targetId = message.$channel.id;
        const targetType = message.$channel.type;
        const adapter = message.$adapter;
        const bot = message.$bot;

        const [subscription] = await subscriptions
          .select("id", "repo", "target_id", "target_type", "adapter", "bot")
          .where({
            repo,
            target_id: targetId,
            target_type: targetType,
            adapter,
            bot,
          });

        if (!subscription) {
          return `❌ 未找到订阅: ${repo}`;
        }

        await subscriptions.delete({ id: subscription.id });
        return `✅ 已取消订阅 ${repo}`;
      }
    )
  );

  // 查看订阅列表命令
  addCommand(
    new MessageCommand("github.list").action(async (message) => {
      const targetId = message.$channel.id;
      const targetType = message.$channel.type;
      const adapter = message.$adapter;
      const bot = message.$bot;

      const subs = await subscriptions
        .select(
          "id",
          "repo",
          "events",
          "adapter",
          "bot",
          "target_id",
          "target_type"
        )
        .where({
          target_id: targetId,
          target_type: targetType,
          adapter,
          bot,
        });

      if (!subs || subs.length === 0) {
        return "📭 当前没有订阅任何仓库";
      }

      const list = subs
        .map((sub: any, index: number) => {
          const events = Array.isArray(sub.events)
            ? sub.events.join(", ")
            : "无";
          return `${index + 1}. ${sub.repo}\n   📢 ${events}`;
        })
        .join("\n\n");

      return `📋 订阅列表 (共 ${subs.length} 个):\n\n${list}`;
    })
  );

  // 注册 Webhook 路由
  // 使用 plugin.useContext (因为 useContext 并不是 plugin 类的自有方法，而是全局导出，但 plugin 实例有自己的上下文管理逻辑)
  // 如果 Plugin 类实现了 useContext 方法，那么可以像 addCommand 一样解构
  // 经检查 Plugin 类没有直接的 useContext 方法，但它继承自 Dependency，而 Dependency 有上下文管理
  // 这里我们还是用 plugin.useContext
  // @ts-expect-error - router 类型在 @zhin.js/http 中声明
  plugin.useContext("router", (router: Router) => {
    router.post("/api/github/webhook", async (ctx: any) => {
      try {
        const signature = ctx.request.headers["x-hub-signature-256"] as string;
        const event = ctx.request.headers["x-github-event"] as string;
        const payload = ctx.body as GitHubWebhookPayload;

        logger.info(
          `收到 GitHub Webhook: ${event} - ${payload.repository?.full_name}`
        );

        // 验证签名（如果配置了 secret）
        const secret = config.webhook_secret;
        if (secret && signature) {
          const expectedSignature = `sha256=${crypto
            .createHmac("sha256", secret)
            .update(JSON.stringify(ctx.body))
            .digest("hex")}`;

          if (signature !== expectedSignature) {
            logger.warn("GitHub Webhook 签名验证失败");
            ctx.status = 401;
            ctx.body = { error: "Invalid signature" };
            return;
          }
        }

        if (!payload.repository) {
          ctx.status = 400;
          ctx.body = { error: "Invalid payload" };
          return;
        }

        const repo = payload.repository.full_name;

        // 保存事件
        await events.create({
          id: Date.now(),
          repo,
          event_type: event,
          payload,
        });

        // 映射事件类型
        let eventType: EventType | null = null;
        switch (event) {
          case "push":
            eventType = "push";
            break;
          case "issues":
            eventType = "issue";
            break;
          case "star":
            eventType = payload.action === "deleted" ? "unstar" : "star";
            break;
          case "fork":
            eventType = "fork";
            break;
          case "pull_request":
            eventType = "pull_request";
            break;
        }

        if (!eventType) {
          logger.debug(`忽略事件类型: ${event}`);
          ctx.status = 200;
          ctx.body = { message: "Event ignored" };
          return;
        }

        // 查找订阅
        const subs = await subscriptions.select().where({ repo });

        if (!subs || subs.length === 0) {
          logger.debug(`没有找到仓库 ${repo} 的订阅`);
          ctx.status = 200;
          ctx.body = { message: "No subscriptions" };
          return;
        }

        // 生成通知消息
        const message = formatGitHubEvent(event, payload);

        // 发送通知给订阅者
        for (const sub of subs) {
          const subscription = sub as Subscription;

          // 检查是否订阅了此事件
          if (!subscription.events.includes(eventType)) {
            continue;
          }

          try {
            // 获取适配器并发送消息
            const adapter = root.inject(subscription.adapter as any) as any;
            if (adapter && typeof adapter.emit === 'function') {
              await adapter.sendMessage({
                context: subscription.adapter,
                bot: subscription.bot,
                id: subscription.target_id,
                type: subscription.target_type,
                content: message,
              });
              logger.info(
                `已发送通知到 ${subscription.target_type}:${subscription.target_id}`
              );
            } else {
              logger.warn(`适配器 ${subscription.adapter} 未找到`);
            }
          } catch (error) {
            logger.error(`发送通知失败:`, error);
          }
        }

        ctx.status = 200;
        ctx.body = { message: "OK", notified: subs.length };
      } catch (error) {
        logger.error("处理 Webhook 失败:", error);
        ctx.status = 500;
        ctx.body = { error: "Internal server error" };
      }
    });

    logger.info("GitHub Webhook 路由已注册: POST /api/github/webhook");
  });
});

// 格式化 GitHub 事件为消息
function formatGitHubEvent(
  event: string,
  payload: GitHubWebhookPayload
): string {
  const repo = payload.repository.full_name;
  const sender = payload.sender.login;

  switch (event) {
    case "push": {
      const branch = payload.ref?.replace("refs/heads/", "") || "unknown";
      const commits = payload.commits || [];
      const commitCount = commits.length;

      let message = `📦 ${repo}\n🌿 ${sender} pushed to ${branch}\n\n`;

      if (commitCount > 0) {
        const commitList = commits
          .slice(0, 3)
          .map((commit) => {
            const shortId = commit.id.substring(0, 7);
            const msg = commit.message.split("\n")[0];
            return `  • ${shortId} ${msg}`;
          })
          .join("\n");

        message += `📝 ${commitCount} commit${
          commitCount > 1 ? "s" : ""
        }:\n${commitList}`;

        if (commitCount > 3) {
          message += `\n  ... and ${commitCount - 3} more`;
        }
      }
      return message;
    }

    case "issues": {
      const issue = payload.issue!;
      const action = payload.action;
      const actionText =
        action === "opened"
          ? "打开了"
          : action === "closed"
          ? "关闭了"
          : "更新了";

      return `🐛 ${repo}\n👤 ${sender} ${actionText} issue #${issue.number}\n\n📌 ${issue.title}`;
    }

    case "star": {
      const action = payload.action === "deleted" ? "unstarred" : "starred";
      const emoji = payload.action === "deleted" ? "💔" : "⭐";

      return `${emoji} ${repo}\n👤 ${sender} ${action} the repository`;
    }

    case "fork": {
      const forkee = payload.forkee!;

      return `🍴 ${repo}\n👤 ${sender} forked to ${forkee.full_name}`;
    }

    case "pull_request": {
      const pr = payload.pull_request!;
      const action = payload.action;
      const actionText =
        action === "opened"
          ? "打开了"
          : action === "closed"
          ? "关闭了"
          : "更新了";

      return `🔀 ${repo}\n👤 ${sender} ${actionText} PR #${pr.number}\n\n📌 ${pr.title}`;
    }

    default:
      return `📬 ${repo}\n${event} by ${sender}`;
  }
}

logger.info("GitHub 通知插件已加载");
